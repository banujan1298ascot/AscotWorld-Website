/**
 * Labels printed at Check 2 — the first print and any reprints/reruns.
 * Recorded through the MES by Check 2 only (canRecordLabels); each run is an
 * insert-only label_print_runs row, and the batch's totals on batch_records
 * (which the Batch Book shows, read-only) move in the same transaction, with
 * an audit entry like any other change to the record.
 */
import { and, asc, eq } from "drizzle-orm";
import { ApiError } from "../apiError";
import { db } from "../db/client";
import { batchRecords, labelPrintRuns, stageDefinitions, staff } from "../db/schema";
import type { ActingStaff } from "../actingStaff";
import { diffFields, writeAuditEntries } from "../batch-book/audit";
import { canRecordLabels, checkLabelRun, LABEL_STATION_SEQUENCE } from "./validation";

export type LabelPrintKind = "FIRST_PRINT" | "REPRINT";

export interface LabelRun {
  id: string;
  kind: LabelPrintKind;
  quantity: number;
  reason: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
}

export interface LabelRecord {
  labelsPrinted: number | null;
  labelsReprinted: number;
  /** Oldest first — a corrected first print shows both figures. */
  runs: LabelRun[];
}

export async function getLabelRecord(batchId: string): Promise<LabelRecord> {
  const [batch] = await db
    .select({ labelsPrinted: batchRecords.labelsPrinted, labelsReprinted: batchRecords.labelsReprinted })
    .from(batchRecords)
    .where(eq(batchRecords.id, batchId))
    .limit(1);
  if (!batch) throw new ApiError(404, "Batch not found.");

  const rows = await db
    .select({
      id: labelPrintRuns.id,
      kind: labelPrintRuns.kind,
      quantity: labelPrintRuns.quantity,
      reason: labelPrintRuns.reason,
      recordedById: labelPrintRuns.recordedBy,
      recordedByName: staff.name,
      recordedAt: labelPrintRuns.recordedAt,
    })
    .from(labelPrintRuns)
    .innerJoin(staff, eq(staff.id, labelPrintRuns.recordedBy))
    .where(eq(labelPrintRuns.batchId, batchId))
    .orderBy(asc(labelPrintRuns.recordedAt));

  return {
    ...batch,
    runs: rows.map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString() })),
  };
}

export interface LabelRunInput {
  kind: LabelPrintKind;
  quantity: unknown;
  reason?: string | null;
}

export async function recordLabelRun(
  batchId: string,
  input: LabelRunInput,
  actingStaff: ActingStaff,
): Promise<LabelRecord> {
  if (input.kind !== "FIRST_PRINT" && input.kind !== "REPRINT") {
    throw new ApiError(400, "kind must be FIRST_PRINT or REPRINT.");
  }

  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batchRecords).where(eq(batchRecords.id, batchId)).limit(1).for("update");
    if (!batch) throw new ApiError(404, "Batch not found.");

    const [stage] = await tx
      .select()
      .from(stageDefinitions)
      .where(
        and(
          eq(stageDefinitions.departmentId, batch.departmentId),
          eq(stageDefinitions.sequenceNumber, LABEL_STATION_SEQUENCE),
        ),
      )
      .limit(1);
    if (!stage) throw new ApiError(409, "This batch's department has no labelling station.");

    const [me] = await tx
      .select({ operatorRole: staff.operatorRole })
      .from(staff)
      .where(eq(staff.id, actingStaff.id))
      .limit(1);
    const permission = canRecordLabels({ ...actingStaff, operatorRole: me?.operatorRole ?? null }, stage);
    if (!permission.ok) throw new ApiError(403, permission.error);

    if (batch.currentStageId !== stage.id) {
      throw new ApiError(409, `Labels can only be recorded while the batch is at ${stage.name}.`);
    }

    const verdict = checkLabelRun(input, batch);
    if (!verdict.ok) throw new ApiError(422, verdict.error);
    const quantity = input.quantity as number;
    const reason = input.reason?.trim() || null;

    await tx.insert(labelPrintRuns).values({
      batchId,
      stageId: stage.id,
      kind: input.kind,
      quantity,
      reason,
      recordedBy: actingStaff.id,
    });

    const totals =
      input.kind === "FIRST_PRINT"
        ? { labelsPrinted: quantity, labelsReprinted: batch.labelsReprinted }
        : { labelsPrinted: batch.labelsPrinted, labelsReprinted: batch.labelsReprinted + quantity };
    await tx
      .update(batchRecords)
      .set({ ...totals, updatedAt: new Date() })
      .where(eq(batchRecords.id, batchId));

    await writeAuditEntries(tx, {
      batchId,
      changedBy: actingStaff.id,
      reason: reason ?? (input.kind === "REPRINT" ? "Labels reprinted" : "Labels printed"),
      changes: diffFields(
        { labelsPrinted: batch.labelsPrinted, labelsReprinted: batch.labelsReprinted },
        totals,
      ),
    });
  });

  return getLabelRecord(batchId);
}
