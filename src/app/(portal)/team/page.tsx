"use client";

import { useMemo, useState } from "react";
import { addWeeks, eachDayOfInterval, endOfWeek, format, isSameDay, startOfWeek } from "date-fns";
import {
  Buildings,
  CaretLeft,
  CaretRight,
  EnvelopeSimple,
  Phone,
  UserPlus,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { ShiftPill } from "@/components/domain";
import {
  Avatar,
  Button,
  Card,
  Field,
  FilterSelect,
  Input,
  Modal,
  PageHeader,
  PermissionNotice,
  Select,
  Skeleton,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { departmentCollection, shiftCollection, staffCollection } from "@/lib/seed";
import { useCollection } from "@/lib/storage";
import { ROLES, SHIFT_TYPE, type Department, type Role, type ShiftType, type StaffMember } from "@/lib/types";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

const SHIFT_CYCLE: ShiftType[] = ["early", "late", "night", "holiday", "absent"];

export default function TeamPage() {
  const { can } = useAuth();
  const { items: staff, ready } = useCollection(staffCollection);
  const { items: shifts } = useCollection(shiftCollection);
  const { items: departmentRecords } = useCollection(departmentCollection);

  const [view, setView] = useState<"rota" | "directory">("rota");
  const [weekOffset, setWeekOffset] = useState(0);
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [addingDepartment, setAddingDepartment] = useState(false);

  const weekStart = useMemo(
    () => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset),
    [weekOffset],
  );
  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) }),
    [weekStart],
  );

  // The registered department list (including any with nobody in them yet),
  // not just what current staff happen to belong to.
  const departmentNames = useMemo(
    () => departmentRecords.map((d) => d.name).sort(),
    [departmentRecords],
  );

  const visibleStaff = useMemo(
    () =>
      staff
        .filter((s) => departmentFilter === "all" || s.department === departmentFilter)
        .slice()
        .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)),
    [staff, departmentFilter],
  );

  /** Fast lookup of "who is on what, when". */
  const shiftLookup = useMemo(() => {
    const map = new Map<string, ShiftType>();
    shifts.forEach((s) => map.set(`${s.staffId}:${s.date}`, s.shift));
    return map;
  }, [shifts]);

  /** Managers can cycle a cell through the shift types; others cannot. */
  function cycleShift(staffId: string, date: string) {
    if (!can("rota.manage")) return;
    const existing = shifts.find((s) => s.staffId === staffId && s.date === date);
    if (!existing) {
      shiftCollection.create({ staffId, date, shift: "early" });
      return;
    }
    const next = SHIFT_CYCLE[(SHIFT_CYCLE.indexOf(existing.shift) + 1) % SHIFT_CYCLE.length];
    shiftCollection.update(existing.id, { shift: next });
  }

  return (
    <>
      <PageHeader
        title="Team & rota"
        description="Who's on shift this week, and how to reach everyone on site."
        actions={
          <>
            <div
              className="inline-flex rounded-md border border-[var(--border-strong)] p-0.5"
              role="tablist"
              aria-label="Team view"
            >
              {(["rota", "directory"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`cursor-pointer rounded px-3 py-1.5 text-[13px] font-bold capitalize
                    transition-colors duration-150 ${
                      view === v
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "text-[var(--muted-foreground)] hover:text-foreground"
                    }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {can("team.manage") ? (
              <>
                <Button
                  icon={<Buildings size={16} weight="bold" />}
                  onClick={() => setAddingDepartment(true)}
                >
                  Add department
                </Button>
                <Button
                  variant="primary"
                  icon={<UserPlus size={16} weight="bold" />}
                  onClick={() => setAddingEmployee(true)}
                >
                  Add employee
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterSelect
          label="Department"
          value={departmentFilter}
          onChange={setDepartmentFilter}
          options={[
            { value: "all", label: "All departments" },
            ...departmentNames.map((d) => ({ value: d, label: d })),
          ]}
        />

        {view === "rota" ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="Previous week"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-[var(--border-strong)]
                bg-[var(--surface)] text-[var(--muted-foreground)] transition-colors duration-150
                hover:bg-[var(--surface-sunken)] hover:text-foreground"
            >
              <CaretLeft size={15} weight="bold" />
            </button>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              aria-label="Next week"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-[var(--border-strong)]
                bg-[var(--surface)] text-[var(--muted-foreground)] transition-colors duration-150
                hover:bg-[var(--surface-sunken)] hover:text-foreground"
            >
              <CaretRight size={15} weight="bold" />
            </button>
            <span className="ml-2 text-[13px] font-bold">
              {format(weekStart, "d MMM")} – {format(weekDays[6], "d MMM yyyy")}
            </span>
            {weekOffset !== 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setWeekOffset(0)}>
                This week
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!ready ? (
        <Skeleton className="h-96 w-full" />
      ) : view === "rota" ? (
        <>
          {!can("rota.manage") ? (
            <div className="mb-3">
              <PermissionNotice message="Only managers can change the rota. Contact your line manager to request a change." />
            </div>
          ) : (
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              Select any cell to cycle through Early → Late → Night → Holiday → Absent.
            </p>
          )}

          {/* The rota is wide by nature — it scrolls inside its own container so
              the page body never scrolls sideways. */}
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">
                Shift rota for the week of {format(weekStart, "d MMMM yyyy")}
              </caption>
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)]">
                  <th scope="col" className="px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Staff
                  </th>
                  {weekDays.map((day) => {
                    const today = isSameDay(day, new Date());
                    return (
                      <th
                        key={day.toISOString()}
                        scope="col"
                        className={`px-1.5 py-2 text-center text-[11px] font-extrabold uppercase tracking-wider ${
                          today ? "text-[var(--brand-600)]" : "text-[var(--muted-foreground)]"
                        }`}
                      >
                        {format(day, "EEE")}
                        <span className="tabular ml-1 font-bold">{format(day, "d")}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleStaff.map((person) => (
                  <tr key={person.id} className="border-b border-[var(--border)] last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <Avatar initials={person.initials} size={26} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-bold text-foreground">
                            {person.name}
                          </span>
                          <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                            {person.jobTitle}
                          </span>
                        </span>
                      </span>
                    </th>
                    {weekDays.map((day) => {
                      const date = iso(day);
                      const shift = shiftLookup.get(`${person.id}:${date}`);
                      const editable = can("rota.manage");
                      return (
                        <td key={date} className="px-1 py-1.5 align-middle">
                          {editable ? (
                            <button
                              onClick={() => cycleShift(person.id, date)}
                              className="block w-full cursor-pointer rounded transition-[filter] duration-150 hover:brightness-95"
                              aria-label={`${person.name}, ${format(day, "EEEE d MMMM")}: ${
                                shift ? SHIFT_TYPE[shift].label : "no shift"
                              }. Select to change.`}
                            >
                              {shift ? (
                                <ShiftPill shift={shift} />
                              ) : (
                                <span className="block rounded border border-dashed border-[var(--border-strong)] px-1 py-1 text-center text-[11px] text-[var(--subtle-foreground)]">
                                  —
                                </span>
                              )}
                            </button>
                          ) : shift ? (
                            <ShiftPill shift={shift} />
                          ) : (
                            <span className="block px-1 py-1 text-center text-[11px] text-[var(--subtle-foreground)]">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* legend */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {(Object.keys(SHIFT_TYPE) as ShiftType[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: SHIFT_TYPE[s].bgVar, border: `1px solid ${SHIFT_TYPE[s].colorVar}` }}
                  aria-hidden="true"
                />
                <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                  {SHIFT_TYPE[s].label}
                  <span className="ml-1 font-normal opacity-70">{SHIFT_TYPE[s].hours}</span>
                </span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <DirectoryGrid staff={visibleStaff} />
      )}

      {addingDepartment ? (
        <DepartmentDialog
          existingNames={departmentNames}
          onClose={() => setAddingDepartment(false)}
          onCreated={() => setAddingDepartment(false)}
        />
      ) : null}

      {addingEmployee ? (
        <EmployeeDialog
          existingStaff={staff}
          departments={departmentNames}
          onClose={() => setAddingEmployee(false)}
          onCreated={() => {
            setAddingEmployee(false);
            setView("directory");
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Add department                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Creates a department on its own — separate from adding an employee, so a
 * manager can set up the org structure (e.g. a new team standing up) before
 * anyone has been hired into it yet. Only rendered when the caller already
 * holds `team.manage`.
 */
function DepartmentDialog({
  existingNames,
  onClose,
  onCreated,
}: {
  existingNames: readonly string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a name for the department.");
    if (existingNames.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      return setError("A department with that name already exists.");
    }
    departmentCollection.create({ name: trimmed });
    onCreated();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add department"
      description="Adds it to the directory and every department picker across the portal."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>
            Create department
          </Button>
        </>
      }
    >
      <Field label="Department name" htmlFor="dept-name" required error={error ?? undefined}>
        <Input
          id="dept-name"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="e.g. Logistics"
          aria-invalid={error ? true : undefined}
        />
      </Field>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Add employee                                                               */
/* -------------------------------------------------------------------------- */

/** First + last initial (or first two letters of a single-word name). */
function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmployeeForm {
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  department: Department;
  role: Role;
  demoPassword: string;
}

/**
 * Creates a new staff account. Only rendered when the caller already holds
 * `team.manage`, in keeping with how the other create dialogs (tasks,
 * batches) are gated by their pages rather than re-checking internally.
 *
 * Department is picked from what's already registered — creating a new one
 * is a separate action (`DepartmentDialog`, via the "Add department" button),
 * not something typed inline here.
 */
function EmployeeDialog({
  existingStaff,
  departments,
  onClose,
  onCreated,
}: {
  existingStaff: readonly StaffMember[];
  departments: readonly Department[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [values, setValues] = useState<EmployeeForm>({
    name: "",
    email: "",
    phone: "",
    jobTitle: "",
    department: departments[0] ?? "",
    role: "production",
    demoPassword: "demo1234",
  });
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  }

  function handleSave() {
    const name = values.name.trim();
    const email = values.email.trim();
    const jobTitle = values.jobTitle.trim();

    if (!name) return setError("Enter the employee's full name.");
    if (!jobTitle) return setError("Enter their job title.");
    if (!values.department) return setError("Choose a department.");
    if (!EMAIL_PATTERN.test(email)) return setError("Enter a valid email address.");
    if (existingStaff.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
      return setError("An account already exists with that email address.");
    }
    if (!values.demoPassword.trim()) {
      return setError("Set a password for them to sign in with.");
    }

    staffCollection.create({
      name,
      initials: computeInitials(name),
      role: values.role,
      jobTitle,
      department: values.department,
      email,
      phone: values.phone.trim() || "—",
      demoPassword: values.demoPassword.trim(),
    });
    onCreated();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add employee"
      description="Creates an account so they can sign in to the portal."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>
            Create account
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-3 rounded-md bg-[var(--surface-sunken)] px-3 py-2.5">
        <Avatar initials={values.name ? computeInitials(values.name) : "?"} size={36} />
        <p className="text-xs text-[var(--muted-foreground)]">
          Their access is decided entirely by the role you choose below — pick the one that
          matches what they should be able to see and change.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="emp-name" required error={error ?? undefined}>
            <Input
              id="emp-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Jordan Blake"
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <Field label="Job title" htmlFor="emp-title" required>
            <Input
              id="emp-title"
              value={values.jobTitle}
              onChange={(e) => set("jobTitle", e.target.value)}
              placeholder="e.g. Production Operator"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Email address"
            htmlFor="emp-email"
            required
            helper="Used to sign in — must be unique."
          >
            <Input
              id="emp-email"
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@ascotworld.example"
            />
          </Field>
          <Field label="Phone" htmlFor="emp-phone">
            <Input
              id="emp-phone"
              type="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="020 8953 01xx"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Department"
            htmlFor="emp-department"
            helper={
              departments.length === 0
                ? "No departments yet — use “Add department” first."
                : undefined
            }
          >
            <Select
              id="emp-department"
              value={values.department}
              onChange={(e) => set("department", e.target.value)}
              disabled={departments.length === 0}
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Role"
            htmlFor="emp-role"
            helper={ROLES[values.role].description}
          >
            <Select
              id="emp-role"
              value={values.role}
              onChange={(e) => set("role", e.target.value as Role)}
            >
              {(Object.keys(ROLES) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Sign-in password"
          htmlFor="emp-password"
          required
          helper="This is a demo system — passwords are stored as plain text and shown here so you can hand it to them directly. Never do this in a real deployment."
        >
          <Input
            id="emp-password"
            value={values.demoPassword}
            onChange={(e) => set("demoPassword", e.target.value)}
          />
        </Field>

        <p className="flex items-start gap-2 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
          <WarningCircle size={14} weight="fill" className="mt-px shrink-0" />
          Only Admin/Manager accounts can add new employees or change access.
        </p>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function DirectoryGrid({ staff }: { staff: StaffMember[] }) {
  // Group by department so the directory reads like the org, not a flat list.
  const byDepartment = useMemo(() => {
    const map = new Map<Department, StaffMember[]>();
    staff.forEach((s) => {
      const list = map.get(s.department) ?? [];
      list.push(s);
      map.set(s.department, list);
    });
    return Array.from(map.entries());
  }, [staff]);

  return (
    <div className="grid gap-5">
      {byDepartment.map(([department, people]) => (
        <section key={department}>
          <h2 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--subtle-foreground)]">
            {department}
            <span className="tabular ml-1.5 font-bold text-[var(--muted-foreground)]">
              {people.length}
            </span>
          </h2>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {people.map((person) => (
              <Card key={person.id} className="flex items-start gap-3">
                <Avatar initials={person.initials} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{person.name}</p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {person.jobTitle}
                  </p>
                  <p className="mt-0.5 inline-block rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">
                    {ROLES[person.role].label}
                  </p>

                  <div className="mt-2 grid gap-1">
                    <a
                      href={`mailto:${person.email}`}
                      className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]
                        transition-colors duration-150 hover:text-[var(--brand-600)]"
                    >
                      <EnvelopeSimple size={13} weight="bold" className="shrink-0" />
                      <span className="truncate">{person.email}</span>
                    </a>
                    {person.phone && person.phone !== "—" ? (
                      <a
                        href={`tel:${person.phone.replace(/\s/g, "")}`}
                        className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]
                          transition-colors duration-150 hover:text-[var(--brand-600)]"
                      >
                        <Phone size={13} weight="bold" className="shrink-0" />
                        <span className="tabular truncate">{person.phone}</span>
                      </a>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
