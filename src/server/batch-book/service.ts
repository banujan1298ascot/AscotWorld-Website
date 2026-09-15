/**
 * Batch Book orchestration — the only place that touches batch_records
 * directly. Each function: (1) loads what it needs, (2) checks the pure
 * rules in validation.ts, (3) writes, recording an audit entry for every
 * changed field. Confirm and edit both run inside a single transaction so a
 * failure partway through (e.g. the audit insert) rolls back the rest.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { ApiError } from "../apiError";
import { db } from "../db/client";
import { batchRecords, stageDefinitions, stageTransitions } from "../db/schema";
import { diffFields, writeAuditEntries } from "./audit";
import { assignNextBatchNumber, type BatchType } from "./numbering";
import { canConfirmBatch, canCreateDraft, canEditBatch, canEditFields, type ActingStaff } from "./validation";

export type BatchRecordRow = typeof batchRecords.$inferSelect;

export interface CreateDraftInput {
  batchType: BatchType;
  departmentId: string;
  productName?: string | null;
  quantity?: string | null;
  unit?: string | null;
  plannedManufactureDate?: string | null;
  customFields?: Record<string, unknown>;
}

export async function listBatches(filter?: { status?: BatchRecordRow["status"] }): Promise<BatchRecordRow[]> {
  return db
    .select()
    .from(batchRecords)
    .where(filter?.status ? eq(batchRecords.status, filter.status) : undefined)
    .orderBy(desc(batchRecords.createdAt));
}

export async function getBatch(id: string): Promise<BatchRecordRow> {
  const [row] = await db.select().from(batchRecords).where(eq(batchRecords.id, id)).limit(1);
  if (!row) throw new ApiError(404, "Batch not found.");
  return row;
}

export async function createDraft(input: CreateDraftInput, actingStaff: ActingStaff): Promise<BatchRecordRow> {
  const verdict = canCreateDraft(actingStaff);
  if (!verdict.ok) throw new ApiError(403, verdict.error);

  const [row] = await db
    .insert(batchRecords)
    .values({
      batchType: input.batchType,
      departmentId: input.departmentId,
      productName: input.productName ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      plannedManufactureDate: input.plannedManufactureDate ?? null,
      customFields: input.customFields ?? {},
      status: "DRAFT",
      createdBy: actingStaff.id,
    })
    .returning();

  return row;
}

export interface UpdateBatchInput {
  patch: Partial<
    Pick<
      BatchRecordRow,
      "batchType" | "departmentId" | "productName" | "quantity" | "unit" | "plannedManufactureDate" | "customFields"
    >
  >;
  /** Required by canEditBatch once the record is past DRAFT. */
  reason?: string | null;
}

export async function updateBatch(
  id: string,
  input: UpdateBatchInput,
  actingStaff: ActingStaff,
): Promise<BatchRecordRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(batchRecords).where(eq(batchRecords.id, id)).limit(1).for("update");
    if (!existing) throw new ApiError(404, "Batch not found.");

    const permission = canEditBatch(actingStaff, existing, input.reason);
    if (!permission.ok) throw new ApiError(403, permission.error);

    const patchKeys = Object.keys(input.patch);
    const fieldsAllowed = canEditFields(existing, patchKeys);
    if (!fieldsAllowed.ok) throw new ApiError(422, fieldsAllowed.error);

    const [updated] = await tx
      .update(batchRecords)
      .set(input.patch)
      .where(eq(batchRecords.id, id))
      .returning();

    const before = Object.fromEntries(patchKeys.map((key) => [key, existing[key as keyof BatchRecordRow]]));
    const after = Object.fromEntries(patchKeys.map((key) => [key, updated[key as keyof BatchRecordRow]]));
    const changes = diffFields(before, after);
    await writeAuditEntries(tx, {
      batchId: id,
      changedBy: actingStaff.id,
      reason: input.reason ?? null,
      changes,
    });

    return updated;
  });
}

export async function confirmBatch(id: string, actingStaff: ActingStaff): Promise<BatchRecordRow> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(batchRecords).where(eq(batchRecords.id, id)).limit(1).for("update");
    if (!existing) throw new ApiError(404, "Batch not found.");

    const permission = canConfirmBatch(actingStaff, existing);
    if (!permission.ok) throw new ApiError(403, permission.error);

    const { sequence, label } = await assignNextBatchNumber(tx, existing.batchType as BatchType);

    // Stage 1 (Batch Book Entry) *is* this confirm action — the data entry
    // and the confirmation are the same piece of work (spec 3.0's own table
    // lists "batch confirmed" as part of what stage 1 covers). So confirming
    // auto-closes a stage-1 transition (attributed to whoever entered it,
    // spanning from the draft's creation to now) and dispatches straight into
    // stage 2's Incoming queue — there's no claim/drag screen for stage 1
    // itself. If the department has no stages configured yet (Phase 2 hasn't
    // seeded them for this department), the batch just stays CONFIRMED with
    // no current stage until it does.
    //
    // M-type batches are the exception (clarified 2026-09-15): they don't go
    // through Bespoke's pipeline — Bespoke's Check 1-6 + Warehouse is for
    // other batch types only. M needs its own, separately-designed MES that
    // doesn't exist yet, so an M batch is deliberately never dispatched here
    // — it's numbered and confirmed, same as any other type, and just stays
    // there with no current stage until that pipeline exists.
    const openingStages =
      existing.batchType === "M"
        ? []
        : await tx
            .select()
            .from(stageDefinitions)
            .where(
              and(
                eq(stageDefinitions.departmentId, existing.departmentId),
                inArray(stageDefinitions.sequenceNumber, [1, 2]),
              ),
            );
    const stage1 = openingStages.find((s) => s.sequenceNumber === 1);
    const stage2 = openingStages.find((s) => s.sequenceNumber === 2);

    const now = new Date();
    const dispatched = Boolean(stage1 && stage2);

    const [updated] = await tx
      .update(batchRecords)
      .set({
        batchNumber: label,
        batchSequence: sequence,
        status: dispatched ? "IN_PROGRESS" : "CONFIRMED",
        confirmedBy: actingStaff.id,
        confirmedAt: now,
        currentStageId: dispatched ? stage2!.id : null,
        currentStageArrival: dispatched ? "FORWARD" : null,
      })
      .where(eq(batchRecords.id, id))
      .returning();

    if (dispatched) {
      await tx.insert(stageTransitions).values({
        batchId: id,
        stageId: stage1!.id,
        operatorId: existing.createdBy,
        receivedAt: existing.createdAt,
        completedAt: now,
        outcome: "FORWARD",
        destinationStageId: stage2!.id,
      });
    }

    const changes = diffFields(
      {
        batchNumber: existing.batchNumber,
        batchSequence: existing.batchSequence,
        status: existing.status,
        confirmedBy: existing.confirmedBy,
        confirmedAt: existing.confirmedAt,
        currentStageId: existing.currentStageId,
        currentStageArrival: existing.currentStageArrival,
      },
      {
        batchNumber: updated.batchNumber,
        batchSequence: updated.batchSequence,
        status: updated.status,
        confirmedBy: updated.confirmedBy,
        confirmedAt: updated.confirmedAt,
        currentStageId: updated.currentStageId,
        currentStageArrival: updated.currentStageArrival,
      },
    );
    await writeAuditEntries(tx, { batchId: id, changedBy: actingStaff.id, reason: null, changes });

    return updated;
  });
}
