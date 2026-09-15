# Batch Book & Manufacturing Execution System (MES) — Design Specification

**Version:** v0.2 — clarified with stakeholder input
**Purpose:** Define the functional and technical requirements for (1) a concurrent, sequentially-numbered Batch Book, and (2) a multi-stage MES workflow (starting with Bespoke's 6-check pipeline) that consumes confirmed batches and tracks them stage-by-stage with full time-and-operator traceability.

---

## 1. System Overview

Two connected modules:

1. **Batch Book** — the source of truth. Every batch/order that will be manufactured is first logged here and given a sequential, unique batch number. Once a record is *confirmed*, it becomes immutable to normal users and is automatically pushed into the MES pipeline at Stage 1 (or Check 1's "incoming" queue).
2. **MES (6-Stage Check Pipeline)** — each confirmed batch flows through 6 sequential stages (Check 1 → Check 2 → … → Check 6). Each stage has its own screen, its own operator(s), an **Incoming** queue and an **Outgoing** queue, and every transition is timestamped and attributed to a specific user.

Together, this gives full "where is this batch right now, who has it, how long has it taken" visibility, rolled up into a management dashboard.

---

### 1.1 Scale (confirmed)
Roughly **70 employees** will use the system at any given time, distributed across stages as follows:

| Stage | Approx. concurrent operators |
|---|---|
| Check 1 (Batch Book Entry) | ~10 |
| Check 2 (Order/Calculation Check) | ~4 |
| Check 3 (Raw Material Picking) | 1–2 |
| Check 4 (Supervisor Material Check) | 7–15 |
| Check 5 (Production Check) | 1–2 |
| Check 6 (Final QA Release) | 1–4 |
| Check 7 (Warehouse) | ~5 |

This is a moderate, well-within-normal-range concurrency load for a real-time web app — a standard WebSocket/push setup with a relational database backend (as proposed in Section 7) comfortably handles this.

**Additional consideration — stakeholder dashboard access:** beyond the operators above, other stakeholders will want to view the dashboard and track "where their orders are" at any time. **Confirmed for now: this is management, sales, and other internal staff** — not external clients yet. However, **client access is planned for a later stage**, so the dashboard's access-control design should anticipate a future "external/client" role from the start (e.g. build permissions so a client role could be scoped to "their own orders only" later, rather than assuming all dashboard viewers are internal and retrofitting client-level data isolation afterward).

---

## 2. Batch Book Module

### 2.1 Core requirements
- Multi-user, real-time shared view — all authorized users see the same live list (like a shared ledger).
- **Concurrency-safe sequential numbering**: if two users are creating an entry at the same time, the system must guarantee no duplicate and no gap-skipping errors — first to submit gets the next number, the second submitter automatically receives the following number (not a race condition, not a rejected save).
- **Draft vs Confirmed state**:
  - *Draft*: editable by the creator, not yet numbered/locked, not visible to MES.
  - *Confirmed*: batch number is permanently assigned, record becomes read-only to normal users, and it is automatically dispatched to the MES pipeline.
- **Edit permissions**:
  - Normal users: can edit only their own *unconfirmed* drafts.
  - Supervisors/QA role: can edit confirmed/historical entries, but every such edit is logged (who, when, old value → new value, reason code/comment).
- Full audit trail on every record (immutable log, not just "last edited by").

### 2.2 Suggested data model
```
BatchRecord {
  id (internal UUID)
  batch_type (e.g. A / B / C / D / M — determines the prefix and which sequence this batch number is drawn from)
  batch_number (sequential within batch_type, human-facing, immutable once confirmed — e.g. "A-0001")
  department_id (FK — which department/site/pipeline this batch belongs to, e.g. "Bespoke")
  product_id / product_name
  batch_size / quantity
  planned_manufacture_date
  created_by, created_at
  confirmed_by, confirmed_at
  status: DRAFT | CONFIRMED | IN_PROGRESS | COMPLETED | ON_HOLD | FAILED
  current_stage (FK to MES stage, null until confirmed)
  custom_fields (formulation, batch size, line, shift, etc.)
}

AuditLogEntry {
  batch_id
  field_changed
  old_value, new_value
  changed_by, changed_at
  reason/comment (required for supervisor edits)
}
```

### 2.3 Sequential numbering mechanism (concurrency control)
**Numbering scheme (confirmed):** batch numbers are organized by **batch/production type**, using letter prefixes — e.g. **A batch, B batch, C batch, D batch, M batch** — representing different categories such as in-stock production, cytotoxic, batch production, bespoke production, and so on. Each type has its **own independent sequence** (e.g. A-0001, A-0002... running separately from B-0001, B-0002...).

**Reset behavior (confirmed) — differs by type:**
- **M batch resets yearly and embeds the year in the prefix** — e.g. `M26-0001` this year, `M27-0001` starting next year.
- **A, B, C, and D batches do not reset** — they keep counting up indefinitely (e.g. `A-0001`, `A-0002`, `A-0003`...).

This means the numbering logic needs to be **configurable per type**: some types (M) key their sequence off `(type, year)`, while others (A/B/C/D) key it off `type` alone with no year component. The counter table/sequence design should support both patterns rather than assuming all types behave the same way.

Recommended approach: a single atomic "get next number" operation, scoped per **(batch type)** or **(batch type + year)** depending on the type's reset rule, at the database level (e.g., a Postgres sequence per type/year, or a row-locked counter table keyed appropriately with `SELECT ... FOR UPDATE`), so numbering is assigned **at the moment of confirmation**, not at draft creation. This avoids: two people opening a form simultaneously for the same batch type, one abandoning it, and a number being "wasted" or issued out of order.

### 2.4 Real-time collaboration
- Live list updates (WebSocket/push) so all users see new confirmations and status changes without refreshing.
- Optional "someone is editing this draft" indicator to avoid two people drafting the same batch simultaneously.

### 2.5 Historical data migration (confirmed)
- Existing/old Batch Book records will be **imported** into the system as historical reference data (batch numbers, products, dates, etc. already completed in the past).
- **Only new batches created going forward will run through the MES pipeline** — imported historical batches don't need stage transitions/timings generated for them, since that production already happened outside this system.
- Practically: imported records should likely be flagged as `status: COMPLETED (historical/imported)` with no `current_stage`, so they appear in the Batch Book for lookup/reference but don't show up in any MES stage queue. Worth deciding the exact import format (CSV/Excel) once you're ready — happy to help design that import mapping when you get to it.

---

## 3. MES Module — 6-Stage Check Pipeline + Warehouse

### 3.0 Stage definitions (confirmed)

| Stage | Name | What happens | Who |
|---|---|---|---|
| 1 | Batch Book Entry | Batch is entered, worksheet assigned, details input, batch confirmed | Data entry user |
| 2 | Order/Calculation Check | Verify calculations are correct, product is correct, order matches the CoC, and matches the Purchase Order | Checker |
| 3 | Raw Material Picking | Pick all raw materials per order, send to next stage | Picker/operator |
| 4 | Supervisor Material Check | Supervisor verifies raw materials are correct, hands off to an operator to manufacture | Supervisor |
| 5 | Production Check | First check that the correct product was made, in the correct amount | Checker |
| 6 | Final QA Release | Overall check — visual product quality, calculations, label check; can fail the product here; if satisfied, releases product to warehouse | QA/Release checker |
| 7 | Warehouse (not a "check") | Pack product, prepare for delivery/pickup | Warehouse team |

**Note:** Stage 7 (Warehouse) is not a QA check — it's fulfilment. However, Check 6 and Warehouse need a **shared overview view** of how many orders are in progress/awaiting pickup at any time, since warehouse needs visibility into what's about to arrive and Check 6 needs to see what's pending pickup/dispatch. This should be reflected in access control (see 3.4) and likely as a shared widget on both screens' dashboards, not just individual stage queues.

**Important scope note (confirmed):** this pipeline (Batch Book Entry → Check 2 → Check 3 → Check 4 → Check 5 → Check 6 → Warehouse) is being built first for the **Bespoke department**. You plan to roll this out to other **batch production sites/departments later, which do not have the same 6 checks** — their stage count and stage names will differ.

**Design implication:** the MES pipeline should **not be hardcoded to 6 stages**. Instead, the stage structure should be a **configurable template per department/site** — i.e., "Department" or "Production Line" becomes a top-level entity, and each one has its own ordered list of stages (name, sequence, fields, fail authority, etc.), rather than the system assuming a fixed 6-stage shape everywhere. Bespoke's pipeline is simply the first configured template. This affects the data model (see 3.2) and the admin tooling (you'll eventually want a screen where an admin can define a new department's stage sequence, rather than that being a code change).
- Check 2: CoC reference, PO reference, calculation values, pass/fail per check item
- Check 3: raw material list, lot numbers picked, quantities
- Check 4: supervisor sign-off field, materials confirmed checklist
- Check 5: expected quantity vs actual quantity produced
- Check 6: visual inspection checklist, label check, calculation re-check, fail reason (if failed), release sign-off
- Warehouse: packing status, dispatch/pickup readiness

*(Exact fields per stage — e.g. is CoC entered manually or attached as a file — can be refined once we get into screen-level detail.)*

### 3.1 Stage structure
Each of the 6 checks is a distinct screen/workspace with:
- **Incoming queue** — batches that have arrived from the previous stage (or from Batch Book confirmation, for Check 1), not yet claimed by an operator.
- **Assignment step** — an operator clicks a batch in Incoming to "claim" it (assigns it to themselves). This stamps `received_at` + `assigned_operator`.
- **Working state** — the batch is now "in progress" at that stage, visibly attributed to that operator (useful for supervisors to see who currently has what).
- **Outgoing action** — when work is done, operator drags/moves the batch to Outgoing, which:
  - Stamps `stage_completed_at` (and calculates duration = completed_at − received_at)
  - Pushes the batch into the **next stage's Incoming queue**
  - OR routes it **backward** to the previous stage's Returned queue (rework), with a mandatory reason code/comment
  - OR marks it **FAILED** (scrapped, terminal — see 3.2), with a mandatory reason and investigation flag
- **Visibility restriction**: each stage's screen only shows batches that are currently at that stage (incoming/in-progress/outgoing-just-left, e.g. for a short period for confirmation) — not the whole pipeline. Supervisors/dashboard see everything.

### 3.2 Suggested data model
```
Department {
  id
  name (e.g. "Bespoke", "Batch Production Site A")
  stages: ordered list of StageDefinition
}

StageDefinition {
  id
  department_id
  sequence_number (order within this department's pipeline)
  name (e.g. "Order/Calculation Check")
  fail_authority (bool — can this stage mark FAILED?)
  is_terminal_release_stage (bool — does completing this stage release the batch onward, e.g. to Warehouse?)
}

StageTransition {
  batch_id
  stage_id (FK to StageDefinition, not a hardcoded stage number)
  operator_id
  received_at
  completed_at
  duration (computed)
  outcome: FORWARD | SENT_BACK | ON_HOLD | FAILED
  destination_stage (next stage, or previous stage's Returned queue if sent back)
  notes / reason_code (required if SENT_BACK or FAILED)
}
```
This gives a full timeline per batch: every stage, every operator, every duration, every forward/backward movement — the raw data for your dashboard. Because stages reference a `Department`'s configurable `StageDefinition` list rather than a fixed "1–6," each department/site can have its own pipeline shape without a schema change.

**Reason capture (confirmed):** every send-back and every FAILED outcome captures **both** a reason code (dropdown) and a free-text comment.
- The reason-code dropdown starts **empty** at launch — there's no predefined list yet.
- It needs to be **easy for an admin/supervisor to add new dropdown options later** (a simple admin-managed list, not a code change) once common reasons become clear from real usage.
- Until the dropdown is populated with useful options, operators will just use the free-text field — the dropdown becomes more useful over time as reasons are added.
- Marks the batch record `FAILED` and ends its journey through the pipeline (it does not go to Returned or continue forward).
- Requires a mandatory reason/comment, and should trigger an **investigation flag** (e.g. notify QA/Supervisor role, and hold a record for the investigation outcome/notes — this may need its own simple sub-record: investigation opened by, findings, closed by, closed at).
- If the product needs to be made again, that requires a **brand-new batch number** via the Batch Book (not a reuse or continuation of the failed one) — i.e., a fresh entry starting again at Stage 1.
- Only **Check 4 onward** (Check 4, 5, and 6) can mark a batch as FAILED. Check 1–3 do not have fail authority — issues found there should be corrected in place or sent back within the Check 1–3 range rather than scrapped, since raw materials/production haven't started yet.

### 3.3 Interaction model (confirmed)
- **Claiming a batch = click-based action.** Operator clicks a batch in their Incoming queue to assign it to themselves. This stamps `received_at` + `assigned_operator`.
- **Passing to the next stage, or sending back = drag-and-drop.** Once work is done, the operator drags the batch card to "send forward" (next stage's Incoming) or "send back" (previous stage's **Returned** queue), which stamps `completed_at`, computes duration, and moves the record.
- **Claim exclusivity (confirmed):** an operator can only hold **one active batch at a time**. Once claimed, a batch stays with that operator (in their In Progress column) until they send it forward or back — they cannot claim a second batch until the first is passed on. This should be enforced at the claim action (disable/hide claiming for that operator, or show a warning, while they have an active batch).
- Suggested board layout per stage: **Incoming** (new, unclaimed) → **In Progress** (claimed, being worked) → **Returned** (sent back from a later stage, unclaimed, available to any operator at this stage) → **Outgoing** (drag target to send forward/back). Keeping Returned visually separate from fresh Incoming work lets operators and supervisors immediately spot rework volume vs. new work.

### 3.4 Access control per stage
- Each stage's users only see/act on their stage's queue (role- or group-based access, e.g. `Check2_Operator` role can only view/act on Stage 2).
- Supervisors and dashboard/admin roles can view all stages.

### 3.5 Notifications (confirmed)
- **In-app notification with a sound alert** when a new batch lands in a stage's Incoming (or Returned) queue — operators should be alerted audibly rather than needing to watch the screen continuously.
- Consider: a distinct sound for a *new* batch (fresh from the previous stage) vs. a *returned* batch, so operators can tell at a glance whether it's new work or rework without looking. Also worth deciding whether the alarm should keep repeating until acknowledged/claimed, or just sound once.
- Since this runs in a browser, this will need the browser tab to remain open — worth flagging as an operational requirement (e.g. a dedicated screen/kiosk mode per stage) rather than something operators dip in and out of.

### 3.6 Device mix (confirmed)
Stages will be used on a **mix of desktop computers and tablets, and this can change per stage over time** (e.g. Check 3–6 on tablets today, but not fixed permanently). This means:
- The UI must be **fully responsive and touch-friendly**, not just designed for desktop — drag-and-drop needs to work with touch gestures (adequately sized cards/drop zones) as well as mouse.
- **Sound alerts** may need a one-time "tap to enable audio" interaction per session on tablets, since most mobile browsers block autoplaying sound until the user interacts with the page — or the tablets should run in a kiosk/dedicated-browser mode that handles this once at setup.
- **Screen sleep/lock**: tablets tend to sleep more aggressively than desktop monitors, which would silence the incoming-batch alert — worth setting up tablets in a "stay awake"/kiosk configuration so alerts aren't missed.
- Because the device can change per stage at any time, build one responsive interface for every stage rather than a tablet-specific version of Check 3–6 — the same screen should work well on either device type.

---

## 4. Dashboard & Reporting

### 4.1 Access
- Role-gated (e.g. Supervisor, Plant Manager, QA) — not visible to normal operators unless you want operator-level personal stats visible to themselves.

### 4.2 Suggested metrics
- Batches in progress right now, and at which stage (live pipeline view / bottleneck view).
- Volume per day/week/month (batches started, completed, rejected/reworked).
- Average time per stage, per product.
- Average time per stage, per operator (and comparison against team average) — for spotting training needs or bottlenecks, not punitive use.
- Total end-to-end cycle time per batch (Batch Book confirmation → final stage completion).
- Rework/reject rate per stage, per product, per operator.
- Heatmap/calendar view of daily throughput.

### 4.3 Suggested visualizations
- Timeline/Gantt view per batch (stage-by-stage).
- Bar charts: avg. time per stage, avg. time per operator.
- Trend line: batches per day/week.
- Table/export (CSV) for compliance or management reporting.

---

## 5. Roles & Permissions Summary

| Role | Batch Book | MES Stage Screens | Dashboard |
|---|---|---|---|
| Normal user (data entry) | Create/edit own drafts, confirm | — | — |
| Stage Operator (Check N) | View confirmed batches (read-only) | Claim/work/pass batches at their assigned stage only | — |
| Supervisor/QA | Edit confirmed/historical records (logged) | View all stages, reassign if needed | View + limited reports |
| Admin/Plant Manager | Full view | Full view, override capability | Full dashboard access |
| Management/Sales/Internal staff | View (read-only, if relevant) | — | View dashboard (order status, throughput) |
| Client *(future)* | — | — | Own orders' status only *(planned for later phase)* |

*(This is a starting proposal — please confirm against your actual org structure.)*

---

## 6. Compliance & Data Integrity Considerations (Pharma-specific)

Since this handles medicine batch records, a few things are worth flagging for your team/QA before build:
- **Audit trail / electronic records requirements** — many regulators (e.g. FDA 21 CFR Part 11, EU Annex 11, MHRA data integrity guidance) require secure, time-stamped, attributable, and unalterable audit trails for GMP records. Your "supervisor can edit confirmed entries with logging" approach aligns with this in spirit, but should be reviewed against your specific regulatory requirements (this is a compliance/legal question for your QA team, not something the system design alone resolves).
- **Electronic signatures** — for now, **a simple click with full audit logging is sufficient** (no password/PIN re-entry at confirmation or stage sign-off). This should be reviewed again with QA/regulatory affairs before go-live, and it's worth designing the confirm/sign-off actions so a re-authentication step could be added later without a major rework (e.g. keep confirmation as a single, well-defined action/endpoint rather than scattering "confirm" logic across the UI).
- **Data backup/retention** — batch records typically need long retention periods; plan storage/archival accordingly.
- **Validation** — a system touching GMP batch records will likely need to go through computer system validation (CSV/CSA) before production use.

I can help design the software itself, but the regulatory sign-off should involve your QA/regulatory affairs team.

---

## 7. Suggested Technical Approach (high-level)

- **Backend**: relational database (PostgreSQL recommended) for transactional integrity of batch numbering and audit trails.
- **Integration**: not connected to external ERP/LIMS systems for now — this will be **one module within a larger, ever-growing company website/platform** you're building. This has a few design implications worth keeping in mind:
  - Build the Batch Book and MES as **self-contained modules** (own data model, own API surface) that plug into the wider site via shared auth/user accounts, rather than being tightly coupled to any one part of the existing site — this keeps it easy to extend later (e.g. connect to inventory or an ERP down the line without a rewrite).
  - Reuse the site's existing authentication/user/role system if there is one already, rather than building a parallel login — this also naturally supports the multi-department rollout (same user base, different department/role permissions).
  - Since the site is "ever-growing," lean toward a **modular, well-documented API** (internal or REST) for Batch Book/MES data, so other future parts of the site (or a future ERP integration) can read from it without needing direct database access.
- **Real-time updates**: WebSockets (or similar) so all Batch Book and MES screens update live without polling.
- **Frontend**: web app (works for both "website/app" as you described), with a Kanban-style drag-and-drop board for each MES stage.
- **Concurrency control**: database-level atomic counters/transactions for batch numbering; row-level locking or optimistic concurrency for record edits.
- **Auth**: role-based access control (RBAC), scoped per stage and per module.

---

## 8. Status

All the open design questions raised during this round have now been answered and folded into the spec above (stage definitions, claim/drag interaction model, Returned queue, FAILED/scrapped handling, fail authority, reason codes, e-signature scope, multi-department scalability, platform integration, notifications, device mix, historical data import, stakeholder access, and the batch-type numbering scheme).

**This spec is now at a good point to move into more concrete detail** — e.g. full database schema, API endpoint list, screen-by-screen wireframes for each stage, and a phased build plan (Bespoke first, other departments later). Let me know which of those you'd like to tackle next.
