# Batch Book — API & schema reference

Phase 1 of [`docs/specs/MES_BatchBook_Design_Spec.md`](specs/MES_BatchBook_Design_Spec.md): the
Batch Book itself (draft → confirm, sequential numbering, audit trail). Phase
2 (the Check 2-6 + Warehouse claim/drag pipeline) is documented separately in
[`docs/mes-api.md`](mes-api.md) — read that too, since confirming a batch now
also hands it straight into Phase 2's pipeline (see the confirm endpoint
below). Notifications, dashboard/RBAC and historical import are still later
phases and are not built yet.

This is the first part of the portal backed by a real database instead of
browser storage — see [`README.md`](../README.md#design) for how the rest of
the app persists data, and the note below on the auth trust boundary before
you point this at anything real.

---

## Setup

```bash
docker compose up -d          # local Postgres (see docker-compose.yml)
cp .env.example .env          # DATABASE_URL already points at that container
npm run db:migrate            # applies drizzle/0000_init_mes_batchbook.sql
npm run db:seed               # mirrors the demo staff + creates the Bespoke department
npm test                      # unit tests always run; DATABASE_URL also
                               # enables the integration suite (see Testing)
```

`npm run db:generate` regenerates migrations from the schema in
`src/server/db/schema/` after you change it — don't hand-edit files under
`drizzle/`. `npm run db:studio` opens Drizzle Studio against `DATABASE_URL`
for poking at data directly.

---

## ⚠️ Auth is still a demo — read this before wiring up a client

Real auth (`src/lib/auth.tsx`) is a browser-storage session with no server
verification, exactly as already documented there. Every route below trusts
an `x-staff-id` header the client sends — there is no signature, token, or
password check proving the request came from that staff member. Anyone with
devtools can change the header and act as someone else.

This is acceptable for the same reason the rest of the demo auth is: a
working prototype for agreeing the design and the flows, not a production
deployment. See `src/server/auth/requireStaff.ts` for exactly where this
would change to a real session once one exists — every route already calls
through that one function.

A companion `staff` table now exists in Postgres purely so `created_by` /
`confirmed_by` / `changed_by` have something real to point a foreign key at
— it's a mirror of the ids in `src/lib/seed.ts`, not a real user/auth table.

---

## Schema

Full column-level comments live in the schema files themselves
(`src/server/db/schema/*.ts`) — this is the shape, not a restatement.

| Table | Purpose |
|---|---|
| `staff` | Mirror of demo staff identities, for FK attribution only (see above). |
| `departments` | Top-level pipeline owner (e.g. "Bespoke"). Seeded with just Bespoke so far. |
| `stage_definitions` | One pipeline stage per department — see [`docs/mes-api.md`](mes-api.md). Bespoke's 7 stages are seeded by `db:seed`. |
| `batch_records` | The Batch Book itself — draft → confirmed → moves through Phase 2's pipeline. |
| `batch_counters` | Backing store for atomic sequential numbering (spec 2.3) — not user-facing. |
| `reason_codes` | Admin-managed dropdown for stage transition reasons (spec 3.2) — starts empty; see [`docs/mes-api.md`](mes-api.md). |
| `stage_transitions` | One batch's visit to one stage — see [`docs/mes-api.md`](mes-api.md). |
| `audit_log_entries` | Insert-only field-level edit history for `batch_records`. |

Two things worth knowing that aren't obvious from a column list:

- **Numbering is atomic via `INSERT ... ON CONFLICT DO UPDATE`** on
  `batch_counters`, not `SELECT ... FOR UPDATE` — see the comment in
  `src/server/batch-book/numbering.ts` for why the more obvious
  select-then-lock approach still races on a counter row's first-ever
  creation and the upsert doesn't.
- **Stage 1 ("Batch Book Entry") has no claim/drag screen of its own** — the
  confirm action *is* stage 1's work (spec 3.0 lists "batch confirmed" as
  part of it). So confirming a batch auto-closes a stage-1 transition
  (attributed to whoever created the draft, spanning from its creation to
  confirmation) and dispatches straight into stage 2's Incoming queue —
  status becomes `IN_PROGRESS`, not `CONFIRMED`. This only happens if the
  department has stages 1 and 2 configured; Bespoke does after `db:seed`,
  but a department with no stages yet leaves the batch `CONFIRMED` with no
  current stage, same as before Phase 2 existed.
- **M-type batches never dispatch, regardless of department** (clarified
  2026-09-15, after Phase 4): Bespoke's Check 1-6 + Warehouse pipeline is
  for other batch types only — M needs its own, separately-designed MES
  that doesn't exist yet. `confirmBatch` special-cases `batchType === "M"`
  to skip the dispatch entirely (no stage-1 transition, no current stage),
  even in a department whose stages 1 and 2 *are* configured. An M batch
  still gets numbered and moves to `CONFIRMED` exactly like any other type
  — it just stops there until the batch department's MES exists. See
  `src/server/mes/service.integration.test.ts` for the test proving this
  holds even where a real pipeline exists to (wrongly) dispatch into.

---

