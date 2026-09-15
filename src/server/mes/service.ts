/**
 * MES stage orchestration (spec 3). Mirrors the shape of
 * src/server/batch-book/service.ts: load, check the pure rules in
 * validation.ts, write. Claim/forward/send-back/fail each run inside one
 * transaction and lock the batch row first, so two operators racing to
 * claim (or forward) the same batch serialize instead of double-processing
 * it — separately from the DB-level claim-exclusivity index that stops one
 * operator holding two batches at once.
 */
import { and, eq, isNull } from "drizzle-orm";
import { ApiError } from "../apiError";
import { db, type Db } from "../db/client";
import { batchRecords, stageDefinitions, stageTransitions, staff } from "../db/schema";
import type { ActingStaff } from "../actingStaff";
import { canActOnTransition, canClaim, canFail, canForward, canSendBack, type StageForAuth } from "./validation";

export type StageRow = typeof stageDefinitions.$inferSelect;
export type BatchRecordRow = typeof batchRecords.$inferSelect;
export type StageTransitionRow = typeof stageTransitions.$inferSelect;

/** Postgres unique_violation — thrown when an operator tries to claim a
 *  second batch while already holding one open elsewhere (the DB-level
 *  guarantee behind spec 3.3's claim exclusivity). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function listStages(departmentId?: string): Promise<StageRow[]> {
  return db
    .select()
    .from(stageDefinitions)
    .where(departmentId ? eq(stageDefinitions.departmentId, departmentId) : undefined)
    .orderBy(stageDefinitions.sequenceNumber);
}

async function requireStage(dbOrTx: Db, stageId: string): Promise<StageRow> {
  const [row] = await dbOrTx.select().from(stageDefinitions).where(eq(stageDefinitions.id, stageId)).limit(1);
  if (!row) throw new ApiError(404, "Stage not found.");
  return row;
}

export interface StageQueue {
  stage: StageRow;
  incoming: BatchRecordRow[];
  returned: BatchRecordRow[];
  inProgress: Array<{ batch: BatchRecordRow; operatorId: string; operatorName: string; receivedAt: Date }>;
}

/** The three columns a stage's board shows (spec 3.1, 3.3). */
export async function getStageQueue(stageId: string): Promise<StageQueue> {
  const stage = await requireStage(db, stageId);

  const [batchesAtStage, openTransitions] = await Promise.all([
    db.select().from(batchRecords).where(eq(batchRecords.currentStageId, stageId)),
    db
      .select({
        batchId: stageTransitions.batchId,
        operatorId: stageTransitions.operatorId,
        operatorName: staff.name,
        receivedAt: stageTransitions.receivedAt,
      })
      .from(stageTransitions)
      .innerJoin(staff, eq(staff.id, stageTransitions.operatorId))
      .where(and(eq(stageTransitions.stageId, stageId), isNull(stageTransitions.completedAt))),
  ]);

  const claimed = new Map(openTransitions.map((t) => [t.batchId, t]));
  const batchById = new Map(batchesAtStage.map((b) => [b.id, b]));

  const incoming = batchesAtStage.filter((b) => !claimed.has(b.id) && b.currentStageArrival === "FORWARD");
  const returned = batchesAtStage.filter((b) => !claimed.has(b.id) && b.currentStageArrival === "RETURNED");
  const inProgress = openTransitions.flatMap((t) => {
    const batch = batchById.get(t.batchId);
    return batch ? [{ batch, operatorId: t.operatorId, operatorName: t.operatorName, receivedAt: t.receivedAt }] : [];
  });

  return { stage, incoming, returned, inProgress };
}

async function requireOpenTransition(
  tx: Db,
  stageId: string,
  batchId: string,
): Promise<StageTransitionRow | undefined> {
  const [row] = await tx
    .select()
    .from(stageTransitions)
    .where(and(eq(stageTransitions.batchId, batchId), eq(stageTransitions.stageId, stageId), isNull(stageTransitions.completedAt)))
    .limit(1);
  return row;
}

export async function claimBatch(stageId: string, batchId: string, actingStaff: ActingStaff): Promise<StageTransitionRow> {
  const permission = canClaim(actingStaff);
  if (!permission.ok) throw new ApiError(403, permission.error);

  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchRecords).where(eq(batchRecords.id, batchId)).limit(1).for("update");
    if (!batch) throw new ApiError(404, "Batch not found.");
    if (batch.currentStageId !== stageId) {
      throw new ApiError(409, "This batch is not currently at this stage.");
    }
    if (await requireOpenTransition(tx, stageId, batchId)) {
      throw new ApiError(409, "This batch has already been claimed.");
    }

    try {
      const [transition] = await tx
        .insert(stageTransitions)
        .values({ batchId, stageId, operatorId: actingStaff.id })
        .returning();
      return transition;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(
          409,
          "You already have another batch in progress — finish or return it before claiming a new one.",
        );
      }
      throw err;
    }
  });
}

