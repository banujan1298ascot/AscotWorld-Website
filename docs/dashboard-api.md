# Production dashboard — API reference

Phase 4 of [`docs/specs/MES_BatchBook_Design_Spec.md`](specs/MES_BatchBook_Design_Spec.md):
the dashboard/reporting metrics from spec 4, and the access-control read of
spec 5's roles table that decides who can see them. Read
[`docs/batch-book-api.md`](batch-book-api.md) and
[`docs/mes-api.md`](mes-api.md) first — every metric here is computed from
those two phases' tables (`batch_records`, `stage_transitions`).

Same setup and auth trust boundary (`x-staff-id` header) as the earlier
phases.

---

## Reading spec 5's roles table onto this app's 4 roles

Spec 5 gives the dashboard column as: Normal user/Stage Operator — none;
Supervisor/QA — "view + limited reports"; Admin/Plant Manager — full;
Management/Sales/Internal staff — view (order status, throughput). This
app's roles are `admin` / `production` / `qa` / `viewer`, so the mapping
taken here is:

| This app's role | Spec row | Dashboard access |
|---|---|---|
| `admin` | Admin/Plant Manager | Full — every metric, including per-operator breakdown |
| `qa` | Supervisor/QA | Full, same as admin (see below for why) |
| `viewer` | Management/Sales/Internal staff | Summary only — no per-operator breakdown |
| `production` | Normal user / Stage Operator | None |

The one judgment call: spec 4.2 frames the per-operator duration breakdown
as being "for spotting training needs or bottlenecks... not punitive use."
QA has a legitimate training/quality-oversight interest in that data, so it
gets the same access as admin rather than the trimmed view — `viewer` (the
nearest fit to an external/stakeholder audience) does not. This is a
reading of an underspecified point, not something the spec states outright
— revisit if it doesn't match how the site actually assigns responsibility.

---

## Capabilities

Two new ones in `src/lib/types.ts`:

| Capability | admin | qa | viewer | production |
|---|---|---|---|---|
| `dashboard.view` | ✓ | ✓ | ✓ | |
| `dashboard.viewOperatorMetrics` | ✓ | ✓ | | |

The route (not just the page) enforces the second one: `operatorStageDurations`
is omitted from the JSON response entirely for a caller without it, not
merely hidden by the client — see `src/app/api/mes/dashboard/route.ts`.

---

## How the metrics are computed

Every batch/stage metric is derived — nothing new is written on confirm,
claim, forward, etc.; Phase 1/2's tables are the only source of truth:

- **A batch "completes"** the instant it's forwarded out of the last stage
  (Warehouse) — the `stage_transitions` row for that has
  `outcome = 'FORWARD'` and `destination_stage_id IS NULL`. That row's
  `completed_at` is the completion timestamp used everywhere below (there is
  no `completed_at` column on `batch_records` itself).
- **A batch "fails"** at the `stage_transitions` row with
  `outcome = 'FAILED'`.
- **Stage duration** reads directly from `stage_transitions.duration`, the
  generated `completed_at - received_at` column from Phase 1's schema.
- **Cycle time** (confirmation → completion) is
  `completion_transition.completed_at - batch_records.confirmed_at`.

These aggregations (`AVG`, `COUNT(*) FILTER (WHERE ...)`, grouped joins
across `stage_transitions`/`batch_records`/`stage_definitions`/`staff`) are
past what drizzle's fluent query builder expresses cleanly, so
`src/server/dashboard/service.ts` uses `db.execute(sql\`...\`)` — raw SQL
text, but every interpolated value is still a bound parameter via drizzle's
`sql` tag, not string-concatenated, so this is not an injection risk despite
being raw SQL.

The arithmetic that *is* plain JavaScript — filling gap days in the
throughput series with explicit zeros, rate percentages, CSV formatting —
lives in `src/server/dashboard/metrics.ts`, kept separate specifically so
it's unit-testable without a database (see Testing below).

---

## Endpoints

### `GET /api/mes/dashboard?departmentId=<uuid>&days=<n>`
Requires `dashboard.view`. `days` defaults to 14, clamped to 1-90.

```jsonc
{
  "days": 14,
  "stageOccupancy": [{ "stageId", "stageName", "sequenceNumber", "count" }],
  "throughput": [{ "date": "2026-03-01", "confirmed": 3, "completed": 2, "failed": 0 }],
  "stageDurations": [{ "stageId", "stageName", "sequenceNumber", "avgSeconds", "sampleSize" }],
  "stageReworkRates": [{ "stageId", "stageName", "sequenceNumber", "totalClosed", "sentBack", "failed" }],
  "cycleTime": { "avgSeconds", "sampleSize" },
  "operatorStageDurations": [{ "stageId", "stageName", "sequenceNumber", "operatorId", "operatorName", "avgSeconds", "sampleSize" }]
}
```
`operatorStageDurations` is present only for a caller with
`dashboard.viewOperatorMetrics` — absent (not `null`, not `[]`) otherwise.
`avgSeconds` is `null` wherever `sampleSize` is 0 — no data, not a
misleadingly confident zero.

