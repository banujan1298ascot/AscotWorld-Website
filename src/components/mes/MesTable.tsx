"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  FilterSelect,
  Input,
  Modal,
  PageHeader,
  PermissionNotice,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useDepartments, type BatchRecord } from "@/lib/batchBook";
import { canRecordLabels, LABEL_STATION_SEQUENCE, useAllStageQueues, useStages, type StageDefinition } from "@/lib/mes";
import { BatchFlags, flaggedFirstCellStyle, flaggedRowStyle } from "@/components/mes/BatchFlags";
import { LabelsButton, LabelsModal } from "@/components/mes/LabelsModal";
import { StationCounters } from "@/components/mes/StationCounters";
import { staffCollection } from "@/lib/seed";
import { useCollection } from "@/lib/storage";
import { OPERATOR_ROLES, roleCan, type StaffMember } from "@/lib/types";

/* ============================================================================
 * MES — table view
 * ----------------------------------------------------------------------------
 * The same pipeline as the MES board, laid out like the Batch Book: one row
 * per batch across every station, with "Assigned to" and "Status" editable
 * in place instead of dragging cards between columns. One of the MES page's
 * two views (src/app/(portal)/mes/page.tsx) — same live data and the same
 * server rules as the board, so a batch moved here is moved there too.
 * ========================================================================= */

type RowState = "waiting" | "returned" | "in_progress";

interface Row {
  batch: BatchRecord;
  stage: StageDefinition;
  state: RowState;
  operatorId: string | null;
  operatorName: string | null;
  /** When it arrived at this station, or when it was started. */
  since: string;
}

type Change =
  | { kind: "start"; row: Row }
  | { kind: "assign"; row: Row; operatorId: string }
  | { kind: "reassign"; row: Row; operatorId: string }
  | { kind: "forward"; row: Row }
  | { kind: "send-back"; row: Row }
  | { kind: "fail"; row: Row };

/** `order` is the table's top-to-bottom grouping: work waiting to be picked
 *  up first, then rework waiting to be redone, with what's already under
 *  way at the bottom. */
const STATE_META: Record<RowState, { label: string; tone: string; order: number }> = {
  waiting: { label: "Waiting to start", tone: "var(--status-scheduled)", order: 0 },
  returned: { label: "Returned — rework", tone: "var(--warning)", order: 1 },
  in_progress: { label: "In progress", tone: "var(--status-production)", order: 2 },
};

const label = (batch: BatchRecord) => batch.batchNumber ?? "Draft batch";

