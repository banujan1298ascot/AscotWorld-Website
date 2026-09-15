"use client";

import {
  CalendarBlank,
  CheckCircle,
  Circle,
  Clock,
  Dog,
  Flask,
  Prohibit,
  ProhibitInset,
  Spinner,
  User,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { StatusPill, Avatar } from "./ui";
import {
  BATCH_STATUS,
  PRODUCT_LINE,
  SHIFT_TYPE,
  TASK_PRIORITY,
  type BatchStatus,
  type ProductLine,
  type ShiftType,
  type StaffMember,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Batch status                                                               */
/* -------------------------------------------------------------------------- */

const BATCH_ICON: Record<BatchStatus, typeof Circle> = {
  scheduled: CalendarBlank,
  in_production: Spinner,
  qa_hold: Warning,
  released: CheckCircle,
  cancelled: ProhibitInset,
};

export function BatchStatusPill({
  status,
  size = "md",
}: {
  status: BatchStatus;
  size?: "sm" | "md";
}) {
  const meta = BATCH_STATUS[status];
  const Icon = BATCH_ICON[status];
  return (
    <StatusPill
      label={meta.label}
      color={meta.colorVar}
      background={meta.bgVar}
      size={size}
      icon={<Icon size={size === "sm" ? 11 : 13} weight="fill" />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Task status & priority                                                     */
/* -------------------------------------------------------------------------- */

const TASK_STATUS_STYLE: Record<
  TaskStatus,
  { label: string; color: string; bg: string; icon: typeof Circle }
> = {
  todo: {
    label: "To do",
    color: "var(--status-scheduled)",
    bg: "var(--status-scheduled-bg)",
    icon: Circle,
  },
  in_progress: {
    label: "In progress",
    color: "var(--status-production)",
    bg: "var(--status-production-bg)",
    icon: Spinner,
  },
  blocked: {
    label: "Blocked",
    color: "var(--status-cancelled)",
    bg: "var(--status-cancelled-bg)",
    icon: Prohibit,
  },
  done: {
    label: "Done",
    color: "var(--status-released)",
    bg: "var(--status-released-bg)",
    icon: CheckCircle,
  },
};

export function TaskStatusPill({ status, size = "md" }: { status: TaskStatus; size?: "sm" | "md" }) {
  const meta = TASK_STATUS_STYLE[status];
  const Icon = meta.icon;
  return (
    <StatusPill
      label={meta.label}
      color={meta.color}
      background={meta.bg}
      size={size}
      icon={<Icon size={size === "sm" ? 11 : 13} weight="fill" />}
    />
  );
}

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  low: "var(--subtle-foreground)",
  normal: "var(--muted-foreground)",
  high: "var(--warning)",
  critical: "var(--danger)",
};

/** Priority is shown as bars plus a word — never colour alone. */
export function PriorityTag({ priority }: { priority: TaskPriority }) {
  const weight = TASK_PRIORITY[priority].weight;
  const color = PRIORITY_STYLE[priority];
  return (
    <span className="inline-flex items-center gap-1" title={`${TASK_PRIORITY[priority].label} priority`}>
      <span className="flex items-end gap-px" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{
              height: 4 + i * 2,
              background: i <= weight ? color : "var(--border-strong)",
            }}
          />
        ))}
      </span>
      <span className="text-[11px] font-bold" style={{ color }}>
        {TASK_PRIORITY[priority].label}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Product line                                                               */
/* -------------------------------------------------------------------------- */

export function ProductLineTag({ line }: { line: ProductLine }) {
  const Icon = line === "veterinary" ? Dog : Flask;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold"
      style={{
        color: line === "veterinary" ? "var(--brand-700)" : "var(--muted-foreground)",
        background: line === "veterinary" ? "var(--brand-100)" : "var(--surface-sunken)",
      }}
      title={PRODUCT_LINE[line].label}
    >
      <Icon size={12} weight="fill" />
      {PRODUCT_LINE[line].short}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Shifts                                                                     */
/* -------------------------------------------------------------------------- */

export function ShiftPill({ shift }: { shift: ShiftType }) {
  const meta = SHIFT_TYPE[shift];
  return (
    <span
      className="inline-flex w-full items-center justify-center rounded px-1 py-1 text-[11px] font-bold"
      style={{ color: meta.colorVar, background: meta.bgVar }}
      title={`${meta.label} — ${meta.hours}`}
    >
      {meta.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

export function StaffChip({ person }: { person: StaffMember | undefined }) {
  if (!person) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--subtle-foreground)]">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-sunken)]">
          <User size={12} weight="bold" />
        </span>
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar initials={person.initials} size={24} />
      <span className="truncate text-xs font-semibold text-foreground">{person.name}</span>
    </span>
  );
}

/** Overlapping avatars for a batch crew, with a full list in the tooltip. */
export function StaffStack({ people }: { people: StaffMember[] }) {
  if (people.length === 0) {
    return <span className="text-xs text-[var(--subtle-foreground)]">None assigned</span>;
  }
  return (
    <span className="flex items-center" title={people.map((p) => p.name).join(", ")}>
      {people.slice(0, 4).map((p, i) => (
        <span key={p.id} className="ring-2 ring-[var(--surface)] rounded-full" style={{ marginLeft: i ? -6 : 0 }}>
          <Avatar initials={p.initials} size={24} />
        </span>
      ))}
      {people.length > 4 ? (
        <span className="ml-1 text-[11px] font-bold text-[var(--muted-foreground)]">
          +{people.length - 4}
        </span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Due dates                                                                  */
/* -------------------------------------------------------------------------- */

/** Renders a due date with overdue / due-today emphasis, using words as well
 *  as colour so the state is never carried by colour alone. */
export function DueDate({ date, done }: { date: string | null; done?: boolean }) {
  if (!date) return <span className="text-xs text-[var(--subtle-foreground)]">No date</span>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${date}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  let label = due.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  let color = "var(--muted-foreground)";
  let emphasis = false;

  if (!done) {
    if (days < 0) {
      label = `Overdue — ${label}`;
      color = "var(--danger)";
      emphasis = true;
    } else if (days === 0) {
      label = "Due today";
      color = "var(--warning)";
      emphasis = true;
    } else if (days === 1) {
      label = "Due tomorrow";
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${emphasis ? "font-bold" : "font-medium"}`}
      style={{ color }}
    >
      <Clock size={12} weight={emphasis ? "fill" : "regular"} />
      {label}
    </span>
  );
}
