/**
 * Domain model for the AscotWorld portal.
 *
 * Every record extends `Entity`, which is all the storage layer needs to know
 * about. A new module can define its own record type and reuse the whole
 * persistence stack without changing anything here.
 */

export interface Entity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* People and access                                                          */
/* -------------------------------------------------------------------------- */

export type Role = "admin" | "production" | "qa" | "viewer";

export const ROLES: Record<Role, { label: string; description: string }> = {
  admin: {
    label: "Admin / Manager",
    description: "Full access — schedules batches, assigns work, manages people.",
  },
  production: {
    label: "Production operator",
    description: "Works the line — updates own tasks and batch progress.",
  },
  qa: {
    label: "QA / Quality",
    description: "Reviews and releases batches, signs off quality holds.",
  },
  viewer: {
    label: "Read-only / Viewer",
    description: "Can see schedules and tasks but change nothing.",
  },
};

/**
 * Capabilities are the unit of permission. Modules check capabilities, never
 * roles directly, so adding a role or shifting what a role may do is a change
 * in one table (`ROLE_CAPABILITIES`) rather than across every screen.
 */
export type Capability =
  | "task.create"
  | "task.assign"
  | "task.updateOwn"
  | "task.updateAny"
  | "task.delete"
  | "batch.create"
  | "batch.updateProgress"
  | "batch.release"
  | "batch.delete"
  | "team.manage"
  | "rota.manage"
  // Batch Book (spec 2.1, 5) — kept separate from the "batch.*" capabilities
  // above, which belong to the existing production-schedule Batch entity in
  // this same file, not the Postgres-backed BatchRecord.
  | "batchbook.create"
  | "batchbook.editOwnDraft"
  | "batchbook.confirm"
  | "batchbook.editConfirmed"
  // MES pipeline (spec 3) — claim/pass/send-back are one general "operate a
  // stage" permission; a batch can only be failed at a stage whose
  // fail_authority flag is set (spec 3.2), which is a per-stage DB fact, not
  // a role, so there's no separate "mes.fail" capability.
  | "mes.claim"
  | "mes.pass"
  // Production dashboard (spec 4, 5). Split in two because spec 5's roles
  // table gives Supervisor/QA and Admin "View + limited reports" / "Full
  // dashboard access" while everyone else gets none — the "limited" part is
  // the per-operator duration breakdown (spec 4.2 flags operator comparison
  // as being for training/bottleneck spotting, "not punitive use", which
  // argues for keeping it out of the widest-audience view).
  | "dashboard.view"
  | "dashboard.viewOperatorMetrics";

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  admin: [
    "task.create",
    "task.assign",
    "task.updateOwn",
    "task.updateAny",
    "task.delete",
    "batch.create",
    "batch.updateProgress",
    "batch.release",
    "batch.delete",
    "team.manage",
    "rota.manage",
    "batchbook.create",
    "batchbook.editOwnDraft",
    "batchbook.confirm",
    "batchbook.editConfirmed",
    "mes.claim",
    "mes.pass",
    "dashboard.view",
    "dashboard.viewOperatorMetrics",
  ],
  production: [
    "task.updateOwn",
    "batch.updateProgress",
    "batchbook.create",
    "batchbook.editOwnDraft",
    "batchbook.confirm",
    "mes.claim",
    "mes.pass",
  ],
  qa: [
    "task.updateOwn",
    "task.create",
    "batch.updateProgress",
    "batch.release",
    "batchbook.create",
    "batchbook.editOwnDraft",
    "batchbook.confirm",
    "batchbook.editConfirmed",
    "mes.claim",
    "mes.pass",
    "dashboard.view",
    "dashboard.viewOperatorMetrics",
  ],
  // Nearest fit to spec 5's "Management/Sales/Internal staff" row — read-only
  // access with a dashboard view, no personnel-level detail (see the note on
  // the Capability union above).
  viewer: ["dashboard.view"],
};

