/**
 * Demo data for Batch Book + the MES pipeline, laid out so every station has
 * something to work on. Run after `npm run db:migrate && npm run db:seed`:
 *
 *   npx tsx scripts/seed-mes-demo.ts                # add a fresh set of batches
 *   npx tsx scripts/seed-mes-demo.ts --reset        # wipe all batch data first
 *   npx tsx scripts/seed-mes-demo.ts --no-history   # skip the year of history
 *
 * The live pipeline below goes through the real Batch Book and MES service
 * functions — never raw inserts — so numbering, audit entries and stage
 * transitions come out exactly as they would from the UI. The year of
 * finished history the production report draws on is the one exception:
 * it has to be backdated, so it's written directly (see demo-history.ts).
 *
 * For each station 2–7 you get:
 *   - batches waiting in Incoming
 *   - one in Returned, sent back for rework by the next station (not 7 —
 *     nothing comes after Warehouse to send anything back)
 *   - one In progress, held by that station's own operator, so signing in
 *     as the station shows a batch ready to Forward / Send back / Fail
 * plus a couple held by floating operators (to show the "only the holder can
 * act" lock), and some history: completed, failed, a draft, and an M batch.
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  auditLogEntries,
  batchCounters,
  batchRecords,
  departments,
  labelPrintRuns,
  stageDefinitions,
  stageTransitions,
} from "../src/server/db/schema";
import type { ActingStaff } from "../src/server/actingStaff";
import { confirmBatch, createDraft, type CreateDraftInput } from "../src/server/batch-book/service";
import { recordLabelRun } from "../src/server/mes/labels";
import { claimBatch, failBatch, forwardBatch, sendBatchBack } from "../src/server/mes/service";
import { seedProductionHistory } from "./demo-history";

const CLERK: ActingStaff = { id: "staff_stage_1", role: "production" };
const ADMIN: ActingStaff = { id: "staff_admin", role: "admin" };

/** Check 4's supervisor — the only app user at that (supervised) station:
 *  every batch there is assigned by them to a floor operator, and moved on
 *  by them. */
const SUPERVISOR: ActingStaff = { id: "staff_stage_4", role: "production", mesStage: 4 };
const SUPERVISED_STAGE = 4;

/** Who's working each station's held batch at the end — each the right
 *  kind of operator for that station, and in no POOL (so never double-booked).
 *  Check 4's is a Bespoke production operator assigned by the supervisor. */
const STATION: Record<number, ActingStaff> = {
  2: { id: "staff_stage_2", role: "production" }, // Order processing operator
  3: { id: "staff_stage_3", role: "production" }, // Dispensary technician
  4: { id: "staff_prod_1", role: "production" }, // Bespoke production operator
  5: { id: "staff_stage_5", role: "production" },
  6: { id: "staff_stage_6", role: "qa" },
  7: { id: "staff_stage_7", role: "production" },
};

/** Operators who move batches through each stage. Every claim they make is
 *  closed straight away, so they never hold anything open. Checks 2-4 only
 *  take one kind of operator each: Order processing (2), Dispensary (3),
 *  Bespoke production (4). */
const POOL: Record<number, ActingStaff[]> = {
  2: [{ id: "staff_float_1", role: "production" }],
  3: [{ id: "staff_prod_2", role: "production" }],
  4: [
    { id: "staff_prod_3", role: "production" },
    { id: "staff_float_3", role: "production" },
  ],
  5: [
    { id: "staff_prod_3", role: "production" },
    { id: "staff_float_3", role: "production" },
    { id: "staff_qa_1", role: "qa" },
  ],
  6: [
    { id: "staff_qa_1", role: "qa" },
    { id: "staff_qa_2", role: "qa" },
  ],
  7: [
    { id: "staff_wh", role: "production" },
    { id: "staff_qa_2", role: "qa" },
  ],
};
let poolIndex = 0;
const nextOperator = (stage: number) => POOL[stage][poolIndex++ % POOL[stage].length];

/**
 * Starts a batch at a stage with `operator` doing the work, and returns who
 * then acts on it. At the supervised station that's the supervisor, who
 * assigns the operator (as the real station does); elsewhere the operator
 * claims it themselves.
 */
async function start(stageIdValue: string, stage: number, batchId: string, operator: ActingStaff): Promise<ActingStaff> {
  if (stage === SUPERVISED_STAGE) {
    await claimBatch(stageIdValue, batchId, SUPERVISOR, operator.id);
    return SUPERVISOR;
  }
  await claimBatch(stageIdValue, batchId, operator);
  return operator;
}

