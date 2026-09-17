/**
 * One-off demo data for Batch Book + the MES pipeline, so the pipeline's
 * behaviour is visible without manually clicking through every state by
 * hand. Run after `npm run db:migrate && npm run db:seed`:
 *
 *   npx tsx scripts/seed-mes-demo.ts
 *
 * Creates nine batches spanning every state the MES board can show: an
 * untouched draft, a freshly-dispatched batch sitting in a stage's Incoming
 * queue, one claimed and left in progress, one forwarded through several
 * stages, one sent back to a previous stage (the Returned queue), one
 * failed, one sitting in Warehouse, one fully completed, and one M-type
 * batch that (by design — see docs/batch-book-api.md) never dispatches into
 * Bespoke's pipeline at all.
 *
 * Safe to re-run: each run just adds nine more batches under fresh batch
 * numbers, it never touches existing rows.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { departments, stageDefinitions } from "../src/server/db/schema";
import type { ActingStaff } from "../src/server/actingStaff";
import { confirmBatch, createDraft, type CreateDraftInput } from "../src/server/batch-book/service";
import { claimBatch, failBatch, forwardBatch, sendBatchBack } from "../src/server/mes/service";

const ADMIN: ActingStaff = { id: "staff_admin", role: "admin" };
const PROD1: ActingStaff = { id: "staff_prod_1", role: "production" };
const PROD2: ActingStaff = { id: "staff_prod_2", role: "production" };
const PROD3: ActingStaff = { id: "staff_prod_3", role: "production" };
const QA1: ActingStaff = { id: "staff_qa_1", role: "qa" };
const QA2: ActingStaff = { id: "staff_qa_2", role: "qa" };
const WAREHOUSE: ActingStaff = { id: "staff_wh", role: "production" };

async function main() {
  const [bespoke] = await db.select().from(departments).where(eq(departments.name, "Bespoke")).limit(1);
  if (!bespoke) {
    throw new Error("Bespoke department not found — run `npm run db:seed` first.");
  }

  const stageRows = await db
    .select()
    .from(stageDefinitions)
    .where(eq(stageDefinitions.departmentId, bespoke.id));
  const stageBySeq = new Map(stageRows.map((s) => [s.sequenceNumber, s]));
  const stageId = (sequenceNumber: number): string => {
    const stage = stageBySeq.get(sequenceNumber);
    if (!stage) throw new Error(`Stage ${sequenceNumber} not found for Bespoke — run db:seed first.`);
    return stage.id;
  };

  async function draftAndConfirm(actor: ActingStaff, input: Omit<CreateDraftInput, "departmentId">) {
    const draft = await createDraft({ ...input, departmentId: bespoke.id }, actor);
    return confirmBatch(draft.id, actor);
  }

  console.log("Seeding Batch Book + MES demo data against the Bespoke pipeline...");

  // 1. A draft, never confirmed — still just an entry in the Batch Book.
  await createDraft(
    {
      departmentId: bespoke.id,
      batchType: "D",
      productName: "Chlorhexidine 4% Surgical Scrub",
      quantity: "200",
      unit: "litres",
      plannedManufactureDate: "2026-09-25",
    },
    PROD2,
  );

  // 2. Confirmed and dispatched, sitting untouched in stage 2's Incoming queue.
  await draftAndConfirm(PROD1, {
    batchType: "A",
    productName: "Amoxicillin 500mg Capsules",
    quantity: "5000",
    unit: "capsules",
    plannedManufactureDate: "2026-09-20",
  });

  // 3. Forwarded through stage 2, sitting untouched in stage 3's Incoming queue.
  {
    const b = await draftAndConfirm(PROD3, {
      batchType: "C",
      productName: "Ibuprofen 400mg Tablets",
      quantity: "8000",
      unit: "tablets",
      plannedManufactureDate: "2026-09-18",
    });
    await claimBatch(stageId(2), b.id, PROD1);
    await forwardBatch(stageId(2), b.id, PROD1);
  }

  // 4. Forwarded through stages 2 and 3, sitting untouched at stage 4 (Supervisor
  //    Material Check — the first stage with fail authority).
  {
    const b = await draftAndConfirm(PROD3, {
      batchType: "C",
      productName: "Paracetamol 500mg Tablets",
      quantity: "10000",
      unit: "tablets",
      plannedManufactureDate: "2026-09-19",
    });
    await claimBatch(stageId(2), b.id, PROD2);
    await forwardBatch(stageId(2), b.id, PROD2);
    await claimBatch(stageId(3), b.id, PROD2);
    await forwardBatch(stageId(3), b.id, PROD2);
  }

  // 5. Sent back from stage 4 to stage 3 — shows up in stage 3's Returned queue.
  {
    const b = await draftAndConfirm(PROD1, {
      batchType: "A",
      productName: "Metronidazole 400mg Tablets",
      quantity: "6000",
      unit: "tablets",
      plannedManufactureDate: "2026-09-17",
    });
    await claimBatch(stageId(2), b.id, PROD2);
    await forwardBatch(stageId(2), b.id, PROD2);
    await claimBatch(stageId(3), b.id, PROD2);
    await forwardBatch(stageId(3), b.id, PROD2);
    await claimBatch(stageId(4), b.id, QA1);
    await sendBatchBack(
      stageId(4),
      b.id,
      QA1,
      "Raw material label doesn't match the picking slip — recheck against the batch card.",
    );
  }

  // 6. Failed at stage 5 (Production Check).
  {
    const b = await draftAndConfirm(PROD2, {
      batchType: "D",
      productName: "Sodium Chloride 0.9% Nasal Spray",
      quantity: "3000",
      unit: "bottles",
      plannedManufactureDate: "2026-09-16",
    });
    await claimBatch(stageId(2), b.id, PROD3);
    await forwardBatch(stageId(2), b.id, PROD3);
    await claimBatch(stageId(3), b.id, PROD3);
    await forwardBatch(stageId(3), b.id, PROD3);
    await claimBatch(stageId(4), b.id, QA2);
    await forwardBatch(stageId(4), b.id, QA2);
    await claimBatch(stageId(5), b.id, PROD1);
    await failBatch(
      stageId(5),
      b.id,
      PROD1,
      "Fill weight consistently out of spec across three consecutive checks — line stopped.",
    );
  }

  // 7. Released through Final QA and sitting untouched in Warehouse's Incoming queue.
  {
    const b = await draftAndConfirm(PROD3, {
      batchType: "B",
      productName: "Omeprazole 2mg/ml Oral Suspension",
      quantity: "1500",
      unit: "bottles",
      plannedManufactureDate: "2026-09-15",
    });
    await claimBatch(stageId(2), b.id, PROD1);
    await forwardBatch(stageId(2), b.id, PROD1);
    await claimBatch(stageId(3), b.id, PROD1);
    await forwardBatch(stageId(3), b.id, PROD1);
    await claimBatch(stageId(4), b.id, QA1);
    await forwardBatch(stageId(4), b.id, QA1);
    await claimBatch(stageId(5), b.id, PROD2);
    await forwardBatch(stageId(5), b.id, PROD2);
    await claimBatch(stageId(6), b.id, QA2);
    await forwardBatch(stageId(6), b.id, QA2);
  }

  // 8. All the way through, including out of Warehouse — status COMPLETED.
  {
    const b = await draftAndConfirm(PROD1, {
      batchType: "A",
      productName: "Loratadine 10mg Tablets",
      quantity: "12000",
      unit: "tablets",
      plannedManufactureDate: "2026-09-10",
    });
    await claimBatch(stageId(2), b.id, PROD2);
    await forwardBatch(stageId(2), b.id, PROD2);
    await claimBatch(stageId(3), b.id, PROD2);
    await forwardBatch(stageId(3), b.id, PROD2);
    await claimBatch(stageId(4), b.id, QA1);
    await forwardBatch(stageId(4), b.id, QA1);
    await claimBatch(stageId(5), b.id, PROD3);
    await forwardBatch(stageId(5), b.id, PROD3);
    await claimBatch(stageId(6), b.id, QA2);
    await forwardBatch(stageId(6), b.id, QA2);
    await claimBatch(stageId(7), b.id, WAREHOUSE);
    await forwardBatch(stageId(7), b.id, WAREHOUSE);
  }

  // 9. M-type batch — confirmed, but deliberately never dispatched into
  //    Bespoke's MES (M needs its own pipeline, which doesn't exist yet).
  await draftAndConfirm(ADMIN, {
    batchType: "M",
    productName: "Bespoke veterinary formulation — client ref VET-2291",
    quantity: "40",
    unit: "bottles",
    plannedManufactureDate: "2026-09-22",
  });

  // 10. One more claimed and left in progress, at stage 2 — do this last so
  //     no later claim call in this script collides with the operator that
  //     holds it open (an operator can only have one open transition at a
  //     time — spec 3.3's claim exclusivity).
  {
    const b = await draftAndConfirm(PROD2, {
      batchType: "A",
      productName: "Cetirizine 10mg Tablets",
      quantity: "9000",
      unit: "tablets",
      plannedManufactureDate: "2026-09-21",
    });
    await claimBatch(stageId(2), b.id, PROD3);
  }

  console.log("Done — 10 batches seeded (1 draft, 1 in progress, 1 sent back, 1 failed, 1 completed, 1 M-type, rest dispatched/forwarded).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