export function roleCan(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/**
 * A department is just its name — `StaffMember.department` stores that name
 * directly rather than an id, so nothing else needs a lookup to display it.
 * The registry of known departments lives in its own collection
 * (`departmentCollection` in seed.ts) so an admin can create one with "Add
 * department" before anyone has been assigned to it.
 */
export type Department = string;

export interface DepartmentRecord extends Entity {
  name: string;
}

/** Seeds `departmentCollection` on first load. */
export const DEFAULT_DEPARTMENTS: Department[] = [
  "Production",
  "Quality Assurance",
  "Warehouse",
  "Engineering",
  "Regulatory",
  "Management",
];

export interface StaffMember extends Entity {
  name: string;
  initials: string;
  role: Role;
  jobTitle: string;
  department: Department;
  email: string;
  phone: string;
  /** Demo-only credential. Real deployments must never store passwords here. */
  demoPassword: string;
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export const TASK_STATUS: Record<TaskStatus, { label: string; order: number }> = {
  todo: { label: "To do", order: 0 },
  in_progress: { label: "In progress", order: 1 },
  blocked: { label: "Blocked", order: 2 },
  done: { label: "Done", order: 3 },
};

export const TASK_PRIORITY: Record<TaskPriority, { label: string; weight: number }> = {
  low: { label: "Low", weight: 0 },
  normal: { label: "Normal", weight: 1 },
  high: { label: "High", weight: 2 },
  critical: { label: "Critical", weight: 3 },
};

export interface Task extends Entity {
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** StaffMember id, or null when unassigned. */
  assigneeId: string | null;
  dueDate: string | null;
  /** Optional link to the batch this task supports. */
  batchId: string | null;
  /**
   * A date the assignee has asked to move the deadline to, awaiting a
   * manager's approval. Only someone with `task.updateAny` can change
   * `dueDate` directly or resolve this request.
   */
  requestedDueDate: string | null;
  /** Why the assignee is asking — shown to the manager alongside the request. */
  extensionReason: string | null;
  /**
   * ISO date (yyyy-MM-dd) the "due tomorrow" reminder was last sent for.
   * Prevents re-notifying every time the portal is reopened on the same day.
   */
  reminderSentFor: string | null;
}

/* -------------------------------------------------------------------------- */
/* Batch schedule                                                             */
/* -------------------------------------------------------------------------- */

export type BatchStatus =
  | "scheduled"
  | "in_production"
  | "qa_hold"
  | "released"
  | "cancelled";

export const BATCH_STATUS: Record<
  BatchStatus,
  { label: string; colorVar: string; bgVar: string; order: number }
> = {
  scheduled: {
    label: "Scheduled",
    colorVar: "var(--status-scheduled)",
    bgVar: "var(--status-scheduled-bg)",
    order: 0,
  },
  in_production: {
    label: "In production",
    colorVar: "var(--status-production)",
    bgVar: "var(--status-production-bg)",
    order: 1,
  },
  qa_hold: {
    label: "QA hold",
    colorVar: "var(--status-qa)",
    bgVar: "var(--status-qa-bg)",
    order: 2,
  },
  released: {
    label: "Released",
    colorVar: "var(--status-released)",
    bgVar: "var(--status-released-bg)",
    order: 3,
  },
  cancelled: {
    label: "Cancelled",
    colorVar: "var(--status-cancelled)",
    bgVar: "var(--status-cancelled-bg)",
    order: 4,
  },
};

/** Ascot manufactures both human and veterinary medicines. */
export type ProductLine = "human" | "veterinary";

export const PRODUCT_LINE: Record<ProductLine, { label: string; short: string }> = {
  human: { label: "Human medicine", short: "Human" },
  veterinary: { label: "Veterinary medicine", short: "Vet" },
};

/** Physical resources a batch occupies. Two batches cannot share one at once. */
export interface Resource {
  id: string;
  label: string;
  kind: "line" | "room" | "equipment";
  /** Liquids, Tablets and Capsules are run by separate teams that operate
   *  independently of one another — the schedule reserves each a permanent
   *  lane on every day, even when idle, so it's obvious at a glance which
   *  teams are running in parallel. */
  parallelLane?: boolean;
}

export const RESOURCES: Resource[] = [
  { id: "line-1", label: "Line 1 — Liquids", kind: "line", parallelLane: true },
  { id: "line-2", label: "Line 2 — Creams & ointments", kind: "line" },
  { id: "line-3", label: "Line 3 — Capsules", kind: "line", parallelLane: true },
  { id: "line-4", label: "Line 4 — Tablets", kind: "line", parallelLane: true },
  { id: "room-a", label: "Cleanroom A (Grade C)", kind: "room" },
  { id: "room-b", label: "Cleanroom B (Grade D)", kind: "room" },
  { id: "room-c", label: "Dispensary", kind: "room" },
  { id: "eq-mixer-1", label: "Vessel M1 — 500L", kind: "equipment" },
  { id: "eq-mixer-2", label: "Vessel M2 — 200L", kind: "equipment" },
  { id: "eq-fill-1", label: "Filler F1", kind: "equipment" },
  { id: "eq-blist-1", label: "Blister pack B1", kind: "equipment" },
];

export interface Batch extends Entity {
  batchNo: string;
  product: string;
  productLine: ProductLine;
  quantity: number;
  unit: string;
  /** ISO date (yyyy-MM-dd). */
  startDate: string;
  endDate: string;
  status: BatchStatus;
  lineId: string | null;
  roomId: string | null;
  equipmentId: string | null;
  /** StaffMember ids working the batch. */
  operatorIds: string[];
  /** StaffMember id of the QA owner. */
  qaOwnerId: string | null;
  /** Set when status becomes `released` — who signed it off and when. */
  releasedById: string | null;
  releasedAt: string | null;
  notes: string;
}

/* -------------------------------------------------------------------------- */
/* Shift rota                                                                 */
/* -------------------------------------------------------------------------- */

export type ShiftType = "early" | "late" | "night" | "holiday" | "absent";

export const SHIFT_TYPE: Record<
  ShiftType,
  { label: string; hours: string; colorVar: string; bgVar: string }
> = {
  early: {
    label: "Early",
    hours: "06:00 – 14:00",
    colorVar: "var(--status-production)",
    bgVar: "var(--status-production-bg)",
  },
  late: {
    label: "Late",
    hours: "14:00 – 22:00",
    colorVar: "var(--status-qa)",
    bgVar: "var(--status-qa-bg)",
  },
  night: {
    label: "Night",
    hours: "22:00 – 06:00",
    colorVar: "var(--brand-900)",
    bgVar: "var(--brand-100)",
  },
  holiday: {
    label: "Holiday",
    hours: "Booked leave",
    colorVar: "var(--status-released)",
    bgVar: "var(--status-released-bg)",
  },
  absent: {
    label: "Absent",
    hours: "Unplanned",
    colorVar: "var(--status-cancelled)",
    bgVar: "var(--status-cancelled-bg)",
  },
};

export interface ShiftEntry extends Entity {
  staffId: string;
  /** ISO date (yyyy-MM-dd). */
  date: string;
  shift: ShiftType;
}

/* -------------------------------------------------------------------------- */
/* Messaging                                                                  */
/* -------------------------------------------------------------------------- */

export interface Conversation extends Entity {
  /** Includes every participant, including whoever started it. */
  participantIds: string[];
  /** Custom name for a group conversation. Null shows participant names instead. */
  title: string | null;
  /** ISO timestamp of the most recent message — drives conversation ordering. */
  lastMessageAt: string;
  /** staffId -> ISO timestamp of when they last viewed this conversation. */
  lastReadAt: Record<string, string>;
  /**
   * staffIds who have pinned this to the top of their own conversation list.
   * Pinning is personal — one person pinning a shared conversation doesn't
   * pin it for anyone else.
   */
  pinnedBy: string[];
}

export interface Message extends Entity {
  conversationId: string;
  senderId: string;
  body: string;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export type NotificationType = "message" | "task" | "batch" | "mes";

export const NOTIFICATION_TYPE: Record<NotificationType, { label: string }> = {
  message: { label: "Message" },
  task: { label: "Task" },
  batch: { label: "Batch" },
  mes: { label: "MES pipeline" },
};

export interface AppNotification extends Entity {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Where selecting the notification should take the recipient. */
  href: string;
  read: boolean;
}
