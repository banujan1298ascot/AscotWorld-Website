import {
  Bell,
  BookOpen,
  CalendarBlank,
  ChartLineUp,
  ChatCircleDots,
  FileText,
  Flask,
  ListChecks,
  SquaresFour,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
// Type-only import from the package root — erased at compile time, so it does
// not pull in the icon barrel at runtime.
import type { Icon } from "@phosphor-icons/react";
import { sectionOpen, type PersonWithAccess } from "@/lib/access";
import type { Role } from "@/lib/types";

/* ============================================================================
 * MODULE REGISTRY — the extension point of the portal
 * ----------------------------------------------------------------------------
 * This file is the single source of truth for what sections exist, where they
 * live, who may see them and how they are ordered.
 *
 * The sidebar, the mobile navigation, the dashboard shortcuts and the route
 * guard all read from this list. Nothing else hard-codes a section.
 *
 * ── TO ADD A NEW SECTION LATER ─────────────────────────────────────────────
 *   1. Create the page:   src/app/(portal)/<your-route>/page.tsx
 *   2. Add one entry to MODULES below.
 *   3. There is no step 3 — navigation, ordering and permissions follow.
 *
 * Nothing already built needs to be touched, which is the point: sections are
 * additive. To temporarily hide a section, set `enabled: false` rather than
 * deleting it.
 * ========================================================================= */

export type ModuleGroup = "operations" | "communication" | "people" | "admin";

export const MODULE_GROUPS: Record<ModuleGroup, { label: string; order: number }> = {
  operations: { label: "Operations", order: 0 },
  communication: { label: "Communication", order: 1 },
  people: { label: "People", order: 2 },
  admin: { label: "Administration", order: 3 },
};

export interface PortalModule {
  /** Stable identifier — never reuse one. */
  id: string;
  /** Shown in navigation. Keep it short; it sits in a narrow sidebar. */
  label: string;
  /** One line, shown on the dashboard card and as the nav tooltip. */
  description: string;
  /** Route path, relative to the site root. */
  href: string;
  /** Phosphor icon component (imported from the /ssr entry point). */
  icon: Icon;
  /**
   * Roles allowed to open this section. Use "all" for everyone signed in.
   * The route guard and the navigation both honour this.
   */
  roles: Role[] | "all";
  group: ModuleGroup;
  /** Lower numbers sort first within a group. */
  order: number;
  /** Set false to hide a section without removing its code. */
  enabled: boolean;
  /** Show on the dashboard as a shortcut card. */
  showOnDashboard: boolean;
  /**
   * Include in the mobile bottom nav, which is capped at five destinations
   * (see `bottomNavForRole`). A module can still be reached on mobile another
   * way — Notifications, for instance, sits behind the bell icon in the top
   * bar instead of taking a tab — so set this to false rather than trying to
   * squeeze more than five tabs in.
   */
  showInBottomNav: boolean;
}

export const MODULES: PortalModule[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Today at a glance — what's running, what's due and what needs attention.",
    href: "/dashboard",
    icon: SquaresFour,
    roles: "all",
    group: "operations",
    order: 0,
    enabled: true,
    showOnDashboard: false,
    showInBottomNav: true,
  },
  {
    id: "tasks",
    label: "Task planner",
    description: "Assign, track and complete work across the site.",
    href: "/tasks",
    icon: ListChecks,
    roles: "all",
    group: "operations",
    order: 1,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: true,
  },
  {
    id: "schedule",
    label: "Batch schedule",
    description: "Production calendar with line, room and QA release status.",
    href: "/schedule",
    icon: CalendarBlank,
    roles: "all",
    group: "operations",
    order: 2,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: true,
  },
  {
    id: "batch-book",
    label: "Batch Book",
    description: "Log and confirm batches — the source of truth ahead of the MES pipeline.",
    href: "/batch-book",
    icon: BookOpen,
    roles: "all",
    group: "operations",
    order: 3,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: false,
  },
  {
    id: "mes",
    label: "MES pipeline",
    description: "Claim, check and move confirmed batches through Check 1-6 and Warehouse — as a board or a table.",
    href: "/mes",
    icon: Flask,
    roles: "all",
    group: "operations",
    order: 4,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: false,
  },
  {
    id: "reports",
    label: "Production reports",
    description: "Bottlenecks, stage timing, rework rates and a CSV export for compliance reporting.",
    href: "/reports",
    icon: ChartLineUp,
    // Spec 5's Dashboard column: Admin gets full access, Supervisor/QA gets
    // reports, Normal user/Stage Operator gets none. "viewer" is this app's
    // nearest fit to "Management/Sales/Internal staff", who do get a
    // (summary) dashboard view — see the Capability union in lib/types.ts.
    roles: ["admin", "qa", "viewer"],
    group: "operations",
    order: 5,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: false,
  },
  {
    id: "worksheets",
    label: "Worksheets",
    description: "Approved and archived worksheets (BMRs) for every product.",
    href: "/worksheets",
    icon: FileText,
    // Everyone can view and download; uploading and moving them is for the
    // people an admin gives access to — checked per person, not by role (see
    // src/server/worksheets/validation.ts).
    roles: "all",
    group: "operations",
    order: 6,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: false,
  },
  {
    id: "messages",
    label: "Messages",
    description: "Direct messages with anyone on site — this is where work conversations belong.",
    href: "/messages",
    icon: ChatCircleDots,
    roles: "all",
    group: "communication",
    order: 0,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: true,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Updates on tasks, batches and messages that need your attention.",
    href: "/notifications",
    icon: Bell,
    roles: "all",
    group: "communication",
    order: 1,
    enabled: true,
    showOnDashboard: false,
    // Reached via the bell icon in the top bar instead — see the note on
    // `showInBottomNav` above.
    showInBottomNav: false,
  },
  {
    id: "team",
    label: "Team & rota",
    description: "Staff directory, contact details and the weekly shift rota.",
    href: "/team",
    icon: UsersThree,
    roles: "all",
    group: "people",
    order: 0,
    enabled: true,
    showOnDashboard: true,
    showInBottomNav: true,
  },

  /* ---------------------------------------------------------------------- *
   * Add future sections here. For example:
   *
   *   {
   *     id: "documents",
   *     label: "Documents",
   *     description: "SOPs, batch records and specifications.",
   *     href: "/documents",
   *     icon: FolderOpen,
   *     roles: "all",
   *     group: "operations",
   *     order: 3,
   *     enabled: true,
   *     showOnDashboard: true,
   *     showInBottomNav: true,
   *   },
   *
   *   {
   *     id: "deviations",
   *     label: "Deviations & CAPA",
   *     description: "Quality incidents raised against a batch.",
   *     href: "/deviations",
   *     icon: Warning,
   *     roles: ["admin", "qa"],       // restricted section
   *     group: "operations",
   *     order: 4,
   *     enabled: true,
   *     showOnDashboard: true,
   *     showInBottomNav: true,
   *   },
   * ---------------------------------------------------------------------- */
];

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** Whether the role opens this section by default — before any change
 *  made for one person on the Team page. */