export async function forwardBatch(stageId: string, batchId: string, actingStaff: ActingStaff): Promise<BatchRecordRow> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchRecords).where(eq(batchRecords.id, batchId)).limit(1).for("update");
    if (!batch) throw new ApiError(404, "Batch not found.");

    const openTransition = await requireOpenTransition(tx, stageId, batchId);
    const ownership = canActOnTransition(actingStaff, openTransition);
    if (!ownership.ok) throw new ApiError(403, ownership.error);

    const permission = canForward(actingStaff);
    if (!permission.ok) throw new ApiError(403, permission.error);

    const stage = await requireStage(tx, stageId);
    const [nextStage] = await tx
      .select()
      .from(stageDefinitions)
      .where(
        and(eq(stageDefinitions.departmentId, stage.departmentId), eq(stageDefinitions.sequenceNumber, stage.sequenceNumber + 1)),
      )
      .limit(1);

    const now = new Date();
    await tx
      .update(stageTransitions)
      .set({ completedAt: now, outcome: "FORWARD", destinationStageId: nextStage?.id ?? null })
      .where(eq(stageTransitions.id, openTransition!.id));

    const [updated] = await tx
      .update(batchRecords)
      .set(
        nextStage
          ? { currentStageId: nextStage.id, currentStageArrival: "FORWARD" as const }
          // No next stage (forwarding out of Warehouse, spec 3.0's stage 7) —
          // the batch has fully completed the pipeline.
          : { currentStageId: null, currentStageArrival: null, status: "COMPLETED" as const },
      )
      .where(eq(batchRecords.id, batchId))
      .returning();

    return updated;
  });
}

export async function sendBatchBack(
  stageId: string,
  batchId: string,
  actingStaff: ActingStaff,
  notes: string,
  reasonCodeId?: string | null,
): Promise<BatchRecordRow> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchRecords).where(eq(batchRecords.id, batchId)).limit(1).for("update");
    if (!batch) throw new ApiError(404, "Batch not found.");

    const openTransition = await requireOpenTransition(tx, stageId, batchId);
    const ownership = canActOnTransition(actingStaff, openTransition);
    if (!ownership.ok) throw new ApiError(403, ownership.error);

    const stage = await requireStage(tx, stageId);
    const permission = canSendBack(actingStaff, stage, notes);
    if (!permission.ok) throw new ApiError(403, permission.error);

    const [prevStage] = await tx
      .select()
      .from(stageDefinitions)
      .where(
        and(eq(stageDefinitions.departmentId, stage.departmentId), eq(stageDefinitions.sequenceNumber, stage.sequenceNumber - 1)),
      )
      .limit(1);
    if (!prevStage) throw new ApiError(500, "No previous stage configured for this department.");

    const now = new Date();
    await tx
      .update(stageTransitions)
      .set({
        completedAt: now,
        outcome: "SENT_BACK",
        destinationStageId: prevStage.id,
        notes,
        reasonCodeId: reasonCodeId ?? null,
      })
      .where(eq(stageTransitions.id, openTransition!.id));

    const [updated] = await tx
      .update(batchRecords)
      .set({ currentStageId: prevStage.id, currentStageArrival: "RETURNED" })
      .where(eq(batchRecords.id, batchId))
      .returning();

    return updated;
  });
}

export async function failBatch(
  stageId: string,
  batchId: string,
  actingStaff: ActingStaff,
  notes: string,
  reasonCodeId?: string | null,
): Promise<BatchRecordRow> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchRecords).where(eq(batchRecords.id, batchId)).limit(1).for("update");
    if (!batch) throw new ApiError(404, "Batch not found.");

    const openTransition = await requireOpenTransition(tx, stageId, batchId);
    const ownership = canActOnTransition(actingStaff, openTransition);
    if (!ownership.ok) throw new ApiError(403, ownership.error);

    const stage = await requireStage(tx, stageId);
    const permission = canFail(actingStaff, stage as StageForAuth, notes);
    if (!permission.ok) throw new ApiError(403, permission.error);

    const now = new Date();
    await tx
      .update(stageTransitions)
      .set({
        completedAt: now,
        outcome: "FAILED",
        destinationStageId: null,
        notes,
        reasonCodeId: reasonCodeId ?? null,
        investigationFlagged: true,
      })
      .where(eq(stageTransitions.id, openTransition!.id));

    const [updated] = await tx
      .update(batchRecords)
      .set({ status: "FAILED", currentStageId: null, currentStageArrival: null })
      .where(eq(batchRecords.id, batchId))
      .returning();

    return updated;
  });
}
