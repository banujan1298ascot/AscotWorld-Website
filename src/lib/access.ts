/**
 * What each person may see and do. A role (src/lib/types.ts) gives the
 * starting set; an admin or manager can then change it per person on the
 * Team page — open a section the role doesn't have, hide one it does, give
 * an ability or take one away. Only the differences from the role are
 * stored (`StaffAccess`), so changing someone's role still moves them onto
 * that role's defaults, with their own exceptions kept on top.
 *
 * `staffCan` is the one check everything uses — the screens to show or hide
 * controls, the server to allow or refuse the request. Pure, so both import
 * it and it's unit-tested directly (access.test.ts).
 */
import { roleCan, type Capability, type Role } from "./types";

export interface StaffAccess {
  /** Abilities on top of the role's. */
  grant?: Capability[];
  /** Abilities the role has that this person doesn't. */
  revoke?: Capability[];
  /** Sections (module ids — src/modules/registry.ts) opened beyond the role's. */
  showSections?: string[];
  /** Sections hidden from this person. */
  hideSections?: string[];
}

export interface PersonWithAccess {
  role: Role;
  access?: StaffAccess | null;
}

export function staffCan(person: PersonWithAccess, capability: Capability): boolean {
  if (person.access?.revoke?.includes(capability)) return false;
  return roleCan(person.role, capability) || Boolean(person.access?.grant?.includes(capability));
}

/** Whether a section is open to them: the role's default, unless changed for them. */
export function sectionOpen(person: PersonWithAccess, sectionId: string, roleDefault: boolean): boolean {
  if (person.access?.hideSections?.includes(sectionId)) return false;
  return roleDefault || Boolean(person.access?.showSections?.includes(sectionId));
}

export function hasCustomAccess(access: StaffAccess | null | undefined): boolean {
  return Boolean(
    access && (access.grant?.length || access.revoke?.length || access.showSections?.length || access.hideSections?.length),
  );
}

/* -------------------------------------------------------------------------- */
/* What can be changed, by section                                             */
/* -------------------------------------------------------------------------- */

export interface AbilityInfo {
  capability: Capability;
  label: string;
}

/**
 * The abilities each section's page offers, in the words the access editor
 * shows. Every capability appears exactly once. The worksheet upload
 * permission isn't here: it's per person already (worksheet_editors), and
 * the editor shows it alongside these.
 */
export const SECTION_ABILITIES: Record<string, AbilityInfo[]> = {
  dashboard: [],
  tasks: [
    { capability: "task.create", label: "Create tasks" },
    { capability: "task.assign", label: "Assign tasks to other people" },
    { capability: "task.updateOwn", label: "Update their own tasks" },
    { capability: "task.updateAny", label: "Update anyone's tasks" },
    { capability: "task.delete", label: "Delete tasks" },
  ],
  schedule: [
    { capability: "batch.create", label: "Add batches to the schedule" },
    { capability: "batch.updateProgress", label: "Update a batch's progress" },
    { capability: "batch.release", label: "Release batches (QA sign-off)" },
    { capability: "batch.delete", label: "Delete scheduled batches" },
  ],
  "batch-book": [
    { capability: "batchbook.create", label: "Enter new batches" },
    { capability: "batchbook.editOwnDraft", label: "Edit their own drafts" },
    { capability: "batchbook.confirm", label: "Confirm batches (assigns the number)" },
    { capability: "batchbook.editConfirmed", label: "Edit confirmed batches" },
  ],
  mes: [
    { capability: "mes.claim", label: "Claim batches and be assigned them" },
    { capability: "mes.pass", label: "Pass, send back and assign batches" },
  ],
  reports: [
    { capability: "dashboard.view", label: "See production figures and reports" },
    { capability: "dashboard.viewOperatorMetrics", label: "See each operator's timings" },
  ],
  worksheets: [],
  messages: [],
  notifications: [],
  team: [
    { capability: "rota.manage", label: "Change the rota" },
    { capability: "team.manage", label: "Manage users, their access and departments" },
  ],
};

const CAPABILITIES = new Set(Object.values(SECTION_ABILITIES).flatMap((list) => list.map((a) => a.capability)));

/**
 * The overrides that turn a role's defaults into what's wanted: `can` and
 * `open` are the full sets the person should end up with.
 */
export function accessFor(
  role: Role,
  can: ReadonlySet<Capability>,
  open: ReadonlySet<string>,
  roleOpens: (sectionId: string) => boolean,
  sectionIds: readonly string[],
): StaffAccess | null {
  const caps = [...CAPABILITIES];
  const access: StaffAccess = {
    grant: caps.filter((c) => can.has(c) && !roleCan(role, c)),
    revoke: caps.filter((c) => !can.has(c) && roleCan(role, c)),
    showSections: sectionIds.filter((id) => open.has(id) && !roleOpens(id)),
    hideSections: sectionIds.filter((id) => !open.has(id) && roleOpens(id)),
  };
  for (const key of Object.keys(access) as (keyof StaffAccess)[]) if (!access[key]?.length) delete access[key];
  return hasCustomAccess(access) ? access : null;
}

/**
 * Keeps only what an access record may hold — known abilities, sensible
 * section ids — whatever a client sent. Null when nothing is left.
 */
export function cleanAccess(value: unknown): StaffAccess | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const list = <T extends string>(field: unknown, keep: (item: string) => boolean): T[] =>
    Array.isArray(field) ? ([...new Set(field.filter((x): x is string => typeof x === "string" && keep(x)))] as T[]) : [];
  const sectionId = (s: string) => /^[a-z0-9-]{1,40}$/.test(s);
  const access: StaffAccess = {
    grant: list<Capability>(raw.grant, (c) => CAPABILITIES.has(c as Capability)),
    revoke: list<Capability>(raw.revoke, (c) => CAPABILITIES.has(c as Capability)),
    showSections: list(raw.showSections, sectionId),
    hideSections: list(raw.hideSections, sectionId),
  };
  for (const key of Object.keys(access) as (keyof StaffAccess)[]) if (!access[key]?.length) delete access[key];
  return hasCustomAccess(access) ? access : null;
}
