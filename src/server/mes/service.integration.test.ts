/**
 * Integration tests against a real Postgres — claim exclusivity, the
 * forward/send-back/fail state machine, and the Batch Book -> MES handoff
 * all depend on real row locking and the DB-level unique index, so they
 * aren't mocked. Gated behind DATABASE_URL, same as the Batch Book suite.
 *
 * To run: `docker compose up -d`, `cp .env.example .env`, `npm run db:migrate`,
 * `npm test`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActingStaff } from "../actingStaff";
import { confirmBatch, createDraft } from "../batch-book/service";
import { db } from "../db/client";
import { batchRecords, departments, stageDefinitions, stageTransitions, staff } from "../db/schema";
import { claimBatch, failBatch, forwardBatch, getStageQueue, sendBatchBack } from "./service";

const RUN = Boolean(process.env.DATABASE_URL);
if (!RUN) {
  console.warn("Skipping MES integration tests — set DATABASE_URL to run them against a real Postgres.");
}

describe.skipIf(!RUN)("MES service (integration)", () => {
  const dataEntry: ActingStaff = { id: "test_mes_entry", role: "production" };
  const operator: ActingStaff = { id: "test_mes_operator", role: "production" };
  const otherOperator: ActingStaff = { id: "test_mes_other", role: "production" };

  let departmentId: string;
  let stage1Id: string;
  let stage2Id: string;
  let stage3Id: string;
  let stage4Id: string;
  const createdBatchIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(staff)
      .values([
        { id: dataEntry.id, name: "Test Data Entry", role: dataEntry.role, email: "test.mes.entry@example.test" },
        { id: operator.id, name: "Test Operator", role: operator.role, email: "test.mes.operator@example.test" },
        {
          id: otherOperator.id,
          name: "Test Other Operator",
          role: otherOperator.role,
          email: "test.mes.other@example.test",
        },
      ])
      .onConflictDoNothing({ target: staff.id });

    const [dept] = await db.insert(departments).values({ name: `Test MES Dept ${Date.now()}` }).returning();
    departmentId = dept.id;

    const stages = await db
      .insert(stageDefinitions)
      .values([
        { departmentId, sequenceNumber: 1, name: "Batch Book Entry", failAuthority: false, isTerminalReleaseStage: false },
        { departmentId, sequenceNumber: 2, name: "Order/Calculation Check", failAuthority: false, isTerminalReleaseStage: false },
        { departmentId, sequenceNumber: 3, name: "Raw Material Picking", failAuthority: false, isTerminalReleaseStage: false },
        { departmentId, sequenceNumber: 4, name: "Supervisor Material Check", failAuthority: true, isTerminalReleaseStage: false },
      ])
      .returning();
    stage1Id = stages.find((s) => s.sequenceNumber === 1)!.id;
    stage2Id = stages.find((s) => s.sequenceNumber === 2)!.id;
    stage3Id = stages.find((s) => s.sequenceNumber === 3)!.id;
    stage4Id = stages.find((s) => s.sequenceNumber === 4)!.id;
  });

  afterAll(async () => {
    if (createdBatchIds.length > 0) {
      await db.delete(stageTransitions).where(inArray(stageTransitions.batchId, createdBatchIds));
      await db.delete(batchRecords).where(inArray(batchRecords.id, createdBatchIds));
    }
    if (departmentId) {
      await db.delete(stageDefinitions).where(eq(stageDefinitions.departmentId, departmentId));
      await db.delete(departments).where(eq(departments.id, departmentId));
    }
    await db.delete(staff).where(inArray(staff.id, [dataEntry.id, operator.id, otherOperator.id]));
  });

  async function confirmedBatchAtStage2() {
    const draft = await createDraft({ batchType: "A", departmentId, productName: "MES test product" }, dataEntry);
    createdBatchIds.push(draft.id);
    return confirmBatch(draft.id, dataEntry);
  }

  it("dispatches a confirmed batch straight to stage 2, with stage 1 already closed out", async () => {
    const batch = await confirmedBatchAtStage2();
    expect(batch.status).toBe("IN_PROGRESS");
    expect(batch.currentStageId).toBe(stage2Id);
    expect(batch.currentStageArrival).toBe("FORWARD");

    const stage1Transitions = await db
      .select()
      .from(stageTransitions)
      .where(and(eq(stageTransitions.batchId, batch.id), eq(stageTransitions.stageId, stage1Id)));
    expect(stage1Transitions).toHaveLength(1);
    expect(stage1Transitions[0].outcome).toBe("FORWARD");
    expect(stage1Transitions[0].completedAt).not.toBeNull();
  });

  it("never dispatches an M-type batch, even into a department that has a real pipeline configured", async () => {
    const draft = await createDraft({ batchType: "M", departmentId, productName: "M batch test product" }, dataEntry);
    createdBatchIds.push(draft.id);

    const confirmed = await confirmBatch(draft.id, dataEntry);

    expect(confirmed.batchNumber).toMatch(/^M\d{2}-0001$/);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.currentStageId).toBeNull();
    expect(confirmed.currentStageArrival).toBeNull();

    const stage1Transitions = await db
      .select()
      .from(stageTransitions)
      .where(and(eq(stageTransitions.batchId, confirmed.id), eq(stageTransitions.stageId, stage1Id)));
    expect(stage1Transitions).toHaveLength(0);
  });

  it("shows a freshly-dispatched batch in the next stage's Incoming column, not Returned", async () => {
    const batch = await confirmedBatchAtStage2();
    const queue = await getStageQueue(stage2Id);
    expect(queue.incoming.map((b) => b.id)).toContain(batch.id);
    expect(queue.returned.map((b) => b.id)).not.toContain(batch.id);
  });

  it("claim moves a batch from Incoming into In Progress, attributed to the claimant", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);

    const queue = await getStageQueue(stage2Id);
    expect(queue.incoming.map((b) => b.id)).not.toContain(batch.id);
    const inProgress = queue.inProgress.find((e) => e.batch.id === batch.id);
    expect(inProgress?.operatorId).toBe(operator.id);
  });

  it("refuses a second claim on a batch that's already claimed", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);
    await expect(claimBatch(stage2Id, batch.id, otherOperator)).rejects.toThrow(/already been claimed/i);
  });

  it("enforces claim exclusivity — one operator can't hold two open batches at once", async () => {
    const batchA = await confirmedBatchAtStage2();
    const batchB = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batchA.id, operator);
    await expect(claimBatch(stage2Id, batchB.id, operator)).rejects.toThrow(/already have another batch in progress/i);
  });

  it("forward moves a claimed batch into the next stage's Incoming queue", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);
    const updated = await forwardBatch(stage2Id, batch.id, operator);

    expect(updated.currentStageId).toBe(stage3Id);
    expect(updated.currentStageArrival).toBe("FORWARD");
    const stage3Queue = await getStageQueue(stage3Id);
    expect(stage3Queue.incoming.map((b) => b.id)).toContain(batch.id);
  });

  it("refuses forward from someone who didn't claim the batch", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);
    await expect(forwardBatch(stage2Id, batch.id, otherOperator)).rejects.toThrow(/only the operator who claimed/i);
  });

  it("send-back requires a reason and returns the batch to the previous stage's Returned queue", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);
    await forwardBatch(stage2Id, batch.id, operator); // now at stage 3
    await claimBatch(stage3Id, batch.id, operator);

    const updated = await sendBatchBack(stage3Id, batch.id, operator, "missing lot number");
    expect(updated.currentStageId).toBe(stage2Id);
    expect(updated.currentStageArrival).toBe("RETURNED");

    const stage2Queue = await getStageQueue(stage2Id);
    expect(stage2Queue.returned.map((b) => b.id)).toContain(batch.id);
    expect(stage2Queue.incoming.map((b) => b.id)).not.toContain(batch.id);
  });

  it("refuses send-back from stage 2 (there is no screen for Batch Book Entry to receive it)", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);
    await expect(sendBatchBack(stage2Id, batch.id, operator, "some reason")).rejects.toThrow(/batch book entry/i);
  });

  it("fail is refused without fail authority, allowed with it, and ends the batch's journey", async () => {
    const batch = await confirmedBatchAtStage2();
    await claimBatch(stage2Id, batch.id, operator);
    await expect(failBatch(stage2Id, batch.id, operator, "contamination")).rejects.toThrow(/cannot fail a batch/i);

    await forwardBatch(stage2Id, batch.id, operator); // stage 3
    await claimBatch(stage3Id, batch.id, operator);
    await forwardBatch(stage3Id, batch.id, operator); // stage 4, which has fail authority
    await claimBatch(stage4Id, batch.id, operator);

    const failed = await failBatch(stage4Id, batch.id, operator, "raw material contamination found");
    expect(failed.status).toBe("FAILED");
    expect(failed.currentStageId).toBeNull();

    const [transition] = await db
      .select()
      .from(stageTransitions)
      .where(and(eq(stageTransitions.batchId, batch.id), eq(stageTransitions.stageId, stage4Id)));
    expect(transition.outcome).toBe("FAILED");
    expect(transition.investigationFlagged).toBe(true);
  });
});
