"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ArrowFatLeft,
  ArrowFatRight,
  HandPalm,
  SpeakerHigh,
  SpeakerSlash,
  UserPlus,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { Avatar, Button, Card, EmptyState, Field, Modal, PageHeader, PermissionNotice, Skeleton, StatusPill, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { BATCH_BOOK_STATUS_LABELS, useDepartments, type BatchRecord } from "@/lib/batchBook";
import { useStageQueue, useStages, type InProgressEntry } from "@/lib/mes";
import { useStageArrivalAlerts } from "@/lib/mesAlerts";
import { staffCollection } from "@/lib/seed";
import { isAudioUnlocked, unlockAudio, useSoundAlertsEnabled } from "@/lib/soundAlerts";
import { useCollection } from "@/lib/storage";
import { roleCan, type StaffMember } from "@/lib/types";

/** How long a press has to be held before the assign picker opens. Kept in
 *  step with the `hold-progress` animation in globals.css. */
const HOLD_TO_ASSIGN_MS = 450;

/**
 * Board layout follows spec 3.3: Incoming/Returned (unclaimed) -> drag or
 * click to claim -> In progress (held by one operator) -> drag or click to
 * send Forward/Back/Fail. Drag uses dnd-kit (mouse + touch, spec 3.6);
 * every action also has a plain button so nothing here depends on drag to
 * be usable.
 *
 * A signed-in account pinned to a stage (`StaffMember.mesStage`) sees only
 * that stage — a station tablet on the floor shows the work at that station
 * and no other. Supervisors, QA leads and admin have no pin and keep the
 * switcher across every stage.
 */
export default function MesPipelinePage() {
  const { user, can } = useAuth();
  const { departments, ready: departmentsReady, error: departmentsError } = useDepartments();
  const { items: staff } = useCollection(staffCollection);
  // Bespoke is the only seeded department so far — a department switcher
  // can be added once a second one exists.
  const departmentId = departments[0]?.id;
  // useStages never resolves without a departmentId, which departmentsError
  // can leave permanently unset — so "ready" for the page as a whole means
  // "departments settled, and stages settled if we got that far".
  const { stages, ready: stagesReady, error: stagesError } = useStages(departmentId);
  const pipelineReady = departmentsReady && (!departmentId || stagesReady);
  const pipelineError = departmentsError ?? stagesError;

  // Stage 1 (Batch Book Entry) has no claim/drag screen of its own — see the
  // note in src/server/batch-book/service.ts.
  const allBoardStages = useMemo(() => stages.filter((s) => s.sequenceNumber >= 2), [stages]);

  const pinnedStage = user?.mesStage ?? null;
  const visibleStages = useMemo(
    () => (pinnedStage === null ? allBoardStages : allBoardStages.filter((s) => s.sequenceNumber === pinnedStage)),
    [allBoardStages, pinnedStage],
  );

  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(undefined);
  const currentStageId = visibleStages.find((s) => s.id === selectedStageId)?.id ?? visibleStages[0]?.id;
  const currentStage = visibleStages.find((s) => s.id === currentStageId);

  const { queue, ready, error, claim, forward, sendBack, fail } = useStageQueue(currentStageId);

  const [soundEnabled, setSoundEnabled] = useSoundAlertsEnabled();
  const [audioUnlocked, setAudioUnlocked] = useState(() => isAudioUnlocked());
  const newBatchIds = useStageArrivalAlerts(queue, user?.id, soundEnabled && audioUnlocked);

  const [pendingAction, setPendingAction] = useState<{ type: "send-back" | "fail"; batchId: string } | null>(null);
  const [assigningBatchId, setAssigningBatchId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );

  /** Who this stage can hand a batch to: anyone pinned to this stage, plus
   *  the floating operators who aren't pinned anywhere. */
  const assignableOperators = useMemo(
    () =>
      staff
        .filter((s) => roleCan(s.role, "mes.claim"))
        .filter((s) => s.mesStage == null || s.mesStage === currentStage?.sequenceNumber)
        .sort((a, b) => {
          const aPinned = a.mesStage != null ? 0 : 1;
          const bPinned = b.mesStage != null ? 0 : 1;
          return aPinned - bPinned || a.name.localeCompare(b.name);
        }),
    [staff, currentStage],
  );

  if (!user) return null;

  function handleDragEnd(event: DragEndEvent) {
    const batchId = String(event.active.id);
    const zone = event.over?.id;
    if (!zone) return;
    void handleAction(zone as string, batchId);
  }

  async function handleAction(zone: string, batchId: string, operatorId?: string) {
    setActionError(null);
    try {
      if (zone === "zone-claim") await claim(batchId, operatorId);
      else if (zone === "zone-forward") await forward(batchId);
      else if (zone === "zone-send-back") setPendingAction({ type: "send-back", batchId });
      else if (zone === "zone-fail") setPendingAction({ type: "fail", batchId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action failed.");
    }
  }

  // A station pinned to stage 1 has no board of its own — its work is the
  // Batch Book confirm action, so send it there rather than showing an
  // empty pipeline.
  const pinnedOffBoard = pinnedStage !== null && pipelineReady && visibleStages.length === 0 && allBoardStages.length > 0;

  return (
    <>
      <PageHeader
        title={pinnedStage !== null && currentStage ? currentStage.name : "MES pipeline"}
        description={
          pinnedStage !== null
            ? "Your station's queue. Drag a batch to move it on, or hold Claim to hand it to an operator."
            : "Claim a batch, then send it forward, back, or fail it — every move is timestamped and attributed."
        }
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? <SpeakerHigh size={15} weight="bold" /> : <SpeakerSlash size={15} weight="bold" />}
            {soundEnabled ? "Sound alerts on" : "Sound alerts off"}
          </Button>
        }
      />

      {pinnedStage !== null && currentStage ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-white"
          style={{ background: "var(--brand-gradient)" }}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-extrabold">
            {currentStage.sequenceNumber}
          </span>
          <p className="text-sm font-bold">Station {currentStage.sequenceNumber} · {currentStage.name}</p>
          <p className="ml-auto text-xs text-white/75">
            Signed in as {user.name} — you only see this station&apos;s work.
          </p>
        </div>
      ) : null}

      {!audioUnlocked ? (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 border-[var(--brand-200)] bg-[var(--brand-50)]">
          <p className="text-sm font-semibold text-[var(--brand-700)]">
            Enable sound alerts so you hear a chime when a new batch lands in this queue — most browsers block audio
            until you interact with the page once.
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              unlockAudio();
              setAudioUnlocked(true);
            }}
          >
            Enable sound
          </Button>
        </Card>
      ) : null}

      {!pipelineReady ? (
        <Skeleton className="mb-4 h-9 w-full" />
      ) : pipelineError ? (
        <Card className="mb-4 border-[var(--danger)]">
          <p className="text-sm font-semibold text-[var(--danger)]">{pipelineError}</p>
        </Card>
      ) : pinnedOffBoard ? (
        <EmptyState
          title="This station works from the Batch Book"
          description="Batch Book Entry is completed by confirming a batch, which hands it straight to the next station — there's no queue to work here."
          action={
            <Link href="/batch-book">
              <Button variant="primary">Open Batch Book</Button>
            </Link>
          }
        />
      ) : visibleStages.length === 0 ? (
        <EmptyState
          title="No pipeline configured yet"
          description="This department has no stages defined. Once they're set up, confirmed batches will start arriving here automatically."
        />
      ) : (
        <>
          {/* A pinned station has exactly one stage, so the switcher would be
              a row of one — the station banner above says where you are. */}
          {pinnedStage === null ? (
            <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
              {visibleStages.map((stage) => (
                <button
                  key={stage.id}
                  onClick={() => setSelectedStageId(stage.id)}
                  className={`shrink-0 cursor-pointer rounded-md px-4 py-3 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 ${
                    stage.id === currentStageId
                      ? "bg-[var(--brand-600)] text-white"
                      : "bg-[var(--surface)] text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  {stage.sequenceNumber}. {stage.name}
                </button>
              ))}
            </div>
          ) : null}

          {actionError ? (
            <Card className="mb-4 border-[var(--danger)]">
              <p className="text-sm font-semibold text-[var(--danger)]">{actionError}</p>
            </Card>
          ) : null}

          {error ? (
            <Card className="mb-4 border-[var(--danger)]">
              <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
            </Card>
          ) : null}

          {!ready ? (
            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : queue ? (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="grid gap-3 md:grid-cols-3">
                <QueueColumn title="Incoming" count={queue.incoming.length}>
                  {queue.incoming.map((batch) => (
                    <DraggableBatchCard key={batch.id} batch={batch} isNew={newBatchIds.has(batch.id)}>
                      {can("mes.claim") ? (
                        <ClaimControls
                          onClaim={() => handleAction("zone-claim", batch.id)}
                          onAssign={() => setAssigningBatchId(batch.id)}
                        />
                      ) : null}
                    </DraggableBatchCard>
                  ))}
                </QueueColumn>

                <QueueColumn title="Returned" count={queue.returned.length}>
                  {queue.returned.map((batch) => (
                    <DraggableBatchCard key={batch.id} batch={batch} returned isNew={newBatchIds.has(batch.id)}>
                      {can("mes.claim") ? (
                        <ClaimControls
                          onClaim={() => handleAction("zone-claim", batch.id)}
                          onAssign={() => setAssigningBatchId(batch.id)}
                        />
                      ) : null}
                    </DraggableBatchCard>
                  ))}
                </QueueColumn>

                <DroppableColumn id="zone-claim" title="In progress" count={queue.inProgress.length}>
                  {queue.inProgress.map((entry) => (
                    <InProgressCard
                      key={entry.batch.id}
                      entry={entry}
                      isMine={entry.operatorId === user.id}
                      canFail={Boolean(currentStage?.failAuthority)}
                      onForward={() => handleAction("zone-forward", entry.batch.id)}
                      onSendBack={() => handleAction("zone-send-back", entry.batch.id)}
                      onFail={() => handleAction("zone-fail", entry.batch.id)}
                    />
                  ))}
                </DroppableColumn>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <DropStrip id="zone-forward" label="Forward" icon={<ArrowFatRight size={20} weight="bold" />} />
                <DropStrip id="zone-send-back" label="Send back" icon={<ArrowFatLeft size={20} weight="bold" />} />
                {currentStage?.failAuthority ? (
                  <DropStrip id="zone-fail" label="Fail" icon={<XCircle size={20} weight="bold" />} danger />
                ) : null}
              </div>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Drag a claimed batch onto one of the strips above, or use the buttons on its card. Hold
                <strong className="text-foreground"> Claim </strong>
                on a waiting batch to hand it to a named operator.
              </p>
            </DndContext>
          ) : null}
        </>
      )}

      {assigningBatchId ? (
        <AssignOperatorModal
          operators={assignableOperators}
          stageName={currentStage?.name ?? "this stage"}
          onCancel={() => setAssigningBatchId(null)}
          onPick={async (operatorId) => {
            const batchId = assigningBatchId;
            setAssigningBatchId(null);
            await handleAction("zone-claim", batchId, operatorId);
          }}
        />
      ) : null}

      {pendingAction ? (
        <ReasonModal
          title={pendingAction.type === "fail" ? "Fail this batch" : "Send this batch back"}
          description={
            pendingAction.type === "fail"
              ? "This ends the batch's journey through the pipeline. A fresh batch number would be needed to make it again."
              : "This returns the batch to the previous stage's Returned queue for rework."
          }
          onCancel={() => setPendingAction(null)}
          onSubmit={async (notes) => {
            setActionError(null);
            try {
              if (pendingAction.type === "fail") await fail(pendingAction.batchId, notes);
              else await sendBack(pendingAction.batchId, notes);
              setPendingAction(null);
            } catch (err) {
              setActionError(err instanceof Error ? err.message : "That action failed.");
              setPendingAction(null);
            }
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Claim / hold-to-assign                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tap to take the batch yourself; press and hold to hand it to someone else.
 *
 * Pointer events are stopped from bubbling so dnd-kit's TouchSensor (which
 * starts a drag after 150ms of holding) never competes with the hold —
 * without that, no hold on a tablet could ever reach the assign threshold.
 * The separate Assign button does the same thing for anyone on a keyboard,
 * where a press-and-hold isn't an available gesture.
 */
function ClaimControls({ onClaim, onAssign }: { onClaim: () => void; onAssign: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    firedRef.current = false;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      firedRef.current = true;
      clearTimer();
      onAssign();
    }, HOLD_TO_ASSIGN_MS);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    clearTimer();
    // The hold already opened the picker — don't also claim it for myself.
    if (!firedRef.current) onClaim();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant="secondary"
        className={`relative overflow-hidden ${holding ? "hold-progress text-[var(--brand-600)]" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
      >
        Claim
      </Button>
      <Button
        variant="ghost"
        aria-label="Assign this batch to an operator"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onAssign}
      >
        <UserPlus size={17} weight="bold" />
      </Button>
    </div>
  );
}

function AssignOperatorModal({
  operators,
  stageName,
  onCancel,
  onPick,
}: {
  operators: StaffMember[];
  stageName: string;
  onCancel: () => void;
  onPick: (operatorId: string) => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Assign to an operator"
      description={`Whoever you pick holds this batch at ${stageName} — only they can send it on.`}
      footer={
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      {operators.length === 0 ? (
        <PermissionNotice message="Nobody is set up to work this stage yet." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {operators.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onPick(person.id)}
              className="card-interactive flex min-h-16 cursor-pointer items-center gap-3 rounded-lg
                border border-[var(--border)] bg-[var(--surface)] p-3 text-left"
            >
              <Avatar initials={person.initials} size={44} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-foreground">{person.name}</span>
                <span className="block truncate text-xs text-[var(--muted-foreground)]">{person.jobTitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function QueueColumn({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title} · {count}
      </p>
      <div className="grid gap-2">{count === 0 ? <EmptyColumnNote /> : children}</div>
    </div>
  );
}

function DroppableColumn({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div>
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title} · {count}
      </p>
      <div
        ref={setNodeRef}
        className={`grid gap-2 rounded-lg p-1 transition-colors duration-150 ${
          isOver ? "bg-[var(--brand-50)]" : ""
        }`}
      >
        {count === 0 ? <EmptyColumnNote /> : children}
      </div>
    </div>
  );
}

function EmptyColumnNote() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
      Nothing here
    </div>
  );
}

function DraggableBatchCard({
  batch,
  returned,
  isNew,
  children,
}: {
  batch: BatchRecord;
  returned?: boolean;
  isNew?: boolean;
  children?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: batch.id });
  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none select-none active:cursor-grabbing ${isDragging ? "opacity-50" : ""} ${
        isNew ? "border-[var(--brand-600)] ring-2 ring-[var(--brand-200)]" : ""
      }`}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10, position: "relative" } : undefined}
    >
      <BatchCardBody batch={batch} newBadge={isNew} />
      {returned ? (
        <p className="mt-1.5 text-[11px] font-semibold text-[var(--status-qa)]">Sent back for rework</p>
      ) : null}
      {children ? <div className="mt-2.5">{children}</div> : null}
    </Card>
  );
}

function InProgressCard({
  entry,
  isMine,
  canFail,
  onForward,
  onSendBack,
  onFail,
}: {
  entry: InProgressEntry;
  isMine: boolean;
  canFail: boolean;
  onForward: () => void;
  onSendBack: () => void;
  onFail: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.batch.id,
    disabled: !isMine,
  });
  return (
    <Card
      ref={setNodeRef}
      {...(isMine ? listeners : {})}
      {...(isMine ? attributes : {})}
      className={`${isMine ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10, position: "relative" } : undefined}
    >
      <BatchCardBody batch={entry.batch} />
      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--muted-foreground)]">
        <HandPalm size={12} weight="bold" />
        {isMine ? "Held by you" : `Held by ${entry.operatorName}`}
      </p>
      {isMine ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button variant="primary" onClick={onForward}>
            <ArrowFatRight size={15} weight="bold" />
            Forward
          </Button>
          <Button variant="secondary" onClick={onSendBack}>
            <ArrowFatLeft size={15} weight="bold" />
            Send back
          </Button>
          {canFail ? (
            <Button variant="danger" onClick={onFail}>
              <XCircle size={15} weight="bold" />
              Fail
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2">
          <PermissionNotice message="Only the operator who claimed this batch can act on it." />
        </div>
      )}
    </Card>
  );
}

function BatchCardBody({ batch, newBadge }: { batch: BatchRecord; newBadge?: boolean }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[13px] font-bold">{batch.batchNumber ?? batch.batchType}</p>
        <div className="flex items-center gap-1">
          {newBadge ? <StatusPill label="New" color="var(--brand-700)" background="var(--brand-50)" size="sm" /> : null}
          <StatusPill
            label={BATCH_BOOK_STATUS_LABELS[batch.status]}
            color="var(--status-production)"
            background="var(--status-production-bg)"
            size="sm"
          />
        </div>
      </div>
      <p className="mt-1 text-sm text-foreground">{batch.productName ?? "Unnamed product"}</p>
      {batch.quantity ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          {batch.quantity} {batch.unit ?? ""}
        </p>
      ) : null}
    </div>
  );
}

function DropStrip({
  id,
  label,
  icon,
  danger,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-20 items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-5 text-sm font-bold transition-colors duration-150 ${
        isOver
          ? danger
            ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]"
            : "border-[var(--brand-600)] bg-[var(--brand-50)] text-[var(--brand-700)]"
          : "border-[var(--border-strong)] text-[var(--muted-foreground)]"
      }`}
    >
      {icon}
      {label}
    </div>
  );
}

function ReasonModal({
  title,
  description,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onSubmit: (notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={submitting || notes.trim().length === 0}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await onSubmit(notes.trim());
              } catch (err) {
                setError(err instanceof Error ? err.message : "That action failed.");
                setSubmitting(false);
              }
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {error ? <PermissionNotice message={error} /> : null}
        <Field label="Reason" htmlFor="reason-notes" required>
          <Textarea id="reason-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