## Endpoints

All requests: header `x-staff-id: <staff id>` (e.g. `staff_admin`, see
`src/lib/seed.ts` for the full demo list). JSON bodies/responses throughout.

### `GET /api/batch-book?status=<STATUS>`
Lists batches, optionally filtered by status (`DRAFT` | `CONFIRMED` |
`IN_PROGRESS` | `COMPLETED` | `ON_HOLD` | `FAILED`). No capability beyond
being a known staff id — viewing isn't gated, matching every other module.

→ `200 { batches: BatchRecord[] }`

### `POST /api/batch-book`
Creates a draft. Requires `batchbook.create`.

Body:
```jsonc
{
  "batchType": "A",            // "A" | "B" | "C" | "D" | "M" — required
  "departmentId": "uuid",      // required
  "productName": "…",          // optional, editable later
  "quantity": "100",           // optional, numeric-as-string
  "unit": "bottles",           // optional
  "plannedManufactureDate": "2026-06-01"  // optional, YYYY-MM-DD
}
```
→ `201 { batch: BatchRecord }` — `status: "DRAFT"`, `batchNumber: null`.

### `GET /api/batch-book/:id`
→ `200 { batch: BatchRecord }` or `404` if unknown.

### `PATCH /api/batch-book/:id`
Edits a batch. Behaviour depends on its status:

- **Draft**: the creator (or `admin`) may edit any field, no reason needed.
  Requires `batchbook.editOwnDraft`.
- **Confirmed/anything else**: requires `batchbook.editConfirmed` **and** a
  non-empty `reason` — every changed field is written to
  `audit_log_entries` with that reason attached. `batchType`,
  `departmentId`, `batchNumber`, `batchSequence`, `status`, `createdBy`,
  `createdAt`, `confirmedBy`, `confirmedAt` are immutable once confirmed
  (`422` if the patch touches any of them).

Body:
```jsonc
{
  "patch": { "productName": "Corrected name", "quantity": "120" },
  "reason": "Typo fixed after QA review"   // required once confirmed
}
```
→ `200 { batch: BatchRecord }` · `403` (permission) · `422` (immutable field
touched, or missing reason).

### `POST /api/batch-book/:id/confirm`
Atomically assigns the batch number (spec 2.3), closes out stage 1, and
dispatches the batch into stage 2's Incoming queue (see the schema note
above) — `status` becomes `IN_PROGRESS`, not `CONFIRMED`, when the
department has a pipeline configured. Restricted to the draft's creator or
`admin`; requires `batchbook.confirm`. Writes one audit entry per field that
changed (`batchNumber`, `batchSequence`, `status`, `confirmedBy`,
`confirmedAt`, `currentStageId`, `currentStageArrival`).

→ `200 { batch: BatchRecord }` · `403` · `409`-shaped `403` if not a draft
(message: "Only a draft can be confirmed.").

### `GET /api/departments`
Active departments, for pickers. No capability beyond being signed in.

→ `200 { departments: { id, name }[] }`

### Errors
Every route returns `{ error: string }` with one of `400` (bad filter),
`401` (missing/unknown `x-staff-id`), `403` (capability/ownership), `404`,
`422` (validation), `500`.

---

## Capabilities

Added to the existing capability table in `src/lib/types.ts` (not new
top-level roles):

| Capability | admin | production | qa | viewer |
|---|---|---|---|---|
| `batchbook.create` | ✓ | ✓ | ✓ | |
| `batchbook.editOwnDraft` | ✓ | ✓ | ✓ | |
| `batchbook.confirm` | ✓ | ✓ | ✓ | |
| `batchbook.editConfirmed` | ✓ | | ✓ | |

`admin` additionally bypasses the "own draft only" ownership check for edit
and confirm. This mapping is a reasonable reading of spec section 5's roles
table onto this app's existing 4 roles (there's no literal "Normal user
(data entry)" role here) — revisit if that reading doesn't match how the
site actually assigns roles.

---

## Testing

```
src/server/batch-book/numbering.test.ts       # pure — label formatting, year rollover
src/server/batch-book/audit.test.ts           # pure — field diffing for the audit trail
src/server/batch-book/validation.test.ts      # pure — permission/reason/immutable-field rules
src/server/batch-book/service.integration.test.ts   # real Postgres, gated on DATABASE_URL
```

`npm test` always runs the first three (31 assertions, no database needed).
The integration file is skipped with a console warning unless `DATABASE_URL`
is set — it proves, against a real database, that:

1. **Ten concurrent confirmations of the same batch type never collide** —
   the actual concern in spec 2.3. This can't be honestly tested without
   real Postgres locking, so it isn't mocked.
2. Confirming a batch writes the expected audit entries.
3. A supervisor edit to a confirmed record is refused without a reason and
   logged with it once given.
4. An edit touching an immutable field (e.g. `batchType`) is refused.

**This environment had no Docker/Postgres available, so the integration
suite has been written and type-checked but not actually executed here.**
Run it yourself with the Setup steps above before relying on it — the unit
tests, build, and lint all pass in this environment and were verified here.
