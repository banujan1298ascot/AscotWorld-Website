# AscotWorld Staff Portal

Internal portal for the AscotWorld facility in Borehamwood, Hertfordshire — task
planning, batch scheduling and shift rota for a pharmaceutical manufacturing site.

Built with Next.js 16, TypeScript and Tailwind CSS 4.

---

## Running it

```bash
npm run dev
```

Then open <http://localhost:3000>.

> **Note:** Node is installed at `C:\Program Files\nodejs` but isn't always on the
> PATH in every shell. If `npm` isn't found, either open a fresh terminal or call
> it by full path: `& "C:\Program Files\nodejs\npm.cmd" run dev`.

Other commands:

```bash
npm run build
```

```bash
npm run lint
```

---

## Signing in

This is a **demonstration build**. Accounts live in seed data and every one uses
the password `demo1234`. The login screen has one-click buttons for each role.

| Account | Role | What they can do |
| --- | --- | --- |
| Priya Raman | Admin / Manager | Everything — schedule batches, assign work, edit the rota |
| Daniel Okafor | Production operator | Update their own tasks and batch progress |
| Aisha Bello | QA / Quality | Release batches with sign-off, raise tasks |
| Helen Voss | Read-only / Viewer | View everything, change nothing |

**Reset demo data** in the sidebar restores the original sample data. It keeps you
signed in and keeps your theme.

---

## What's in it

- **Dashboard** — what's running today, what's assigned to you, open/overdue counts,
  and a warning if any batch is double-booked.
- **Task planner** — board across To do / In progress / Blocked / Done, filterable by
  assignee and priority, linkable to a batch. Only a manager (`task.updateAny`) can
  change a task's deadline; everyone else can **Request extension** instead, which
  notifies every manager and shows an Approve/Decline banner on the task until it's
  resolved. Anyone due tomorrow gets a **Due tomorrow** reminder — see the note on
  reminders below.
- **Batch schedule** — Monday–Saturday week view over business hours (07:00–19:00).
  Each day is a column showing the product being made; Liquids, Tablets and Capsules
  run independently of one another, so each always gets its own lane in every day's
  column — idle or not — with any batch on another line (e.g. Creams & ointments)
  appended alongside. A red line tracks the actual current time — visible only on the
  week that contains today, and only during business hours — moving as the clock does
  (checked every minute). Anyone who can create or progress a batch can drag its card
  to a different day to reschedule it, shifting its whole date range and keeping its
  duration. Records batch number, product, quantity, dates, production line, room,
  equipment, operators, QA owner, human vs veterinary, and QA release sign-off. Warns
  when two batches claim the same line, room or vessel at the same time.
- **Team & rota** — staff directory grouped by department, plus a weekly shift rota
  managers can edit by clicking a cell to cycle Early → Late → Night → Holiday → Absent.
  Admin/Manager accounts get two extra actions here: **Add department** (register a
  department before anyone's in it yet) and **Add employee** (create a real account —
  the new person can sign in immediately with the password set for them).
- **Messages** — direct messages (1:1 or group) with anyone on site. Everyone can
  message everyone; there's no permission gate on this one, since the point is that
  work conversations happen here instead of scattered elsewhere. "New message" opens
  with an explicit **Direct message / Group** toggle — direct message is a single
  pick, group requires at least two people and gets an optional name. A search box
  in the recipient picker filters by name, role or department. Any conversation can
  be **pinned** to the top of the list (the pin icon on each row) — pinning is
  personal, so one person pinning a shared thread doesn't pin it for anyone else.
- **Notifications** — a bell icon in the top bar (every page, every screen size) plus
  a full history at `/notifications`. Fires automatically when: someone sends you a
  message, a task is assigned to you, or a batch you're on moves to QA hold or gets
  released. Selecting a notification jumps straight to the relevant task, batch or
  conversation and marks it read.

---

## Adding a new section later