const PRODUCTS: Array<Omit<CreateDraftInput, "departmentId">> = [
  { batchType: "A", productName: "Amoxicillin 500mg Capsules", quantity: "5000", unit: "capsules" },
  { batchType: "A", productName: "Paracetamol 500mg Tablets", quantity: "10000", unit: "tablets" },
  { batchType: "C", productName: "Ibuprofen 400mg Tablets", quantity: "8000", unit: "tablets" },
  { batchType: "B", productName: "Omeprazole 2mg/ml Oral Suspension", quantity: "1500", unit: "bottles" },
  { batchType: "D", productName: "Sodium Chloride 0.9% Nasal Spray", quantity: "3000", unit: "bottles" },
  { batchType: "A", productName: "Metronidazole 400mg Tablets", quantity: "6000", unit: "tablets" },
  { batchType: "A", productName: "Loratadine 10mg Tablets", quantity: "12000", unit: "tablets" },
  { batchType: "A", productName: "Cetirizine 10mg Tablets", quantity: "9000", unit: "tablets" },
  { batchType: "B", productName: "Melatonin 1mg/ml Oral Solution", quantity: "800", unit: "bottles" },
  { batchType: "C", productName: "Prednisolone 5mg Tablets", quantity: "7000", unit: "tablets" },
  { batchType: "B", productName: "Clonidine 50mcg/5ml Oral Solution", quantity: "600", unit: "bottles" },
  { batchType: "D", productName: "Chlorhexidine 0.2% Mouthwash", quantity: "2500", unit: "bottles" },
  { batchType: "A", productName: "Gabapentin 300mg Capsules", quantity: "4000", unit: "capsules" },
  { batchType: "C", productName: "Levothyroxine 25mcg Tablets", quantity: "15000", unit: "tablets" },
  { batchType: "B", productName: "Tacrolimus 0.5mg/ml Oral Suspension", quantity: "300", unit: "bottles" },
  { batchType: "A", productName: "Doxycycline 100mg Capsules", quantity: "3500", unit: "capsules" },
  { batchType: "D", productName: "Hydrocortisone 1% Cream", quantity: "1200", unit: "tubes" },
  { batchType: "C", productName: "Propranolol 10mg Tablets", quantity: "11000", unit: "tablets" },
  { batchType: "B", productName: "Phenobarbital 15mg/5ml Oral Solution", quantity: "450", unit: "bottles" },
  { batchType: "A", productName: "Fluoxetine 20mg Capsules", quantity: "6000", unit: "capsules" },
  { batchType: "D", productName: "Emollient Cream 500g", quantity: "900", unit: "tubs" },
  { batchType: "C", productName: "Atenolol 50mg Tablets", quantity: "9500", unit: "tablets" },
  { batchType: "B", productName: "Meloxicam 1.5mg/ml Oral Suspension (Vet)", quantity: "700", unit: "bottles" },
  { batchType: "A", productName: "Folic Acid 5mg Tablets", quantity: "20000", unit: "tablets" },
  { batchType: "B", productName: "Furosemide 20mg/5ml Oral Solution", quantity: "550", unit: "bottles" },
  { batchType: "C", productName: "Sertraline 50mg Tablets", quantity: "8500", unit: "tablets" },
  { batchType: "A", productName: "Lansoprazole 30mg Capsules", quantity: "4500", unit: "capsules" },
  { batchType: "D", productName: "Zinc Oxide 15% Ointment", quantity: "1100", unit: "tubes" },
  { batchType: "B", productName: "Gabapentin 50mg/ml Oral Solution (Vet)", quantity: "350", unit: "bottles" },
  { batchType: "C", productName: "Amlodipine 5mg Tablets", quantity: "13000", unit: "tablets" },
  { batchType: "A", productName: "Mebeverine 135mg Tablets", quantity: "7500", unit: "tablets" },
  { batchType: "B", productName: "Ranitidine 75mg/5ml Oral Solution", quantity: "650", unit: "bottles" },
];
/** Mostly UK, with every other market represented, and roughly one batch in
 *  six urgent — so the board shows the amber and Ireland highlights. */
const DESTINATIONS = ["UK", "UK", "IRELAND", "UK", "SPAIN", "UK", "GERMANY", "IRELAND", "UK", "ABU_DHABI"] as const;
let productIndex = 0;
const nextProduct = () => {
  const i = productIndex++;
  return {
    ...PRODUCTS[i % PRODUCTS.length],
    destination: DESTINATIONS[i % DESTINATIONS.length],
    urgent: i % 6 === 1,
  };
};

const REWORK_REASONS: Record<number, string> = {
  3: "Calculation sheet doesn't match the batch card quantity — recheck the scale-up.",
  4: "Picked lot numbers don't match the picking slip — re-pick against the batch card.",
  5: "Supervisor check found one raw material past its retest date — swap the lot.",
  6: "Line clearance record missing a signature — complete before QA can release.",
  7: "Release paperwork missing the QP certificate number — resubmit from Final QA.",
};

