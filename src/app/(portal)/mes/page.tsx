"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  defaultDropAnimationSideEffects,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  ArrowFatLeft,
  ArrowFatRight,
  DotsThree,
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

/** Settles the card into its new column instead of snapping, and fades the
 *  lifted copy out as it lands. */
const DROP_ANIMATION: DropAnimation = {
  duration: 260,
  easing: "cubic-bezier(0.18, 0.89, 0.32, 1.1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

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

  /** The stage a Forward hands to. Absent at the end of the line, where
   *  forwarding completes the batch instead. */
  const nextStage = useMemo(
    () =>
      currentStage
        ? allBoardStages.find((s) => s.sequenceNumber === currentStage.sequenceNumber + 1)
        : undefined,
    [allBoardStages, currentStage],
  );
  // Nothing sits behind stage 2 but Batch Book entry, which has no queue to
  // receive a return — the server refuses a send-back from there, so the
  // board shouldn't offer one.
  const canSendBackFromHere = (currentStage?.sequenceNumber ?? 0) >= 3;

  const [pendingAction, setPendingAction] = useState<{ type: "send-back" | "fail"; batch: BatchRecord } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ action: "claim" | "forward"; batch: BatchRecord } | null>(null);
  const [holdMenuBatch, setHoldMenuBatch] = useState<BatchRecord | null>(null);
  const [draggingBatch, setDraggingBatch] = useState<BatchRecord | null>(null);
  const [assigningBatchId, setAssigningBatchId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Distance rather than delay, so holding still never starts a drag —
    // that's what opens the card's action menu instead.
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
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

  const allBatches = queue ? [...queue.incoming, ...queue.returned, ...queue.inProgress.map((e) => e.batch)] : [];
  const batchById = (id: string) => allBatches.find((b) => b.id === id);
  const isClaimedByMe = (batchId: string) =>
    Boolean(queue?.inProgress.some((e) => e.batch.id === batchId && e.operatorId === user.id));
  const isUnclaimed = (batchId: string) => Boolean(queue?.inProgress.every((e) => e.batch.id !== batchId));

  /** Dropping on a column asks before acting, rather than moving the batch
   *  the moment a finger lifts in roughly the right place. */
  function handleDragStart(event: DragStartEvent) {
    setDraggingBatch(batchById(String(event.active.id)) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingBatch(null);
    const batch = batchById(String(event.active.id));
    const zone = event.over?.id;
    if (!batch || !zone) return;
    if (zone === "zone-claim" && isUnclaimed(batch.id)) setPendingMove({ action: "claim", batch });
    else if (zone === "zone-forward" && isClaimedByMe(batch.id)) setPendingMove({ action: "forward", batch });
  }

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That action failed.");
      throw err;
    }
  }

  /** Send back and Fail both need the batch in the actor's hands first —
   *  the server only lets the holder move a batch on. Claiming it as part
   *  of the same action keeps "pick it up, reject it" a single step. */
  async function withClaim(batchId: string, action: () => Promise<unknown>) {
    if (!isClaimedByMe(batchId)) await claim(batchId);
    await action();
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
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDraggingBatch(null)}
            >
              <div className="grid gap-3 md:grid-cols-3">
                {/* Waiting to be picked up — fresh arrivals and anything the
                    next stage sent back, which are the same job from here. */}
                <BoardColumn title="Incoming" count={queue.incoming.length + queue.returned.length}>
                  {[...queue.incoming, ...queue.returned].map((batch) => (
                    <DraggableBatchCard
                      key={batch.id}
                      batch={batch}
                      returned={queue.returned.some((b) => b.id === batch.id)}
                      isNew={newBatchIds.has(batch.id)}
                      onHold={can("mes.claim") ? () => setHoldMenuBatch(batch) : undefined}
                    >
                      {can("mes.claim") ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button variant="secondary" onClick={() => void runAction(() => claim(batch.id))}>
                            Claim
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label="More actions for this batch"
                            onClick={() => setHoldMenuBatch(batch)}
                          >
                            <DotsThree size={20} weight="bold" />
                          </Button>
                        </div>
                      ) : null}
                    </DraggableBatchCard>
                  ))}
                </BoardColumn>

                <DroppableColumn id="zone-claim" title="In progress" count={queue.inProgress.length}>
                  {queue.inProgress.map((entry) => (
                    <InProgressCard
                      key={entry.batch.id}
                      entry={entry}
                      isMine={entry.operatorId === user.id}
                      onHold={() => setHoldMenuBatch(entry.batch)}
                    />
                  ))}
                </DroppableColumn>

                {/* The forward destination, as a column you drag into. */}
                <DroppableColumn
                  id="zone-forward"
                  title={nextStage ? `Send to ${nextStage.name}` : "Complete batch"}
                  subtitle={nextStage ? `Stage ${nextStage.sequenceNumber}` : "Leaves the pipeline"}
                  count={0}
                  hint={
                    nextStage
                      ? "Drag a batch you're holding here to pass it on."
                      : "Drag a batch you're holding here to finish it."
                  }
                />
              </div>

              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Drag a batch to the next column to move it on — you&apos;ll be asked to confirm. Press and hold a batch
                for more actions.
              </p>

              {/* The card travels as a floating copy rather than the one in
                  the column, so it stays above every other card and settles
                  into place on release.

                  Rendered into <body>: the overlay is positioned fixed, and
                  the page-transition wrapper around this page leaves a
                  transform behind — which would make that wrapper, not the
                  viewport, the overlay's frame of reference and leave the
                  card floating away from the pointer. */}
              {typeof document === "undefined"
                ? null
                : createPortal(
                    <DragOverlay dropAnimation={DROP_ANIMATION}>
                      {draggingBatch ? (
                        <Card className="rotate-2 cursor-grabbing border-[var(--primary)] shadow-[var(--shadow-overlay)]">
                          <BatchCardBody batch={draggingBatch} />
                        </Card>
                      ) : null}
                    </DragOverlay>,
                    document.body,
                  )}
            </DndContext>
          ) : null}
        </>
      )}

      {pendingMove ? (
        <ConfirmMoveModal
          action={pendingMove.action}
          batch={pendingMove.batch}
          nextStageName={nextStage?.name}
          onCancel={() => setPendingMove(null)}
          onConfirm={async () => {
            const { action, batch } = pendingMove;
            await runAction(() => (action === "claim" ? claim(batch.id) : forward(batch.id)));
            setPendingMove(null);
          }}
        />
      ) : null}

      {holdMenuBatch ? (
        <BatchActionsModal
          batch={holdMenuBatch}
          heldByMe={isClaimedByMe(holdMenuBatch.id)}
          canSendBack={canSendBackFromHere}
          canFail={Boolean(currentStage?.failAuthority)}
          stageNumber={currentStage?.sequenceNumber ?? 0}
          onClose={() => setHoldMenuBatch(null)}
          onAssign={() => {
            setAssigningBatchId(holdMenuBatch.id);
            setHoldMenuBatch(null);
          }}
          onClaim={async () => {
            const batch = holdMenuBatch;
            setHoldMenuBatch(null);
            await runAction(() => claim(batch.id));
          }}
          onSendBack={() => {
            setPendingAction({ type: "send-back", batch: holdMenuBatch });
            setHoldMenuBatch(null);
          }}
          onFail={() => {
            setPendingAction({ type: "fail", batch: holdMenuBatch });
            setHoldMenuBatch(null);
          }}
        />
      ) : null}

      {assigningBatchId ? (
        <AssignOperatorModal
          operators={assignableOperators}
          stageName={currentStage?.name ?? "this stage"}
          onCancel={() => setAssigningBatchId(null)}
          onPick={async (operatorId) => {
            const batchId = assigningBatchId;
            setAssigningBatchId(null);
            await runAction(() => claim(batchId, operatorId));
          }}
        />
      ) : null}

      {pendingAction ? (
        <ReasonModal
          title={pendingAction.type === "fail" ? "Fail this batch" : "Send this batch back"}
          description={
            pendingAction.type === "fail"
              ? "This ends the batch's journey through the pipeline. A fresh batch number would be needed to make it again."
              : "This returns the batch to the previous stage for rework. Say what needs correcting — whoever picks it up sees this."
          }
          batchLabel={`${pendingAction.batch.batchNumber ?? pendingAction.batch.batchType} · ${pendingAction.batch.productName ?? "Unnamed product"}`}
          onCancel={() => setPendingAction(null)}
          onSubmit={async (notes) => {
            const { type, batch } = pendingAction;
            await runAction(() =>
              withClaim(batch.id, () => (type === "fail" ? fail(batch.id, notes) : sendBack(batch.id, notes))),
            );
            setPendingAction(null);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Press and hold                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Opens a batch's action menu on a press and hold, without blocking the
 * drag: dnd-kit starts dragging once the pointer travels, so a hold that
 * stays put belongs to us and any real movement cancels it. Events are left
 * to bubble so both behaviours see them.
 */
function useHold(onHold: (() => void) | undefined) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
    setHolding(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  if (!onHold) return { holding: false, handlers: {} };

  return {
    holding,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        origin.current = { x: event.clientX, y: event.clientY };
        setHolding(true);
        timer.current = window.setTimeout(() => {
          cancel();
          onHold();
        }, HOLD_TO_ASSIGN_MS);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const start = origin.current;
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel();
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                    */
/* -------------------------------------------------------------------------- */

/** Asked for on every drag, so a batch never moves on a mis-drop. */
function ConfirmMoveModal({
  action,
  batch,
  nextStageName,
  onCancel,
  onConfirm,
}: {
  action: "claim" | "forward";
  batch: BatchRecord;
  nextStageName?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claiming = action === "claim";

  return (
    <Modal
      open
      onClose={onCancel}
      title={claiming ? "Start this batch?" : nextStageName ? `Send to ${nextStageName}?` : "Complete this batch?"}
      description={`${batch.batchNumber ?? batch.batchType} · ${batch.productName ?? "Unnamed product"}`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await onConfirm();
              } catch (err) {
                // Shown here rather than only on the board behind, which the
                // dialog covers.
                setError(err instanceof Error ? err.message : "That action failed.");
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Working…" : claiming ? "Start batch" : "Confirm"}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="mb-3">
          <PermissionNotice message={error} />
        </div>
      ) : null}
      <p className="text-sm text-foreground">
        {claiming
          ? "It moves into In progress, held by you. Nobody else can move it on while you have it."
          : nextStageName
            ? `It leaves this station and joins ${nextStageName}'s Incoming queue. The move is timestamped against your name.`
            : "It finishes the pipeline and is marked complete."}
      </p>
    </Modal>
  );
}

/** The press-and-hold menu: everything that can be done to one batch. */
function BatchActionsModal({
  batch,
  heldByMe,
  canSendBack,
  canFail,
  stageNumber,
  onClose,
  onAssign,
  onClaim,
  onSendBack,
  onFail,
}: {
  batch: BatchRecord;
  heldByMe: boolean;
  canSendBack: boolean;
  canFail: boolean;
  stageNumber: number;
  onClose: () => void;
  onAssign: () => void;
  onClaim: () => void;
  onSendBack: () => void;
  onFail: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={batch.batchNumber ?? `Type ${batch.batchType} batch`}
      description={batch.productName ?? "Unnamed product"}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-2">
        {!heldByMe ? (
          <>
            <ActionRow
              icon={<HandPalm size={20} weight="bold" />}
              title="Claim it myself"
              detail="Moves into In progress, held by you."
              onClick={onClaim}
            />
            <ActionRow
              icon={<UserPlus size={20} weight="bold" />}
              title="Assign to an operator"
              detail="Hand it to a named person — only they can move it on."
              onClick={onAssign}
            />
          </>
        ) : null}

        {canSendBack ? (
          <ActionRow
            icon={<ArrowFatLeft size={20} weight="bold" />}
            title="Send back"
            detail="Returns it to the previous stage. You'll be asked why."
            onClick={onSendBack}
          />
        ) : (
          <PermissionNotice
            message={`Nothing sits behind stage ${stageNumber} but Batch Book entry, so a batch can't be sent back from here. Correct the record in Batch Book instead.`}
          />
        )}

        {canFail ? (
          <ActionRow
            icon={<XCircle size={20} weight="bold" />}
            title="Fail this batch"
            detail="Ends its journey for good. You'll be asked why."
            danger
            onClick={onFail}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function ActionRow({
  icon,
  title,
  detail,
  danger,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-interactive flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-lg
        border border-[var(--border)] bg-[var(--surface)] p-3 text-left"
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
        style={
          danger
            ? { background: "var(--danger-bg)", color: "var(--danger)" }
            : { background: "var(--brand-gradient)", color: "#fff" }
        }
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className="block text-sm font-bold"
          style={danger ? { color: "var(--danger)" } : { color: "var(--foreground)" }}
        >
          {title}
        </span>
        <span className="block text-xs text-[var(--muted-foreground)]">{detail}</span>
      </span>
    </button>
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

function ColumnHeading({ title, subtitle, count }: { title: string; subtitle?: string; count?: number }) {
  return (
    <div className="mb-2 px-1">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
        {count === undefined ? null : ` · ${count}`}
      </p>
      {subtitle ? <p className="text-[11px] text-[var(--subtle-foreground)]">{subtitle}</p> : null}
    </div>
  );
}

function BoardColumn({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <ColumnHeading title={title} count={count} />
      <div className="grid gap-2">{count === 0 ? <EmptyColumnNote /> : children}</div>
    </div>
  );
}

function DroppableColumn({
  id,
  title,
  subtitle,
  count,
  hint,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  count: number;
  /** Shown instead of cards for a column that only receives drops. */
  hint?: string;
  children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div>
      <ColumnHeading title={title} subtitle={subtitle} count={hint ? undefined : count} />
      <div
        ref={setNodeRef}
        className={`grid gap-2 rounded-lg p-1 transition-[background-color,outline-color,box-shadow] duration-200 ${
          isOver
            ? "bg-[var(--brand-50)] outline-2 outline-dashed outline-[var(--brand-500)] shadow-[var(--shadow-glow)]"
            : "outline-2 outline-dashed outline-transparent"
        }`}
      >
        {hint ? (
          <div
            className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed
              px-4 py-8 text-center transition-[border-color,transform] duration-200 ${
                isOver ? "scale-[1.02] border-[var(--brand-500)]" : "border-[var(--border-strong)]"
              }`}
          >
            <ArrowFatRight size={26} weight="bold" className="text-[var(--muted-foreground)]" />
            <p className="max-w-[16rem] text-xs text-[var(--muted-foreground)]">{hint}</p>
          </div>
        ) : count === 0 ? (
          <EmptyColumnNote />
        ) : (
          children
        )}
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
  onHold,
  children,
}: {
  batch: BatchRecord;
  returned?: boolean;
  isNew?: boolean;
  onHold?: () => void;
  children?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: batch.id });
  const { holding, handlers } = useHold(onHold);
  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab touch-none select-none transition-[transform,opacity,border-color] duration-150 active:cursor-grabbing ${
        // Left behind as a placeholder while the overlay copy is dragged.
        isDragging ? "opacity-40 border-dashed" : ""
      } ${holding ? "scale-[0.98] border-[var(--primary)]" : ""} ${
        isNew ? "border-[var(--brand-600)] ring-2 ring-[var(--brand-200)]" : ""
      }`}
    >
      {/* The hold lives on an inner element so its pointer events still
          bubble to dnd-kit's listeners on the card. */}
      <div {...handlers}>
        <BatchCardBody batch={batch} newBadge={isNew} />
        {returned ? (
          <p className="mt-1.5 text-[11px] font-semibold text-[var(--status-qa)]">Sent back for rework</p>
        ) : null}
      </div>
      {children ? <div className="mt-2.5">{children}</div> : null}
    </Card>
  );
}

function InProgressCard({
  entry,
  isMine,
  onHold,
}: {
  entry: InProgressEntry;
  isMine: boolean;
  onHold: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.batch.id,
    disabled: !isMine,
  });
  const { holding, handlers } = useHold(isMine ? onHold : undefined);
  return (
    <Card
      ref={setNodeRef}
      {...(isMine ? listeners : {})}
      {...(isMine ? attributes : {})}
      className={`transition-[transform,opacity,border-color] duration-150 ${
        isMine ? "cursor-grab touch-none active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-40 border-dashed" : ""} ${holding ? "scale-[0.98] border-[var(--primary)]" : ""}`}
    >
      <div {...handlers}>
        <BatchCardBody batch={entry.batch} />
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--muted-foreground)]">
          <HandPalm size={12} weight="bold" />
          {isMine ? "Held by you" : `Held by ${entry.operatorName}`}
        </p>
      </div>
      {isMine ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button variant="ghost" onClick={onHold}>
            <DotsThree size={20} weight="bold" />
            Actions
          </Button>
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

function ReasonModal({
  title,
  description,
  batchLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: string;
  batchLabel?: string;
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
        {batchLabel ? <p className="text-sm font-semibold text-foreground">{batchLabel}</p> : null}
        <Field
          label="Reason"
          htmlFor="reason-notes"
          required
          helper="Recorded against the batch — the next person to pick it up sees this."
        >
          <Textarea
            id="reason-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What needs correcting?"
          />
        </Field>
      </div>
    </Modal>
  );
}