This was designed so new sections are **additive** — you never have to modify what's
already built.

Everything about navigation, ordering and permissions is driven by one file:
[`src/modules/registry.ts`](src/modules/registry.ts).

**Two steps:**

1. Create the page at `src/app/(portal)/<your-route>/page.tsx`
2. Add one entry to the `MODULES` array:

```ts
{
  id: "documents",
  label: "Documents",
  description: "SOPs, batch records and specifications.",
  href: "/documents",
  icon: FolderOpen,          // any Phosphor icon
  roles: "all",              // or e.g. ["admin", "qa"] to restrict it
  group: "operations",       // operations | communication | people | admin
  order: 3,
  enabled: true,
  showOnDashboard: true,
  showInBottomNav: true,     // false if it should live elsewhere on mobile
}
```

The sidebar, the mobile bottom navigation, the dashboard shortcut cards and the
access guard all read from that list. There is no third step.

To hide a section temporarily, set `enabled: false` rather than deleting it.

The mobile bottom nav is capped at five destinations (`bottomNavForRole` in the
registry). Notifications opts out with `showInBottomNav: false` and is reached via
the bell icon in the top bar instead — that's the pattern to follow if the registry
ever grows past five: give the extra section another entry point rather than
cramming a sixth tab in.

**Unread badges** (the small count next to Messages and Notifications in the
sidebar, and the dot on the mobile tab) come from `useModuleBadges` in
[`(portal)/layout.tsx`](src/app/(portal)/layout.tsx). It calls a fixed set of
unread-count hooks every render — rules of hooks means this can't be data-driven
off the registry, so a new badge-bearing module needs one added line there. Two
lines, in practice: the hook call and the id it maps to.

### Storing data for a new section

Define your record type extending `Entity`, then create a collection:

```ts
// src/lib/seed.ts
export const documentCollection = createCollection<Document>("documents", documentSeed);
```

Use it in a component:

```tsx
const { items, ready } = useCollection(documentCollection);

documentCollection.create({ ... });
documentCollection.update(id, { ... });
documentCollection.remove(id);
```

Any component reading that collection re-renders automatically when it changes.

### Permissions for a new section

Add a capability to the `Capability` union in [`src/lib/types.ts`](src/lib/types.ts),
then grant it to roles in `ROLE_CAPABILITIES`. In your UI, check the capability —
never the role:

```tsx
const { can } = useAuth();
if (can("document.publish")) { /* show the control */ }
```

That way changing what a role can do is one edit in one table, not a hunt across screens.

---

## Before this handles real staff data

This build stores everything in the browser (`localStorage`) and has **no real
authentication**. It is a working prototype for agreeing the design and the flows,
not a production system. Two things must change first:

**1. Real storage.** Everything goes through `StorageAdapter` in
[`src/lib/storage.ts`](src/lib/storage.ts). Write one object satisfying that
interface — fetch calls against your API — and assign it to `activeAdapter`. No page
or component changes, because nothing else touches storage directly.

**2. Real authentication.** [`src/lib/auth.tsx`](src/lib/auth.tsx) checks a password
held in seed data, which is not secure by any measure. Keep the public shape of
`useAuth()` (`user` / `signIn` / `signOut` / `can`) and swap the internals for a
proper provider. Every screen already gates on capabilities rather than reading the
session, so they won't need touching.

Also worth doing before real use: server-side enforcement of permissions (the current
checks are client-side only and are about clarity, not security), an audit trail for
GMP-relevant actions such as batch release, and a backup strategy.

**3. Real reminders.** There's no server here, so nothing can run in the background
at a fixed time — the "due tomorrow" task reminder ([`src/lib/reminders.ts`](src/lib/reminders.ts))
checks the signed-in user's tasks whenever the portal is open and sends the reminder
the first time it sees one due tomorrow that day. It's a reasonable approximation for
a demo, but it only fires while someone has the portal open — a real deployment needs
an actual scheduled job (e.g. a daily cron hitting an API route) to notify people who
haven't logged in.