→ `200 { ...above }` · `400` (missing `departmentId`) · `403`.

### `GET /api/mes/batches/export?departmentId=<uuid>`
Requires `dashboard.view`. Returns `text/csv` (RFC 4180: comma-separated,
CRLF rows, quoted fields only where needed), one row per batch (newest
first, capped at 1000 — a safety valve, not real pagination), columns:
batch number, type, department, product, quantity, unit, status, current
stage, created at, confirmed at, created by, confirmed by.

→ `200` (CSV body, `Content-Disposition: attachment`) · `400` · `403`.

---

## UI

`src/app/(portal)/reports/page.tsx` — stat cards (batches confirmed, avg.
cycle time, in-progress count), a stage-occupancy bar list (the
"bottleneck view"), a throughput trend as a stacked day-by-day bar chart,
average-time-per-stage bars, a rework/reject rate table, and — for
`admin`/`qa` only — a per-stage-per-operator duration table, labeled
in-page with the same "not for individual performance review" framing
spec 4.2 uses. "Export CSV" fetches the export endpoint and saves it via a
temporary object URL (a plain `<a href>` can't carry the `x-staff-id`
header this API needs).

No charting library was added — every visual here is plain CSS
(`div`s sized by percentage), matching the rest of the app's minimal
Tailwind aesthetic and avoiding a new dependency for what these charts
need.

Not built in this phase: a true Gantt/timeline view per batch (spec 4.3) —
the stage-by-stage history exists in `stage_transitions` and is queryable,
but there's no dedicated per-batch timeline screen yet; a calendar-style
throughput heatmap (the bar chart covers the same data, just not in that
visual form); and CSV export is capped at 1000 rows with no pagination or
date-range filter on the export itself (the on-screen metrics do respect
the day-range picker; the export doesn't yet).

---

## Testing

```
src/server/dashboard/metrics.test.ts    # pure — gap-filling, rate %, CSV formatting/escaping
```

10 unit tests, no database required. The SQL in `service.ts` itself has no
unit tests — correctness there rests on manual review (cross-checked
column-by-column against the migration files in `drizzle/`) rather than
execution, for the same reason as every other phase: **this environment
has no Docker/Postgres available**, so these queries have not been run
against a real database. The UI was checked live in the browser across all
four roles (`admin`, `qa`, `viewer` can open `/reports`; `production` is
blocked with the portal's standard "not available to you" screen, and
doesn't see the link in navigation at all) and degrades to a clear error
rather than hanging — the same loading-state bug fixed on the MES page in
Phase 2 turned up here too (`useDashboard` never resolves without a
`departmentId`, which a failed department fetch leaves permanently unset)
and was fixed the same way before calling this phase done.

---

## Production report page (reports redesign)

`src/app/(portal)/reports/page.tsx` — laid out after the energy-dashboard
reference: a live 3D floor model, headline tiles, a batches-made line chart,
recent exceptions and a product timing search, with the original rework and
per-operator tables kept underneath.

### Endpoints (all `dashboard.view`, header `x-staff-id`)

| Endpoint | Returns |
|---|---|
| `GET /api/mes/reports/output?departmentId&range=week\|month\|year` | Batches **made** (forwarded out of Warehouse) and **started** (confirmed) per day — last 7 or 30 days — or per month for the last 12, plus the total and % change against the equally long period before. The change is `null` when the MES wasn't in use for all of that earlier period. |
| `GET /api/mes/reports/stations?departmentId` | Per station: `incoming`, `returned`, `inProgress` right now — the same split the MES board uses. Polled every 15s by the floor model. |
| `GET /api/mes/reports/exceptions?departmentId` | The latest six send-backs and failures. |
| `GET /api/mes/reports/products?departmentId&q=` | Product names containing every word typed ("amox 500" finds "Amoxicillin 500mg Capsules"), with total and finished batch counts. |
| `GET /api/mes/reports/products/timing?departmentId&product=` | For one exact product name: average start-to-finish time (confirmed → out of Warehouse), average hands-on time (sum of claim → move-on per stage, queues excluded), quickest/slowest, per-station averages and — only with `dashboard.viewOperatorMetrics` — per-operator averages. `confidence` is `none` / `early` (<3 finished) / `building` (<10) / `reliable`. |

### The floor model

`src/components/reports/FloorModel.tsx` builds the floor from primitives
(three.js via `@react-three/fiber`), loaded with `next/dynamic` so no other
page pays for it. The room layout and **which MES stations belong to which
room** live in `src/lib/floorPlan.ts` (`stationSequences`) — edit that list to
move a station; a room's number is the total waiting (Incoming + Returned) at
its stations. Room labels are plain DOM positioned each frame from the 3D
scene, not drei's `<Html>`, which mounts a React root per label and misbehaves
under React 19.

### Demo history

`npm run db:seed:demo` now also writes a year of finished batches
(`scripts/demo-history.ts`, fixed random seed) so the chart and timing search
have something to show. These are written directly rather than through the
services, because they need backdated timestamps; they carry no audit-log
entries. Skip them with `npx tsx scripts/seed-mes-demo.ts --reset --no-history`.
