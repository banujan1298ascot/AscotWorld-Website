# MES pipeline — API reference

Phase 2 of [`docs/specs/MES_BatchBook_Design_Spec.md`](specs/MES_BatchBook_Design_Spec.md):
the Check 2-6 + Warehouse claim/drag/return/fail pipeline. Read
[`docs/batch-book-api.md`](batch-book-api.md) first — this phase only exists
because confirming a batch there now dispatches it here.

Same setup, auth trust boundary (`x-staff-id` header), and general shape as
Batch Book — this doc only covers what's different.

---

## Why there's no screen for "Check 1"

Spec 3.0's own stage table lists "Batch Book Entry" as stage 1, with "batch
confirmed" as part of what happens there. Rather than build a second screen
that duplicates the Batch Book confirm action, confirming a batch *is*
stage 1's work: `confirmBatch` (in `src/server/batch-book/service.ts`)
auto-inserts a closed `stage_transitions` row for stage 1 — attributed to
whoever created the draft, spanning from the draft's creation to the moment
it was confirmed — and dispatches the batch straight into stage 2's
Incoming queue. So this module's screens start at stage 2 (Order/Calculation
Check) and run through stage 7 (Warehouse).

This is a judgment call about an ambiguity in the spec, not something it
states outright — worth revisiting if it doesn't match how Bespoke actually
works in practice.

---

## This pipeline is Bespoke's, not every department's

Confirmed 2026-09-15: **M-type batches never go through this pipeline.**
This module — Check 1 through Warehouse — is specifically Bespoke's, for
non-M batch types. M-type batches will need their own, separately-designed
MES for what the user calls "the batch department" — not designed yet, so
nothing here anticipates its shape. Until it exists, `confirmBatch` simply
never dispatches an M batch anywhere (see the note in
[`docs/batch-book-api.md`](batch-book-api.md)); it's numbered and confirmed
like any other batch, then waits.

---

## Seeded stages (Bespoke)

`npm run db:seed` creates all 7 from spec 3.0:

| # | Name | Fail authority | Releases to Warehouse | Supervised |
|---|---|---|---|---|
| 1 | Batch Book Entry | no | no | no |
| 2 | Order/Calculation Check | no | no | no |
| 3 | Raw Material Picking | no | no | no |
| 4 | Supervisor Material Check | **yes** | no | **yes** |
| 5 | Production Check | **yes** | no | no |
| 6 | Final QA Release | **yes** | **yes** | no |
| 7 | Warehouse | no | no | no |

Only Check 4 onward can fail a batch (spec 3.2) — enforced by checking the
stage's own `fail_authority` column, not the acting user's role, since the
spec's restriction is about the stage, not who's operating it.

### Supervised stages

Clarified 2026-09-22: at Check 4, the operators doing the actual material
check work the floor and never sign into the app at all — the supervisor is
the only person at that station who does. So the ordinary "only the operator
who claimed it may act on it" rule (below) would strand every batch the
moment the supervisor assigned it to someone.

`stage_definitions.supervised` marks a stage where claiming still records
*who the work is assigned to* (for the audit trail and the "held by" label),
but does **not** restrict who may forward, send back, or fail it — anyone
with `mes.claim`/`mes.pass` acting at that stage may, not just the assignee.
`canActOnTransition` (`src/server/mes/validation.ts`) takes the stage as an
optional third argument for exactly this — omit it and the rule is the
ordinary holder-only one.

This is a property of the *stage*, not a role, the same way `fail_authority`
is: a department could have more than one supervised station, and nothing
here assumes Check 4 is the only one.

---

## The state machine

- **Incoming**: `batch_records.current_stage_id = this stage` and
  `current_stage_arrival = 'FORWARD'`, and no open (`completed_at IS NULL`)
  `stage_transitions` row for it yet.
- **Returned**: same, but `current_stage_arrival = 'RETURNED'` — sent back
  from a later stage. Kept visually separate per spec 3.3 so rework doesn't
  hide among fresh work.
- **In progress**: an open `stage_transitions` row exists — the batch is
  claimed by whichever operator holds it and stays with them (spec 3.3)
  until they act. At a supervised stage (see above) it stays *assigned* to
  them, but anyone acting at that stage — the supervisor — may move it on.