---

## Design

Brand values were taken from the live Ascot Laboratories site rather than guessed:

| Token | Value |
| --- | --- |
| Brand blue | `#3A6DD6` |
| Brand navy | `#022166` |
| Signature gradient | `linear-gradient(90deg, #3A6DD6, #022166)` |
| Typeface | Manrope |
| Body text | `#1E1E1E` |

The molecular cluster that replaces the "o" in the Ascot logo is the motif the
interface is built around — it appears in the wordmark, the compact mark and empty
states. The wordmark is rebuilt as vector ([`src/components/Logo.tsx`](src/components/Logo.tsx))
so it stays sharp and re-tones for dark mode; the original raster logo is kept in
`public/brand/` for print and external use.

Light and dark themes are both first-class — dark mode is a deliberate navy-derived
re-tone, not an inversion. Status is never carried by colour alone: every status
carries an icon and a text label.

---

## Layout

```
src/
  app/
    layout.tsx              root layout — fonts, theme, auth providers
    page.tsx                redirects to dashboard or login
    login/                  sign-in screen
    (portal)/
      layout.tsx            portal shell — sidebar, top bar, bottom nav, access guard, badges
      dashboard/            today's overview
      tasks/                task planner board
      schedule/             batch calendar
      team/                 directory + shift rota
      messages/             conversations + thread view
      notifications/        full notification history
      batch-book/           Batch Book — draft, confirm, edit (see docs/batch-book-api.md)
      mes/                  MES pipeline board — claim/forward/back/fail (see docs/mes-api.md)
      reports/              production dashboard — metrics + CSV export (see docs/dashboard-api.md)
    api/
      batch-book/           Batch Book REST endpoints (real Postgres, not browser storage)
      departments/          department picker endpoint
      mes/                  MES pipeline REST endpoints + dashboard/export
  components/
    Logo.tsx                AscotWorld wordmark and compact mark
    ui.tsx                  buttons, cards, fields, modal, empty states
    domain.tsx              status pills, priority tags, staff chips, due dates
  lib/
    types.ts                domain model, roles, capabilities
    storage.ts              swappable persistence + React binding
    seed.ts                 demo data and collections (staff, departments, batches, tasks…)
    auth.tsx                demo authentication
    theme.tsx               light/dark theme
    schedule.ts             calendar layout + double-booking detection
    messaging.ts            conversations, sending, unread state
    notifications.ts        push/read notifications, unread counts
    batchBook.ts            client-side fetch layer for the Batch Book API
    apiClient.ts            shared fetch helper (x-staff-id header) for both
    mes.ts                  client-side fetch layer for the MES pipeline API
    mesAlerts.ts             new-arrival detection -> sound + in-app notification
    soundAlerts.ts           Web Audio chimes, autoplay unlock, mute preference
    dashboard.ts             client-side fetch layer for the production dashboard
  modules/
    registry.ts             ← add new sections here
  server/
    db/                     Drizzle schema, migrations, seed, DB client
    batch-book/             numbering, audit trail, validation, DB orchestration
    mes/                    claim/forward/send-back/fail state machine, validation
    dashboard/              production metrics queries (raw SQL) + CSV formatting
    auth/                   server-side staff lookup + capability guard for API routes
    apiError.ts             shared HTTP error type for route handlers
    actingStaff.ts          shared ActingStaff type used across server modules
```

Batch Book, the MES pipeline, and the production dashboard (schema, API,
how to run migrations/tests) are documented in
[`docs/batch-book-api.md`](docs/batch-book-api.md),
[`docs/mes-api.md`](docs/mes-api.md),
[`docs/dashboard-api.md`](docs/dashboard-api.md), and
[`docs/specs/MES_BatchBook_Design_Spec.md`](docs/specs/MES_BatchBook_Design_Spec.md).
