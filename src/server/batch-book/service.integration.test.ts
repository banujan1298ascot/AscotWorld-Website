/**
 * Integration tests against a real Postgres — the numbering concurrency
 * guarantee and the audit trail can't be honestly proven against a mock;
 * they depend on actual row-locking/upsert behaviour. Gated behind
 * DATABASE_URL so `npm test` still passes with no database configured.
 *
 * To run these: `docker compose up -d`, then `cp .env.example .env` (or set
 * DATABASE_URL yourself), `npm run db:migrate`, `npm test`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/client";
import { auditLogEntries, batchRecords, departments, staff } from "../db/schema";
import { confirmBatch, createDraft, updateBatch } from "./service";
import type { ActingStaff } from "./validation";

const RUN = Boolean(process.env.DATABASE_URL);
if (!RUN) {
  console.warn(
    "Skipping Batch Book integration tests — set DATABASE_URL to run them against a real Postgres. See docker-compose.yml.",
  );
}

describe.skipIf(!RUN)("Batch Book service (integration)", () => {
  const creator: ActingStaff = { id: "test_creator", role: "production" };
  const supervisor: ActingStaff = { id: "test_supervisor", role: "qa" };
  let departmentId: string;
  const createdBatchIds: string[] = [];

  beforeAll(async () => {
    await db
      .insert(staff)
      .values([
        { id: creator.id, name: "Test Creator", role: creator.role, email: "test.creator@example.test" },
        { id: supervisor.id, name: "Test Supervisor", role: supervisor.role, email: "test.supervisor@example.test" },
      ])
      .onConflictDoNothing({ target: staff.id });

    const [dept] = await db
      .insert(departments)
      .values({ name: `Test Dept ${Date.now()}` })
      .returning();
    departmentId = dept.id;
  });

  afterAll(async () => {
    if (createdBatchIds.length > 0) {
      await db.delete(auditLogEntries).where(inArray(auditLogEntries.batchId, createdBatchIds));
      await db.delete(batchRecords).where(inArray(batchRecords.id, createdBatchIds));
    }
    if (departmentId) await db.delete(departments).where(eq(departments.id, departmentId));
    await db.delete(staff).where(inArray(staff.id, [creator.id, supervisor.id]));
  });

  it("assigns unique, gap-free batch numbers to concurrent confirmations", async () => {
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () =>
        createDraft({ batchType: "A", departmentId, productName: "Concurrency test product" }, creator),
      ),
    );
    drafts.forEach((d) => createdBatchIds.push(d.id));

    // The real point of this test: fire all ten confirmations at once. If the
    // numbering weren't atomic, this is exactly the pattern that would
    // produce a duplicate or skipped number.
    const confirmed = await Promise.all(drafts.map((d) => confirmBatch(d.id, creator)));

    const labels = confirmed.map((b) => b.batchNumber);
    expect(new Set(labels).size).toBe(10);

    const sequences = confirmed.map((b) => b.batchSequence).sort((a, b) => (a ?? 0) - (b ?? 0));
    const first = sequences[0] ?? 0;
    sequences.forEach((seq, i) => expect(seq).toBe(first + i));
  });

  it("writes an audit entry for every field changed on confirmation", async () => {
    const draft = await createDraft({ batchType: "B", departmentId, productName: "Audit test product" }, creator);
    createdBatchIds.push(draft.id);

    await confirmBatch(draft.id, creator);

    const entries = await db.select().from(auditLogEntries).where(eq(auditLogEntries.batchId, draft.id));
    const fields = entries.map((e) => e.fieldChanged);
    expect(fields).toEqual(expect.arrayContaining(["status", "batchNumber", "batchSequence"]));

    const statusEntry = entries.find((e) => e.fieldChanged === "status");
    expect(statusEntry?.oldValue).toBe("DRAFT");
    expect(statusEntry?.newValue).toBe("CONFIRMED");
    expect(statusEntry?.changedBy).toBe(creator.id);
  });

  it("refuses a supervisor edit to a confirmed record without a reason, and logs it once one is given", async () => {
    const draft = await createDraft({ batchType: "C", departmentId, productName: "Original name" }, creator);
    createdBatchIds.push(draft.id);
    await confirmBatch(draft.id, creator);

    await expect(updateBatch(draft.id, { patch: { productName: "Corrected name" } }, supervisor)).rejects.toThrow(
      /reason is required/i,
    );

    await updateBatch(
      draft.id,
      { patch: { productName: "Corrected name" }, reason: "Typo fixed after QA review" },
      supervisor,
    );

    const entries = await db
      .select()
      .from(auditLogEntries)
      .where(and(eq(auditLogEntries.batchId, draft.id), eq(auditLogEntries.fieldChanged, "productName")));

    expect(entries).toHaveLength(1);
    expect(entries[0].oldValue).toBe("Original name");
    expect(entries[0].newValue).toBe("Corrected name");
    expect(entries[0].reason).toBe("Typo fixed after QA review");
    expect(entries[0].changedBy).toBe(supervisor.id);
  });

  it("refuses to change an immutable field once confirmed", async () => {
    const draft = await createDraft({ batchType: "D", departmentId, productName: "Immutable test" }, creator);
    createdBatchIds.push(draft.id);
    await confirmBatch(draft.id, creator);

    await expect(
      updateBatch(draft.id, { patch: { batchType: "A" }, reason: "trying to renumber" }, supervisor),
    ).rejects.toThrow(/immutable once confirmed/i);
  });
});