- **Claim**: inserts the open transition. A DB-level partial unique index
  (`stage_transitions_active_operator_unique`, added in Phase 1's schema)
  means an operator physically cannot claim a second batch while already
  holding one open anywhere in the pipeline — the claim just fails with a
  clear error.
- **Forward**: closes the transition (`outcome: FORWARD`), moves the batch
  to `sequence + 1`'s Incoming queue. Forwarding out of Warehouse (the last
  stage) instead marks the batch `COMPLETED` with no current stage.
- **Send back**: closes the transition (`outcome: SENT_BACK`), moves the
  batch to `sequence - 1`'s Returned queue. Refused from stage 2, since
  stage 1 has no queue to receive it — the error tells the caller to use a
  Batch Book edit instead.
- **Fail**: only at a stage with `fail_authority`. Closes the transition
  (`outcome: FAILED`, `investigation_flagged: true`), marks the batch
  `FAILED` with no current stage — its journey through the pipeline ends
  there for good (spec 3.2: making the product again needs a fresh batch
  number via Batch Book, not a reuse of the failed one).
- Only the operator who claimed a batch may forward/send back/fail it —
  checked server-side against the transition's `operator_id`, not merely
  by role.

---

## Endpoints

All requests: header `x-staff-id: <staff id>`.

### `GET /api/mes/stages?departmentId=<uuid>`
→ `200 { stages: StageDefinition[] }`, ordered by `sequenceNumber`.

### `GET /api/mes/stages/:stageId/queue`
→ `200 { queue: { stage, incoming: BatchRecord[], returned: BatchRecord[], inProgress: { batch, operatorId, operatorName, receivedAt }[] } }`

### `POST /api/mes/stages/:stageId/batches/:batchId/claim`
Requires `mes.claim`. → `200 { transition }` · `409` if already claimed, or
if the calling operator already holds a different batch open elsewhere.

### `POST /api/mes/stages/:stageId/batches/:batchId/forward`
Requires `mes.pass` and that the caller holds the open transition.
→ `200 { batch: BatchRecord }`.

### `POST /api/mes/stages/:stageId/batches/:batchId/send-back`
Body: `{ "notes": "missing lot number", "reasonCodeId": "uuid?" }` — `notes`
required. → `200 { batch: BatchRecord }` · `422` (no reason) · `403` (not
your claim, or sequence ≤ 2).

### `POST /api/mes/stages/:stageId/batches/:batchId/fail`
Same body shape as send-back. → `200 { batch: BatchRecord }` · `403` if the
stage lacks fail authority, or the caller doesn't hold the claim · `422` (no
reason).

---

## Capabilities

Two new ones in `src/lib/types.ts`, granted to `admin`/`production`/`qa`
(not `viewer`):

| Capability | Covers |
|---|---|
| `mes.claim` | Claiming a batch from Incoming/Returned. |
| `mes.pass` | Forward, send back, **and** fail (fail is additionally gated per-stage — see above) — there's no separate `mes.fail`. |

---

## Notifications & sound alerts (spec 3.5)

There's no push/WebSocket transport in this project yet (spec 7 names it as
a future direction; Batch Book and MES both still fetch-once-and-refetch,
see the note in the earlier phases' docs). So detecting "a batch just
landed in my queue" is done by **polling**: `useStageQueue`
(`src/lib/mes.ts`) silently re-fetches the open stage's queue every
`STAGE_QUEUE_POLL_MS` (8s) and `useStageArrivalAlerts`
(`src/lib/mesAlerts.ts`) diffs each new snapshot against the previous one
for the *same* stage. This is an honest simplification, not a hidden gap —
worth swapping for SSE or a WebSocket if latency ever matters more than a
prototype needs.

- **Two distinct chimes** (`src/lib/soundAlerts.ts`): a rising two-tone for
  a fresh arrival in Incoming, a lower falling two-tone for a Returned
  batch — synthesized with the Web Audio API rather than shipped as audio
  files, so there's nothing to license or manage as assets.