export function roleOpensModule(module: PortalModule, role: Role): boolean {
  return module.roles === "all" || module.roles.includes(role);
}

/** Whether this person may open the section: their role's default, unless
 *  it's been opened or hidden for them (src/lib/access.ts). */
export function canAccessModule(module: PortalModule, person: PersonWithAccess): boolean {
  if (!module.enabled) return false;
  return sectionOpen(person, module.id, roleOpensModule(module, person.role));
}

/** Every module this person may open, in display order. */
export function modulesForRole(person: PersonWithAccess): PortalModule[] {
  return MODULES.filter((m) => canAccessModule(m, person)).sort(
    (a, b) =>
      MODULE_GROUPS[a.group].order - MODULE_GROUPS[b.group].order ||
      a.order - b.order,
  );
}

/** Up to five destinations for the mobile bottom nav, in display order. */
export function bottomNavForRole(person: PersonWithAccess): PortalModule[] {
  return modulesForRole(person)
    .filter((m) => m.showInBottomNav)
    .slice(0, 5);
}

/** Modules grouped for the sidebar, skipping groups this role cannot see. */
export function groupedModulesForRole(
  person: PersonWithAccess,
): Array<{ group: ModuleGroup; label: string; modules: PortalModule[] }> {
  const available = modulesForRole(person);
  return (Object.keys(MODULE_GROUPS) as ModuleGroup[])
    .sort((a, b) => MODULE_GROUPS[a].order - MODULE_GROUPS[b].order)
    .map((group) => ({
      group,
      label: MODULE_GROUPS[group].label,
      modules: available.filter((m) => m.group === group),
    }))
    .filter((section) => section.modules.length > 0);
}

/**
 * Where a staff member lands after signing in, or on opening the portal with
 * a session already going.
 *
 * A station account pinned to an MES stage goes straight to its own work
 * rather than the general dashboard — that's the whole point of a station
 * login. Stage 1 (Batch Book Entry) has no queue of its own, so it lands in
 * the Batch Book instead.
 */
export function homeRouteFor(staff: { mesStage?: number | null } & Partial<PersonWithAccess>): string {
  const preferred = staff.mesStage == null ? "/dashboard" : staff.mesStage === 1 ? "/batch-book" : "/mes";
  if (!staff.role) return preferred;
  // Somewhere they can actually open, if that's been hidden from them.
  const open = modulesForRole({ role: staff.role, access: staff.access });
  return open.some((m) => m.href === preferred) ? preferred : (open[0]?.href ?? preferred);
}

/** Resolve the module owning a pathname, for active-state and guarding. */
export function moduleForPath(pathname: string): PortalModule | undefined {
  return MODULES.filter((m) => pathname === m.href || pathname.startsWith(`${m.href}/`))
    // Prefer the most specific match if routes ever nest.
    .sort((a, b) => b.href.length - a.href.length)[0];
}