async function main() {
  const reset = process.argv.includes("--reset");

  const [bespoke] = await db.select().from(departments).where(eq(departments.name, "Bespoke")).limit(1);
  if (!bespoke) throw new Error("Bespoke department not found — run `npm run db:seed` first.");

  const stageRows = await db.select().from(stageDefinitions).where(eq(stageDefinitions.departmentId, bespoke.id));
  const stageId = (sequenceNumber: number): string => {
    const stage = stageRows.find((s) => s.sequenceNumber === sequenceNumber);
    if (!stage) throw new Error(`Stage ${sequenceNumber} not found — run db:seed first.`);
    return stage.id;
  };

  if (reset) {
    // Order matters: audit entries and transitions both reference batches.
    await db.delete(auditLogEntries);
    await db.delete(labelPrintRuns);
    await db.delete(stageTransitions);
    await db.delete(batchRecords);
    await db.delete(batchCounters);
    console.log("Reset: cleared every batch, transition, audit entry and batch-number counter.");
  }

  // First, so history takes the lower batch numbers and today's work
  // follows on from it.
  if (!process.argv.includes("--no-history")) {
    const historical = await seedProductionHistory({
      departmentId: bespoke.id,
      stageId,
      products: PRODUCTS,
      clerkId: CLERK.id,
    });
    console.log(`History: ${historical} finished batches over the past year, for the production report.`);
  }

  /** Entered and confirmed by the Batch Book Clerk — lands in stage 2's Incoming. */
  async function enterBatch() {
    const draft = await createDraft({ ...nextProduct(), departmentId: bespoke.id }, CLERK);
    return confirmBatch(draft.id, CLERK);
  }

  /** Walks a batch from its current stage up to `target`, each hop claimed
   *  and forwarded straight away by a pool operator. */
  let labelRuns = 0;
  async function advance(batchId: string, from: number, target: number) {
    for (let stage = from; stage < target; stage++) {
      const actor = await start(stageId(stage), stage, batchId, nextOperator(stage));
      // Check 2 can't send a batch on without recording its labels.
      if (stage === 2) {
        const quantity = 120 + ((labelRuns++ * 37) % 480);
        await recordLabelRun(batchId, { kind: "FIRST_PRINT", quantity }, actor);
      }
      await forwardBatch(stageId(stage), batchId, actor);
    }
  }

  let created = 0;
  for (let station = 2; station <= 7; station++) {
    // Waiting in Incoming.
    const incomingCount = station === 2 ? 3 : 2;
    for (let i = 0; i < incomingCount; i++) {
      const batch = await enterBatch();
      await advance(batch.id, 2, station);
      created++;
    }

    // Sent back from the next station — shows in this station's Returned.
    if (station <= 6) {
      const batch = await enterBatch();
      await advance(batch.id, 2, station + 1);
      const reviewer = await start(stageId(station + 1), station + 1, batch.id, nextOperator(station + 1));
      await sendBatchBack(stageId(station + 1), batch.id, reviewer, REWORK_REASONS[station + 1]);
      created++;
    }
  }

  // History — finished journeys, so the Batch Book isn't only work in flight.
  for (let i = 0; i < 3; i++) {
    const batch = await enterBatch();
    await advance(batch.id, 2, 7);
    const operator = nextOperator(7);
    await claimBatch(stageId(7), batch.id, operator);
    await forwardBatch(stageId(7), batch.id, operator); // -> COMPLETED
    created++;
  }
  for (const [failAt, reason] of [
    [4, "Raw material contamination found on supervisor inspection — quarantined."],
    [6, "Assay result out of specification (92.1% vs 95–105%) — batch rejected."],
  ] as const) {
    const batch = await enterBatch();
    await advance(batch.id, 2, failAt);
    const actor = await start(stageId(failAt), failAt, batch.id, nextOperator(failAt));
    await failBatch(stageId(failAt), batch.id, actor, reason);
    created++;
  }

  // Not yet in the pipeline: a draft, and an M batch (M never enters
  // Bespoke's MES — it waits for its own pipeline).
  await createDraft({ ...nextProduct(), departmentId: bespoke.id }, CLERK);
  created++;
  const mDraft = await createDraft(
    {
      departmentId: bespoke.id,
      batchType: "M",
      productName: "Bespoke veterinary formulation — client ref VET-2291",
      quantity: "40",
      unit: "bottles",
    },
    ADMIN,
  );
  await confirmBatch(mDraft.id, ADMIN);
  created++;

  // Last, because each of these leaves a claim open and an operator can only
  // hold one batch at a time: one batch held by every station's own
  // operator, then two held by floating operators to show the holder lock.
  for (let station = 2; station <= 7; station++) {
    const batch = await enterBatch();
    await advance(batch.id, 2, station);
    await start(stageId(station), station, batch.id, STATION[station]);
    created++;
  }
  for (const [station, holderId] of [
    [5, "staff_float_2"],
    [6, "staff_float_4"],
  ] as const) {
    const batch = await enterBatch();
    await advance(batch.id, 2, station);
    await claimBatch(stageId(station), batch.id, { id: holderId, role: "production" });
    created++;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(batchRecords);
  console.log(`Seeded ${created} batches (${count} in the Batch Book in total). Sign in as any MES station to see its queue.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
