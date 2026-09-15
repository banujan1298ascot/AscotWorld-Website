"use client";

import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import {
  CalendarCheck,
  CheckCircle,
  Plus,
  Trash,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { DueDate, PriorityTag, StaffChip, TaskStatusPill } from "@/components/domain";
import {
  Button,
  Card,
  EmptyState,
  Field,
  FilterSelect,
  Input,
  Modal,
  PageHeader,
  PermissionNotice,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { pushNotification } from "@/lib/notifications";
import { batchCollection, departmentCollection, staffCollection, taskCollection } from "@/lib/seed";
import { useCollection } from "@/lib/storage";
import {
  roleCan,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/types";

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

export default function TasksPage() {
  const { user, can } = useAuth();
  const { items: tasks, ready } = useCollection(taskCollection);
  const { items: staff } = useCollection(staffCollection);
  const { items: batches } = useCollection(batchCollection);

  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  const visible = useMemo(() => {
    return tasks
      .filter((t) => (assigneeFilter === "all" ? true : t.assigneeId === assigneeFilter))
      .filter((t) => (priorityFilter === "all" ? true : t.priority === priorityFilter))
      .slice()
      .sort(
        (a, b) =>
          TASK_PRIORITY[b.priority].weight - TASK_PRIORITY[a.priority].weight ||
          (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
      );
  }, [tasks, assigneeFilter, priorityFilter]);

  /** Operators may only move their own work; managers may move anything. */
  function canEdit(task: Task): boolean {
    if (can("task.updateAny")) return true;
    return can("task.updateOwn") && task.assigneeId === user?.id;
  }

  const openCount = tasks.filter((t) => t.status !== "done").length;
  const overdueCount = tasks.filter(
    (t) => t.status !== "done" && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10),
  ).length;

  return (
    <>
      <PageHeader
        title="Task planner"
        description={
          ready
            ? `${openCount} open across the site${overdueCount ? ` · ${overdueCount} overdue` : ""}.`
            : undefined
        }
        actions={
          can("task.create") ? (
            <Button
              variant="primary"
              icon={<Plus size={16} weight="bold" />}
              onClick={() => setCreating(true)}
            >
              New task
            </Button>
          ) : null
        }
      />

      {/* ---- filters ---------------------------------------------------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Assignee"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            { value: "all", label: "Everyone" },
            ...(user ? [{ value: user.id, label: "Assigned to me" }] : []),
            ...staff.filter((s) => s.id !== user?.id).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <FilterSelect
          label="Priority"
          value={priorityFilter}
          onChange={setPriorityFilter}
          options={[
            { value: "all", label: "Any" },
            ...(Object.keys(TASK_PRIORITY) as TaskPriority[])
              .reverse()
              .map((p) => ({ value: p, label: TASK_PRIORITY[p].label })),
          ]}
        />
        {!can("task.updateOwn") && !can("task.updateAny") ? (
          <PermissionNotice message="You have read-only access — tasks can be viewed but not changed." />
        ) : null}
      </div>

      {/* ---- board ------------------------------------------------------ */}
      {!ready ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((s) => (
            <Skeleton key={s} className="h-64" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title="No tasks match these filters"
            description="Try widening the assignee or priority filter to see more of the board."
            action={
              <Button
                onClick={() => {
                  setAssigneeFilter("all");
                  setPriorityFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((status) => {
            const column = visible.filter((t) => t.status === status);
            return (
              <section key={status} className="flex min-w-0 flex-col">
                <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                  <TaskStatusPill status={status} size="sm" />
                  <span className="tabular text-[11px] font-bold text-[var(--muted-foreground)]">
                    {column.length}
                  </span>
                </div>

                <div className="grid gap-2">
                  {column.length === 0 ? (
                    <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--subtle-foreground)]">
                      Nothing here
                    </p>
                  ) : (
                    column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        assignee={task.assigneeId ? staffById.get(task.assigneeId) : undefined}
                        batchNo={task.batchId ? batchById.get(task.batchId)?.batchNo : undefined}
                        onOpen={() => setEditing(task)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ---- dialogs ---------------------------------------------------- */}
      {creating ? (
        <TaskDialog
          open
          title="New task"
          onClose={() => setCreating(false)}
          onSave={(values) => {
            const task = taskCollection.create(values);
            // Let someone know work has landed on their plate — but not when
            // they assigned it to themselves.
            if (task.assigneeId && task.assigneeId !== user?.id) {
              pushNotification({
                recipientId: task.assigneeId,
                type: "task",
                title: "New task assigned to you",
                body: task.title,
                href: "/tasks",
              });
            }
            setCreating(false);
          }}
        />
      ) : null}

      {editing ? (
        <TaskDialog
          open
          title="Task details"
          task={editing}
          readOnly={!canEdit(editing)}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            const previousAssignee = editing.assigneeId;
            // A manager changing the deadline directly (rather than through
            // Approve/Decline) resolves any pending request on it too.
            const clearsRequest = values.dueDate !== editing.dueDate && editing.requestedDueDate;
            taskCollection.update(editing.id, {
              ...values,
              ...(clearsRequest ? { requestedDueDate: null, extensionReason: null } : {}),
            });
            if (
              values.assigneeId &&
              values.assigneeId !== previousAssignee &&
              values.assigneeId !== user?.id
            ) {
              pushNotification({
                recipientId: values.assigneeId,
                type: "task",
                title: "Task assigned to you",
                body: values.title,
                href: "/tasks",
              });
            }
            setEditing(null);
          }}
          onDelete={
            can("task.delete")
              ? () => {
                  taskCollection.remove(editing.id);
                  setEditing(null);
                }
              : undefined
          }
          onRequestExtension={(requestedDueDate, reason) => {
            taskCollection.update(editing.id, { requestedDueDate, extensionReason: reason });
            // "Department manager" maps to whoever holds task.updateAny in this
            // build — the app only has one management tier today, not a
            // per-department one, so every manager is notified rather than a
            // single owner for the assignee's specific department.
            staff
              .filter((s) => roleCan(s.role, "task.updateAny") && s.id !== user?.id)
              .forEach((manager) => {
                pushNotification({
                  recipientId: manager.id,
                  type: "task",
                  title: `Extension requested: ${editing.title}`,
                  body: `${user?.name ?? "Someone"} would like to move this to ${format(
                    new Date(`${requestedDueDate}T00:00:00`),
                    "d MMM",
                  )}${reason ? ` — “${reason}”` : ""}.`,
                  href: "/tasks",
                });
              });
            setEditing(null);
          }}
          onResolveExtension={(approve) => {
            if (approve && editing.requestedDueDate) {
              taskCollection.update(editing.id, {
                dueDate: editing.requestedDueDate,
                requestedDueDate: null,
                extensionReason: null,
              });
            } else {
              taskCollection.update(editing.id, { requestedDueDate: null, extensionReason: null });
            }
            if (editing.assigneeId && editing.assigneeId !== user?.id) {
              pushNotification({
                recipientId: editing.assigneeId,
                type: "task",
                title: approve ? "Extension approved" : "Extension declined",
                body:
                  approve && editing.requestedDueDate
                    ? `${editing.title} — new deadline ${format(
                        new Date(`${editing.requestedDueDate}T00:00:00`),
                        "d MMM",
                      )}.`
                    : editing.title,
                href: "/tasks",
              });
            }
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function TaskCard({
  task,
  assignee,
  batchNo,
  onOpen,
}: {
  task: Task;
  assignee: ReturnType<typeof staffCollection.find>;
  batchNo?: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)]
        p-3 text-left shadow-[var(--shadow-card)] transition-colors duration-150
        hover:border-[var(--brand-300)]"
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p
          className={`text-[13px] font-bold leading-snug ${
            task.status === "done"
              ? "text-[var(--muted-foreground)] line-through"
              : "text-foreground"
          }`}
        >
          {task.title}
        </p>
      </div>

      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <PriorityTag priority={task.priority} />
        {batchNo ? (
          <span className="tabular rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">
            {batchNo}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <StaffChip person={assignee} />
        <DueDate date={task.dueDate} done={task.status === "done"} />
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

type TaskValues = Omit<Task, "id" | "createdAt" | "updatedAt">;

function TaskDialog({
  open,
  title,
  task,
  readOnly = false,
  onClose,
  onSave,
  onDelete,
  onRequestExtension,
  onResolveExtension,
}: {
  open: boolean;
  title: string;
  task?: Task;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (values: TaskValues) => void;
  onDelete?: () => void;
  /** Assignee asking for more time. Only offered on an existing, own task. */
  onRequestExtension?: (requestedDueDate: string, reason: string) => void;
  /** Manager accepting or rejecting a pending request. */
  onResolveExtension?: (approve: boolean) => void;
}) {
  const { user, can } = useAuth();
  const { items: staff } = useCollection(staffCollection);
  const { items: batches } = useCollection(batchCollection);
  const { items: departmentRecords } = useCollection(departmentCollection);
  const departmentNames = useMemo(
    () => departmentRecords.map((d) => d.name).sort(),
    [departmentRecords],
  );

  // Deadlines are manager-only — see the note on the "Due date" field below.
  const canManageDueDate = can("task.updateAny");
  const isOwnTask = task ? task.assigneeId === user?.id : false;

  const [values, setValues] = useState<TaskValues>({
    title: task?.title ?? "",
    detail: task?.detail ?? "",
    status: task?.status ?? "todo",
    priority: task?.priority ?? "normal",
    assigneeId: task?.assigneeId ?? null,
    dueDate: task?.dueDate ?? null,
    batchId: task?.batchId ?? null,
    requestedDueDate: task?.requestedDueDate ?? null,
    extensionReason: task?.extensionReason ?? null,
    reminderSentFor: task?.reminderSentFor ?? null,
  });
  const [error, setError] = useState<string | null>(null);

  // Narrows the assignee picker below. Starts on the current assignee's
  // department so editing a task shows a consistent pair of dropdowns rather
  // than resetting to "All departments" every time it's reopened.
  const [assigneeDepartment, setAssigneeDepartment] = useState<string>(() => {
    const current = staff.find((s) => s.id === task?.assigneeId);
    return current?.department ?? "";
  });

  const [requestingExtension, setRequestingExtension] = useState(false);
  const [proposedDate, setProposedDate] = useState(() =>
    task?.dueDate ? format(addDays(new Date(`${task.dueDate}T00:00:00`), 1), "yyyy-MM-dd") : "",
  );
  const [extensionReasonDraft, setExtensionReasonDraft] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);

  function set<K extends keyof TaskValues>(key: K, value: TaskValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  }

  function handleSave() {
    if (!values.title.trim()) {
      setError("Give the task a title so people know what it is.");
      return;
    }
    onSave({ ...values, title: values.title.trim() });
  }

  function handleRequestExtension() {
    if (!proposedDate) return setRequestError("Choose a date.");
    if (task?.dueDate && proposedDate <= task.dueDate) {
      return setRequestError("Pick a date after the current deadline.");
    }
    onRequestExtension?.(proposedDate, extensionReasonDraft.trim());
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={readOnly ? "You can view this task but not change it." : undefined}
      footer={
        <>
          {onDelete && !readOnly ? (
            <Button
              variant="ghost"
              icon={<Trash size={15} weight="bold" />}
              onClick={() => {
                if (window.confirm(`Delete "${values.title}"? This cannot be undone.`)) onDelete();
              }}
              className="mr-auto !text-[var(--danger)] hover:!bg-[var(--danger-bg)]"
            >
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly ? (
            <Button variant="primary" onClick={handleSave}>
              Save task
            </Button>
          ) : null}
        </>
      }
    >
      <fieldset disabled={readOnly} className="grid gap-4">
        <Field label="Title" htmlFor="task-title" required error={error ?? undefined}>
          <Input
            id="task-title"
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What needs doing?"
            aria-invalid={error ? true : undefined}
          />
        </Field>

        <Field
          label="Detail"
          htmlFor="task-detail"
          helper="Include anything the person picking this up would otherwise have to ask for."
        >
          <Textarea
            id="task-detail"
            rows={3}
            value={values.detail}
            onChange={(e) => set("detail", e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="task-status">
            <Select
              id="task-status"
              value={values.status}
              onChange={(e) => set("status", e.target.value as TaskStatus)}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="task-priority">
            <Select
              id="task-priority"
              value={values.priority}
              onChange={(e) => set("priority", e.target.value as TaskPriority)}
            >
              {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY[p].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Department" htmlFor="task-assignee-department">
            <Select
              id="task-assignee-department"
              value={assigneeDepartment}
              onChange={(e) => {
                const department = e.target.value;
                setAssigneeDepartment(department);
                // Narrowing to a department the current pick doesn't belong to
                // clears it, rather than leaving a mismatched selection hidden
                // behind the new filter.
                const current = staff.find((s) => s.id === values.assigneeId);
                if (department && current?.department !== department) {
                  set("assigneeId", null);
                }
              }}
            >
              <option value="">All departments</option>
              {departmentNames.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assigned to" htmlFor="task-assignee">
            <Select
              id="task-assignee"
              value={values.assigneeId ?? ""}
              onChange={(e) => set("assigneeId", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {staff
                .filter((s) => !assigneeDepartment || s.department === assigneeDepartment)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.jobTitle}
                  </option>
                ))}
            </Select>
          </Field>

          <Field
            label="Due date"
            htmlFor="task-due"
            helper={!canManageDueDate ? "Only a manager can change the deadline." : undefined}
          >
            <Input
              id="task-due"
              type="date"
              value={values.dueDate ?? ""}
              onChange={(e) => set("dueDate", e.target.value || null)}
              disabled={!canManageDueDate}
            />
          </Field>
        </div>

        <Field
          label="Related batch"
          htmlFor="task-batch"
          helper="Link the task to a batch so it shows against that production run."
        >
          <Select
            id="task-batch"
            value={values.batchId ?? ""}
            onChange={(e) => set("batchId", e.target.value || null)}
          >
            <option value="">Not batch-related</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNo} — {b.product}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      {/* ---- deadline extension --------------------------------------- */}
      {task ? (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          {task.requestedDueDate ? (
            <div className="rounded-md bg-[var(--status-qa-bg)] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--status-qa)]">
                <CalendarCheck size={14} weight="fill" />
                Extension requested
              </p>
              <p className="mt-1 text-xs text-foreground">
                Wants to move the deadline to{" "}
                <strong>{format(new Date(`${task.requestedDueDate}T00:00:00`), "d MMM yyyy")}</strong>
                {task.extensionReason ? <> — “{task.extensionReason}”</> : null}
              </p>
              {canManageDueDate && onResolveExtension ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<CheckCircle size={14} weight="bold" />}
                    onClick={() => onResolveExtension(true)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    icon={<XCircle size={14} weight="bold" />}
                    onClick={() => onResolveExtension(false)}
                  >
                    Decline
                  </Button>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                  Awaiting a manager&apos;s review.
                </p>
              )}
            </div>
          ) : isOwnTask && !canManageDueDate && task.status !== "done" && onRequestExtension ? (
            requestingExtension ? (
              <div className="grid gap-3 rounded-md bg-[var(--surface-sunken)] p-3">
                <Field
                  label="New date"
                  htmlFor="ext-date"
                  required
                  error={requestError ?? undefined}
                >
                  <Input
                    id="ext-date"
                    type="date"
                    value={proposedDate}
                    min={task.dueDate ?? undefined}
                    onChange={(e) => {
                      setProposedDate(e.target.value);
                      setRequestError(null);
                    }}
                  />
                </Field>
                <Field label="Reason (optional)" htmlFor="ext-reason">
                  <Textarea
                    id="ext-reason"
                    rows={2}
                    value={extensionReasonDraft}
                    onChange={(e) => setExtensionReasonDraft(e.target.value)}
                    placeholder="What's holding it up?"
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setRequestingExtension(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" onClick={handleRequestExtension}>
                    Send request
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                icon={<CalendarCheck size={14} weight="bold" />}
                onClick={() => setRequestingExtension(true)}
              >
                Request extension
              </Button>
            )
          ) : null}
        </div>
      ) : null}

      {readOnly ? (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
          <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
          This task is assigned to someone else. Ask a manager if it needs reassigning.
        </p>
      ) : null}
    </Modal>
  );
}