- **Browser autoplay unlock** (spec 3.6): most browsers, especially on
  tablets, block audio until a user gesture. The MES page shows an "Enable
  sound" banner until the operator clicks it once per session
  (`unlockAudio()`); until then, alerts still fire as in-app notifications,
  just silently.
- **Mute preference**: a persisted on/off toggle in the page header
  (`useSoundAlertsEnabled`, `localStorage`), independent of the unlock gate
  above — one is "can this browser play sound at all right now", the other
  is "does this operator want it to".
- **In-app notifications reuse the existing notification center**
  (`src/lib/notifications.ts`, the bell icon, `/notifications`) rather than
  a parallel system — a new `mes` `NotificationType` was added alongside
  the existing `message`/`task`/`batch` ones. This means alerts land in
  browser storage for **whoever has the stage's screen open at the time**,
  not a fixed roster of stage operators — there's no staff-to-stage
  assignment model yet, so "whoever is watching this screen" is the only
  audience that exists to notify. A kiosk/dedicated-device deployment
  (spec 3.6 anticipates one) would need that assignment model added.
- **Single chime, not a repeating alarm** (spec 3.5 leaves this open —
  "worth deciding"): sounding once per arrival, paired with a persistent
  visual "New" badge on the card that clears only once it's claimed, felt
  like the safer default for a shared workspace — a repeating alarm that
  can't be silenced until someone acts is its own hazard. If real usage
  shows a single chime gets missed, that's the thing to revisit first.

---

## UI

`src/app/(portal)/mes/page.tsx` — a stage tab strip plus a three-column
board (Incoming / Returned / In progress). Every action (claim, forward,
send back, fail) is drag-and-drop **and** a plain button on the card, using
`@dnd-kit/core` (mouse + touch, spec 3.6) — nothing here depends on drag to
be usable, which also makes it possible to verify the module end-to-end via
button clicks alone. Send-back and fail open a modal requiring a non-empty
reason before submitting. Newly-arrived cards carry a "New" badge until
claimed (see Notifications above).

Not built in this phase: a department switcher (Bespoke is the only
department so far), the reason-code dropdown UI for `reason_codes` (it
starts empty per spec 3.2 — free text via `notes` covers it until an admin
screen exists to populate it), the Check 6 / Warehouse shared overview
widget spec 3.0 asks for, a fuller investigation sub-record for failed
batches beyond the `investigation_flagged` boolean, and a staff-to-stage
assignment model (see Notifications above).

---

## Testing

```
src/server/mes/validation.test.ts             # pure — claim/forward/send-back/fail rules
src/server/mes/service.integration.test.ts    # real Postgres, gated on DATABASE_URL
src/lib/mesAlerts.test.ts                     # pure — new-arrival diffing, incl. the stage-switch false-positive case
```

The integration suite (gated the same way as Batch Book's) proves, against
real Postgres:

1. Confirming a batch dispatches it to stage 2 with stage 1 already closed
   out (the Phase 1 → Phase 2 handoff).
2. Claim exclusivity — one operator cannot hold two open batches at once —
   is enforced by the database, not just application logic.
3. Forward/send-back correctly move a batch between stages' queues.
4. Send-back is refused from stage 2; fail is refused without fail
   authority and ends the batch's journey when allowed.
5. An M-type batch is never dispatched, even in a department whose stages 1
   and 2 are fully configured — the same department the other tests above
   use to prove the opposite for non-M types.

Sound playback and the browser's audio-unlock gate aren't unit-testable
(no Web Audio API in a Node test environment) — those were checked live in
the browser instead: the mute toggle persists and updates immediately, the
"Enable sound" banner disappears after one click with no console errors,
and polling was watched firing on schedule (~8s) with failures handled
silently rather than surfacing as an unhandled rejection or an error banner
replacing a working board.

**Same caveat as Phase 1: this environment had no Docker/Postgres, so this
suite is written and type-checked but not executed here.** The always-on
unit tests, full project typecheck, lint, and production build all passed
in this environment. The UI was also checked live in the browser signed in
as both admin and viewer — it renders correctly and degrades to a clear
error (rather than hanging or crashing) with no database configured; a
loading-state bug where the page would spin forever if `departments` failed
to load was found and fixed during that check.
