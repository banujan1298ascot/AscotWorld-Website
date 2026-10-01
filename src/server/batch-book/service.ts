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
import {
  canConfirmBatch,
  canCreateDraft,
  canEditBatch,
  canEditFields,
  checkPriorityAndDestination,
  checkProductFields,
  type ActingStaff,
} from "./validation";
import { composeProductName } from "@/lib/products";

export type BatchRecordRow = typeof batchRecords.$inferSelect;

export interface CreateDraftInput {
  batchType: BatchType;
  departmentId: string;
  /** Only for callers without the separate fields (older scripts); when
   *  `medicineName` is given the full name is built from the fields. */
  productName?: string | null;
  medicineName?: string | null;
  strength?: string | null;
  dosageForm?: BatchRecordRow["dosageForm"];
  packSize?: string | number | null;
  packUnit?: BatchRecordRow["packUnit"];
  quantity?: string | null;
  unit?: string | null;
  plannedManufactureDate?: string | null;
  urgent?: boolean;
  destination?: BatchRecordRow["destination"];
  customFields?: Record<string, unknown>;
}

const trimmedOrNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
const packSizeValue = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? null : String(Number(value));

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
  const fields = checkPriorityAndDestination(input);
  if (!fields.ok) throw new ApiError(422, fields.error);
  const product = checkProductFields(input);
  if (!product.ok) throw new ApiError(422, product.error);

  const medicineName = trimmedOrNull(input.medicineName);
  const strength = trimmedOrNull(input.strength);
  const dosageForm = input.dosageForm ?? null;

  const [row] = await db
    .insert(batchRecords)
    .values({
      batchType: input.batchType,
      departmentId: input.departmentId,
      productName: composeProductName({ medicineName, strength, dosageForm }) ?? input.productName ?? null,
      medicineName,
      strength,
      dosageForm,
      packSize: packSizeValue(input.packSize),
      packUnit: input.packUnit ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      plannedManufactureDate: input.plannedManufactureDate ?? null,
      urgent: input.urgent ?? false,
      destination: input.destination ?? null,
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
      | "batchType"
      | "departmentId"
      | "productName"
      | "medicineName"
      | "strength"
      | "dosageForm"
      | "packSize"
      | "packUnit"
      | "quantity"
      | "unit"
      | "plannedManufactureDate"
      | "urgent"
      | "destination"
      | "customFields"
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

    const fieldsAllowed = canEditFields(existing, Object.keys(input.patch));
    if (!fieldsAllowed.ok) throw new ApiError(422, fieldsAllowed.error);
    const values = checkPriorityAndDestination(input.patch);
    if (!values.ok) throw new ApiError(422, values.error);
    const merged = { ...existing, ...input.patch };
    const product = checkProductFields({
      medicineName: input.patch.medicineName,
      strength: input.patch.strength,
      // Checked against the batch's resulting type and unit together, so a
      // patch changing only one can't leave them mismatched.
      dosageForm: merged.dosageForm,
      packSize: input.patch.packSize,
      packUnit: merged.packUnit,
    });
    if (!product.ok) throw new ApiError(422, product.error);

    // Editing the product's parts rebuilds its full name, so the rest of the
    // portal (and the audit trail) sees the same change.
    const patch: UpdateBatchInput["patch"] = { ...input.patch };
    if ("medicineName" in patch || "strength" in patch || "dosageForm" in patch) {
      patch.medicineName = trimmedOrNull(merged.medicineName);
      patch.strength = trimmedOrNull(merged.strength);
      const composed = composeProductName({
        medicineName: patch.medicineName,
        strength: patch.strength,
        dosageForm: merged.dosageForm,
      });
      if (composed) patch.productName = composed;
    }
    if ("packSize" in patch) patch.packSize = packSizeValue(patch.packSize);
    const patchKeys = Object.keys(patch);

    const [updated] = await tx
      .update(batchRecords)
      .set(patch)
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