export function MesTable({ viewSwitch }: { viewSwitch: ReactNode }) {
  const { user, can } = useAuth();
  const { items: staff } = useCollection(staffCollection);
  const { departments, ready: departmentsReady, error: departmentsError } = useDepartments();
  const departmentId = departments[0]?.id;
  const { stages, ready: stagesReady, error: stagesError } = useStages(departmentId);

  // Same visibility rule as the board: a station account sees its own
  // station only; everyone else sees Check 2 through Warehouse.
  const boardStages = useMemo(() => stages.filter((s) => s.sequenceNumber >= 2), [stages]);
  const pinnedStage = user?.mesStage ?? null;
  const visibleStages = useMemo(
    () => (pinnedStage === null ? boardStages : boardStages.filter((s) => s.sequenceNumber === pinnedStage)),
    [boardStages, pinnedStage],
  );
  const stageIds = useMemo(() => visibleStages.map((s) => s.id), [visibleStages]);
  const pipeline = useAllStageQueues(stageIds);

  const [stationFilter, setStationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RowState>("all");
  const [search, setSearch] = useState("");
  const [change, setChange] = useState<Change | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [labelsRow, setLabelsRow] = useState<Row | null>(null);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const queue of pipeline.queues ?? []) {
      for (const batch of queue.incoming) {
        out.push({ batch, stage: queue.stage, state: "waiting", operatorId: null, operatorName: null, since: batch.updatedAt });
      }
      for (const batch of queue.returned) {
        out.push({ batch, stage: queue.stage, state: "returned", operatorId: null, operatorName: null, since: batch.updatedAt });
      }
      for (const entry of queue.inProgress) {
        out.push({
          batch: entry.batch,
          stage: queue.stage,
          state: "in_progress",
          operatorId: entry.operatorId,
          operatorName: entry.operatorName,
          since: entry.receivedAt,
        });
      }
    }
    return out.sort(
      (a, b) =>
        STATE_META[a.state].order - STATE_META[b.state].order ||
        // Urgent batches to the top of their group.
        Number(b.batch.urgent) - Number(a.batch.urgent) ||
        a.stage.sequenceNumber - b.stage.sequenceNumber ||
        a.since.localeCompare(b.since),
    );
  }, [pipeline.queues]);

  const query = search.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (stationFilter === "all" || row.stage.id === stationFilter) &&
      (statusFilter === "all" || row.state === statusFilter) &&
      (!query ||
        label(row.batch).toLowerCase().includes(query) ||
        (row.batch.productName ?? "").toLowerCase().includes(query) ||
        (row.operatorName ?? "").toLowerCase().includes(query)),
  );

  const stageBySequence = (n: number) => boardStages.find((s) => s.sequenceNumber === n);

  if (!user) return null;
  if (!can("mes.claim") && !can("dashboard.view")) {
    return (
      <>
        <PageHeader title="MES pipeline" />
        <PermissionNotice message="Your role doesn't have access to the MES pipeline." />
      </>
    );
  }

  /** A supervised station (Check 4) is run by its supervisor alone — the
   *  account pinned there, or an admin. Same rule as the board and server. */
  const runsStation = (stage: StageDefinition) =>
    !stage.supervised || user.role === "admin" || user.mesStage === stage.sequenceNumber;
  const mayOperate = (stage: StageDefinition) => can("mes.claim") && runsStation(stage);
  /** Can the signed-in person take a batch at this station themselves? Not
   *  at a supervised one, and only if they're the kind of operator it takes. */
  const canSelfClaim = (stage: StageDefinition) =>
    !stage.supervised && (!stage.operatorRole || user.operatorRole === stage.operatorRole);
  /** Who may move an in-progress batch on — its holder, or a supervised
   *  station's supervisor (the board's rule, enforced again by the server). */
  const canAct = (row: Row) =>
    mayOperate(row.stage) && row.state === "in_progress" && (row.operatorId === user.id || row.stage.supervised);

  /** Pinned to the row's station, or floating — same list the board offers.
   *  At a supervised station the pinned account is the supervisor, not an
   *  operator, so it's left off: assignments there time the operators. */
  const operatorsFor = (stage: StageDefinition): StaffMember[] =>
    staff
      .filter((s) => roleCan(s.role, "mes.claim"))
      .filter((s) => s.mesStage == null || (s.mesStage === stage.sequenceNumber && !stage.supervised))
      // Stations that only take one kind of operator (Checks 2-4).
      .filter((s) => !stage.operatorRole || s.operatorRole === stage.operatorRole)
      .sort((a, b) => Number(a.mesStage == null) - Number(b.mesStage == null) || a.name.localeCompare(b.name));

  async function apply(current: Change, reason: string) {
    const { row } = current;
    const s = row.stage.id;
    const b = row.batch.id;
    // Send back and Fail need the batch in someone's hands first — as on the
    // board, picking it up and rejecting it is one step for a waiting batch.
    const ensureStarted = async () => {
      if (row.state !== "in_progress") await pipeline.claim(s, b);
    };
    switch (current.kind) {
      case "start":
        return pipeline.claim(s, b);
      case "assign":
        return pipeline.claim(s, b, current.operatorId);
      case "reassign":
        return pipeline.reassign(s, b, current.operatorId);
      case "forward":
        return pipeline.forward(s, b);
      case "send-back":
        await ensureStarted();
        return pipeline.sendBack(s, b, reason);
      case "fail":
        await ensureStarted();
        return pipeline.fail(s, b, reason);
    }
  }

  /** Check 2 prints the labels — its rows get a Labels cell, which only
   *  Check 2 itself may fill in (see canRecordLabels). */
  const mayRecordLabels = (stage: StageDefinition) => canRecordLabels(user, stage, can("mes.claim"));
  const showLabels = shown.some((row) => row.stage.sequenceNumber === LABEL_STATION_SEQUENCE);

  const ready = departmentsReady && (!departmentId || stagesReady) && (stageIds.length === 0 || pipeline.ready);
  const loadError = departmentsError ?? stagesError ?? pipeline.error;

  return (
    <>
      <PageHeader
        title={pinnedStage !== null && visibleStages[0] ? visibleStages[0].name : "MES pipeline"}
        description={
          pinnedStage !== null
            ? "Your station's batches in one table. Change who it's assigned to or its status right in the row."
            : "Every batch in the pipeline in one table. Change who it's assigned to or its status right in the row."
        }
        actions={viewSwitch}
      />

      {pinnedStage !== null && visibleStages[0] ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-white"
          style={{ background: "var(--brand-gradient)" }}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-extrabold">
            {visibleStages[0].sequenceNumber}
          </span>
          <p className="text-sm font-bold">
            Station {visibleStages[0].sequenceNumber} · {visibleStages[0].name}
          </p>
          <p className="ml-auto text-xs text-white/75">
            Signed in as {user.name} — you only see this station&apos;s work.
          </p>
        </div>
      ) : null}

      {/* The station this screen is about: the pinned one, or the one picked
          in the Station filter. */}
      <StationCounters
        departmentId={departmentId}
        sequenceNumber={
          pinnedStage ?? visibleStages.find((s) => s.id === stationFilter)?.sequenceNumber
        }
      />

      {loadError ? (
        <div className="mb-4">
          <ErrorNotice message={loadError} />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {pinnedStage === null ? (
          <FilterSelect
            label="Station"
            value={stationFilter}
            onChange={setStationFilter}
            options={[
              { value: "all", label: "All stations" },
              ...visibleStages.map((s) => ({ value: s.id, label: `${s.sequenceNumber}. ${s.name}` })),
            ]}
          />
        ) : null}
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | RowState)}
          options={[
            { value: "all", label: "Any" },
            { value: "waiting", label: "Waiting to start" },
            { value: "returned", label: "Returned — rework" },
            { value: "in_progress", label: "In progress" },
          ]}
        />
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <MagnifyingGlass
            size={15}
            weight="bold"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--subtle-foreground)]"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Batch, product or operator…"
            aria-label="Search batches"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <span className="ml-auto text-xs font-semibold text-[var(--muted-foreground)]">
          {shown.length} of {rows.length} batches
        </span>
      </div>

      {!ready ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card padded={false} className="overflow-hidden">
          {shown.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={rows.length === 0 ? "Nothing in the pipeline" : "No batches match"}
                description={
                  rows.length === 0
                    ? "Batches appear here once they're confirmed in the Batch Book."
                    : "Try a different station, status or search."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={`w-full text-sm ${pinnedStage === null ? "min-w-[980px]" : "min-w-[820px]"}`}>
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="px-4 py-2.5">Batch number</th>
                    <th className="px-4 py-2.5">Product</th>
                    <th className="px-4 py-2.5">Quantity</th>
                    {pinnedStage === null ? <th className="px-4 py-2.5">Station</th> : null}
                    <th className="px-4 py-2.5">Assigned to</th>
                    <th className="px-4 py-2.5">Status</th>
                    {showLabels ? <th className="px-4 py-2.5">Labels</th> : null}
                    <th className="px-4 py-2.5">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <TableRow
                      key={`${row.stage.id}-${row.batch.id}`}
                      row={row}
                      pending={change?.row.batch.id === row.batch.id}
                      operators={operatorsFor(row.stage)}
                      mayOperate={mayOperate(row.stage)}
                      canSelfClaim={canSelfClaim(row.stage)}
                      canAct={canAct(row)}
                      showStation={pinnedStage === null}
                      nextStage={stageBySequence(row.stage.sequenceNumber + 1)}
                      previousStage={row.stage.sequenceNumber >= 3 ? stageBySequence(row.stage.sequenceNumber - 1) : undefined}
                      labels={
                        !showLabels ? undefined : row.stage.sequenceNumber === LABEL_STATION_SEQUENCE ? (
                          <LabelsButton
                            batch={row.batch}
                            canEdit={mayRecordLabels(row.stage)}
                            onOpen={() => setLabelsRow(row)}
                          />
                        ) : (
                          <span className="text-[var(--subtle-foreground)]">—</span>
                        )
                      }
                      onChange={(next) => {
                        setActionError(null);
                        setChange(next);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {labelsRow ? (
        <LabelsModal
          batch={labelsRow.batch}
          stageName={labelsRow.stage.name}
          canEdit={mayRecordLabels(labelsRow.stage)}
          onClose={() => setLabelsRow(null)}
          onSaved={() => void pipeline.refresh()}
        />
      ) : null}

      {change ? (
        <ConfirmChange
          change={change}
          staffById={new Map(staff.map((s) => [s.id, s]))}
          nextStage={stageBySequence(change.row.stage.sequenceNumber + 1)}
          previousStage={stageBySequence(change.row.stage.sequenceNumber - 1)}
          error={actionError}
          onCancel={() => {
            setChange(null);
            setActionError(null);
          }}
          onConfirm={async (reason) => {
            setActionError(null);
            try {
              await apply(change, reason);
              setChange(null);
            } catch (err) {
              setActionError(err instanceof Error ? err.message : "That change didn't go through.");
            }
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

const CELL_SELECT = `h-9 w-full min-w-[11rem] cursor-pointer rounded-md border border-[var(--border-strong)] bg-[var(--surface)]
  pl-7 pr-2 text-[13px] font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-70`;

function TableRow({
  row,
  pending,
  operators,
  mayOperate,
  canSelfClaim,
  canAct,
  nextStage,
  previousStage,
  showStation,
  labels,
  onChange,
}: {
  row: Row;
  /** Off for a station account — every row is its own station. */
  showStation: boolean;
  /** The Labels cell, when the table is showing that column. */
  labels?: ReactNode;
  pending: boolean;
  operators: StaffMember[];
  mayOperate: boolean;
  /** Whether "start it myself" (and send back / fail from waiting, which
   *  start it first) is on offer — see the page's canSelfClaim. */
  canSelfClaim: boolean;
  canAct: boolean;
  nextStage: StageDefinition | undefined;
  previousStage: StageDefinition | undefined;
  onChange: (change: Change) => void;
}) {
  const { batch, stage, state } = row;
  const waiting = state !== "in_progress";
  const meta = STATE_META[state];

  // The holder may not be on this station's usual list (an admin who claimed
  // it themselves, say) — keep them selectable so the cell shows who it is.
  const operatorOptions =
    row.operatorId && !operators.some((o) => o.id === row.operatorId)
      ? [{ id: row.operatorId, name: row.operatorName ?? "Unknown" }, ...operators]
      : operators;

  const operatorLocked = !mayOperate || (!waiting && !canAct);
  const statusLocked = !mayOperate || (!waiting && !canAct);
  const lockReason = !mayOperate
    ? stage.supervised
      ? `Only the ${stage.name} supervisor changes batches here.`
      : "Your role can't change batches."
    : !waiting && !canAct
      ? `Only ${row.operatorName ?? "the operator"} can change this — it's assigned to them.`
      : undefined;

  const forwardLabel = nextStage ? `Done → send to ${nextStage.name}` : "Done → complete (leaves the pipeline)";

  return (
    <tr
      className={`border-b border-[var(--border)] transition-colors last:border-0 ${
        pending ? "bg-[var(--brand-50)]" : "hover:bg-[var(--surface-sunken)]"
      }`}
      style={pending ? undefined : flaggedRowStyle(batch)}
    >
      <td className="px-4 py-2" style={flaggedFirstCellStyle(batch)}>
        <span className="block font-mono text-[13px] font-semibold">{label(batch)}</span>
        <BatchFlags batch={batch} className="mt-1" />
      </td>
      <td className="px-4 py-2">{batch.productName ?? "—"}</td>
      <td className="px-4 py-2 tabular-nums text-[var(--muted-foreground)]">
        {batch.quantity ? `${Number(batch.quantity).toLocaleString()} ${batch.unit ?? ""}` : "—"}
      </td>
      {showStation ? (
        <td className="px-4 py-2">
          <span className="font-semibold">
            <span className="text-[var(--muted-foreground)]">{stage.sequenceNumber}.</span> {stage.name}
          </span>
        </td>
      ) : null}

      {/* Assigned to — picking someone for a waiting batch starts it with
          them; changing it on a started one hands it over. */}
      <td className="px-4 py-2" title={operatorLocked ? lockReason : undefined}>
        <div className="relative">
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
            style={{ background: row.operatorId ? "var(--primary)" : "var(--border-strong)" }}
            aria-hidden="true"
          />
          <select
            aria-label={`Assigned operator for ${label(batch)}`}
            value={row.operatorId ?? ""}
            disabled={operatorLocked}
            onChange={(e) => {
              const operatorId = e.target.value;
              if (!operatorId) return;
              onChange(waiting ? { kind: "assign", row, operatorId } : { kind: "reassign", row, operatorId });
            }}
            className={CELL_SELECT}
          >
            {waiting ? <option value="">Unassigned</option> : null}
            {operatorOptions.length === 0 && stage.operatorRole ? (
              <option value="" disabled>
                No {OPERATOR_ROLES[stage.operatorRole].plural.toLowerCase()} on the team
              </option>
            ) : null}
            {operatorOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </td>

      {/* Status — the current state, plus whatever this batch can do next. */}
      <td className="px-4 py-2" title={statusLocked ? lockReason : undefined}>
        <div className="relative">
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
            style={{ background: meta.tone }}
            aria-hidden="true"
          />
          <select
            aria-label={`Status of ${label(batch)}`}
            value="current"
            disabled={statusLocked}
            onChange={(e) => {
              const action = e.target.value;
              if (action === "start") onChange({ kind: "start", row });
              else if (action === "forward") onChange({ kind: "forward", row });
              else if (action === "send-back") onChange({ kind: "send-back", row });
              else if (action === "fail") onChange({ kind: "fail", row });
            }}
            className={CELL_SELECT}
            style={{ color: meta.tone }}
          >
            <option value="current">{meta.label}</option>
            {/* At a supervised station a batch starts by being assigned to an
                operator (the "Assigned to" column), and is only sent back or
                failed once someone's on it — so their time is recorded. */}
            {waiting && canSelfClaim ? <option value="start">In progress (start it myself)</option> : null}
            {!waiting ? <option value="forward">{forwardLabel}</option> : null}
            {previousStage && !(waiting && !canSelfClaim) ? (
              <option value="send-back">Send back to {previousStage.name}…</option>
            ) : null}
            {stage.failAuthority && !(waiting && !canSelfClaim) ? <option value="fail">Fail batch…</option> : null}
          </select>
        </div>
      </td>

      {labels !== undefined ? <td className="px-4 py-2">{labels}</td> : null}

      <td className="whitespace-nowrap px-4 py-2 text-xs text-[var(--muted-foreground)]">
        {formatDistanceToNow(new Date(row.since), { addSuffix: true })}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirmation — every change asks first; send back and fail need a reason   */
/* -------------------------------------------------------------------------- */

function ConfirmChange({
  change,
  staffById,
  nextStage,
  previousStage,
  error,
  onCancel,
  onConfirm,
}: {
  change: Change;
  staffById: Map<string, StaffMember>;
  nextStage: StageDefinition | undefined;
  previousStage: StageDefinition | undefined;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { row } = change;
  const batch = label(row.batch);
  const needsReason = change.kind === "send-back" || change.kind === "fail";
  const name = (id: string) => staffById.get(id)?.name ?? "that operator";

  const copy: Record<Change["kind"], { title: string; body: string; confirm: string }> = {
    start: {
      title: `Start ${batch}?`,
      body: `It moves to In progress at ${row.stage.name}, assigned to you.`,
      confirm: "Start it",
    },
    assign: {
      title: `Assign ${batch}?`,
      body: `${change.kind === "assign" ? name(change.operatorId) : ""} takes it on at ${row.stage.name}, and it moves to In progress.`,
      confirm: "Assign",
    },
    reassign: {
      title: `Hand ${batch} over?`,
      body: `From ${row.operatorName ?? "its current operator"} to ${change.kind === "reassign" ? name(change.operatorId) : ""}.`,
      confirm: "Hand over",
    },
    forward: {
      title: `Mark ${batch} done at ${row.stage.name}?`,
      body: nextStage
        ? `It goes to ${nextStage.name}'s incoming queue.`
        : "This is the last station, so the batch is completed and leaves the pipeline.",
      confirm: nextStage ? `Send to ${nextStage.name}` : "Complete batch",
    },
    "send-back": {
      title: `Send ${batch} back?`,
      body: `It returns to ${previousStage?.name ?? "the previous station"} for rework. Say what needs fixing.`,
      confirm: "Send back",
    },
    fail: {
      title: `Fail ${batch}?`,
      body: "This ends the batch's journey for good and flags it for investigation. Making the product again needs a new batch number.",
      confirm: "Fail batch",
    },
  };
  const text = copy[change.kind];

  return (
    <Modal
      open
      onClose={onCancel}
      title={text.title}
      description={text.body}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={change.kind === "fail" ? "danger" : "primary"}
            disabled={busy || (needsReason && !reason.trim())}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim());
              setBusy(false);
            }}
          >
            {busy ? "Saving…" : text.confirm}
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-[var(--surface-sunken)] px-3 py-2.5 text-[13px]">
        <dt className="text-[var(--muted-foreground)]">Batch</dt>
        <dd className="font-mono font-semibold">{batch}</dd>
        <dt className="text-[var(--muted-foreground)]">Product</dt>
        <dd>{row.batch.productName ?? "—"}</dd>
        <dt className="text-[var(--muted-foreground)]">Station</dt>
        <dd>
          {row.stage.sequenceNumber}. {row.stage.name}
        </dd>
      </dl>
      {needsReason ? (
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={change.kind === "fail" ? "Why is it failing?" : "What needs fixing?"}
          aria-label="Reason"
          rows={3}
          autoFocus
          className="mt-3 w-full"
        />
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorNotice message={error} />
        </div>
      ) : null}
    </Modal>
  );
}
