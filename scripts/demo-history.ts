/**
 * A year of finished demo batches for the production report — so the
 * batches-made chart and the product timing search have something to show
 * before real use has built up any history.
 *
 * Unlike the rest of the demo seed this writes rows directly instead of
 * going through the Batch Book / MES services: those stamp every step with
 * `now()`, and history needs to be backdated. The rows mirror exactly what
 * the services produce (numbering from the same counters, the stage 1
 * hand-off transition confirmBatch writes, one transition per stage visit)
 * minus audit-log entries, which the report doesn't read.
 *
 * Deterministic: a fixed random seed, so every reset draws the same year.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { batchCounters, batchRecords, stageTransitions } from "../src/server/db/schema";
import type { CreateDraftInput } from "../src/server/batch-book/service";

type Product = Omit<CreateDraftInput, "departmentId">;

/** Who works each station in the demo, and how quick they are relative to
 *  the station's norm (1 = typical) — so the per-operator breakdown has
 *  real differences to show. */
const OPERATORS: Record<number, { id: string; speed: number }[]> = {
  2: [
    { id: "staff_stage_2", speed: 0.85 },
    { id: "staff_prod_1", speed: 1.05 },
    { id: "staff_float_1", speed: 1.3 },
  ],
  3: [
    { id: "staff_stage_3", speed: 0.9 },
    { id: "staff_prod_2", speed: 1.0 },
    { id: "staff_float_3", speed: 1.25 },
  ],
  4: [
    { id: "staff_prod_3", speed: 0.95 },
    { id: "staff_float_2", speed: 1.15 },
    { id: "staff_float_3", speed: 1.05 },
  ],
  5: [
    { id: "staff_stage_5", speed: 0.9 },
    { id: "staff_float_2", speed: 1.1 },
    { id: "staff_prod_1", speed: 1.2 },
  ],
  6: [
    { id: "staff_stage_6", speed: 0.85 },
    { id: "staff_qa_1", speed: 1.0 },
    { id: "staff_qa_2", speed: 1.15 },
    { id: "staff_float_4", speed: 1.3 },
  ],
  7: [
    { id: "staff_stage_7", speed: 0.9 },
    { id: "staff_wh", speed: 1.1 },
  ],
};

/** Typical hands-on minutes at each station, and the range a batch waits
 *  in that station's Incoming queue before someone picks it up. */
const WORK_MINUTES: Record<number, number> = { 2: 35, 3: 75, 4: 45, 5: 240, 6: 140, 7: 25 };
const WAIT_MINUTES: Record<number, [number, number]> = {
  2: [15, 120],
  3: [30, 180],
  4: [15, 90],
  5: [30, 300],
  6: [60, 720],
  7: [20, 240],
};

const SEND_BACK_NOTES: Record<number, string> = {
  3: "Calculation sheet doesn't match the batch card quantity.",
  4: "Picked lot number doesn't match the picking slip.",
  5: "Raw material past its retest date — swap the lot.",
  6: "Line clearance record missing a signature.",
  7: "Release paperwork missing the QP certificate number.",
};

/** mulberry32 — tiny seeded PRNG, good enough for demo data. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINUTE = 60_000;

export async function seedProductionHistory(options: {
  departmentId: string;
  stageId: (sequenceNumber: number) => string;
  products: Product[];
  clerkId: string;
}): Promise<number> {
  const { departmentId, stageId, products, clerkId } = options;
  const random = prng(20260923);
  const between = (min: number, max: number) => min + random() * (max - min);
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
  /** Right-skewed noise around 1 — most visits near typical, a few slow. */
  const jitter = () => Math.exp((random() - 0.4) * 0.7);

  // Some products are made far more often than others.
  const weighted = products.flatMap((p, i) => Array.from({ length: i < 10 ? 3 : 1 }, () => p));

  const now = Date.now();
  const batches: (typeof batchRecords.$inferInsert)[] = [];
  const transitions: (typeof stageTransitions.$inferInsert)[] = [];

  for (let daysAgo = 365; daysAgo >= 2; daysAgo--) {
    const day = new Date(now - daysAgo * 24 * 60 * MINUTE);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    // Output grows through the year, with a wobble, so the chart has a shape.
    const trend = 1.2 + (1 - daysAgo / 365) * 1.6 + Math.sin(daysAgo / 20) * 0.5;
    const count = Math.max(0, Math.round(trend + (random() - 0.5) * 2));

    for (let n = 0; n < count; n++) {
      const product = pick(weighted);
      const quantity = Number(product.quantity ?? 1000);
      const productFactor = 0.8 + Math.min(1, quantity / 20000) * 0.5 + (product.batchType === "B" ? 0.25 : 0);

      const confirmedAt = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 7, 30) + between(0, 4 * 60) * MINUTE,
      );
      const createdAt = new Date(confirmedAt.getTime() - between(10, 40) * MINUTE);
      const id = randomUUID();

      const visits: (typeof stageTransitions.$inferInsert)[] = [
        {
          batchId: id,
          stageId: stageId(1),
          operatorId: clerkId,
          receivedAt: createdAt,
          completedAt: confirmedAt,
          outcome: "FORWARD",
          destinationStageId: stageId(2),
        },
      ];

      let clock = confirmedAt.getTime();
      const visit = (stage: number, outcome: "FORWARD" | "SENT_BACK" | "FAILED", share = 1) => {
        const [minWait, maxWait] = WAIT_MINUTES[stage];
        const operator = pick(OPERATORS[stage]);
        const receivedAt = clock + between(minWait, maxWait) * MINUTE;
        const completedAt =
          receivedAt + WORK_MINUTES[stage] * productFactor * operator.speed * jitter() * share * MINUTE;
        clock = completedAt;
        visits.push({
          batchId: id,
          stageId: stageId(stage),
          operatorId: operator.id,
          receivedAt: new Date(receivedAt),
          completedAt: new Date(completedAt),
          outcome,
          destinationStageId:
            outcome === "FORWARD" ? (stage === 7 ? null : stageId(stage + 1)) : outcome === "SENT_BACK" ? stageId(stage - 1) : null,
          notes:
            outcome === "SENT_BACK"
              ? SEND_BACK_NOTES[stage]
              : outcome === "FAILED"
                ? "Out-of-specification result — batch rejected."
                : null,
          investigationFlagged: outcome === "FAILED",
        });
      };

      let failed = false;
      for (let stage = 2; stage <= 7; stage++) {
        if (stage >= 3 && random() < 0.06) {
          // Sent back once: a short look here, rework at the previous
          // station, then this station again properly.
          visit(stage, "SENT_BACK", 0.4);
          visit(stage - 1, "FORWARD", 0.6);
        }
        if (stage >= 4 && stage <= 6 && random() < 0.012) {
          visit(stage, "FAILED", 0.7);
          failed = true;
          break;
        }
        visit(stage, "FORWARD");
      }

      // Anything that wouldn't have finished yet is left out rather than
      // shown finishing in the future.
      if (clock > now - 60 * MINUTE) continue;

      transitions.push(...visits);
      batches.push({
        id,
        batchType: product.batchType,
        departmentId,
        productName: product.productName,
        quantity: product.quantity,
        unit: product.unit,
        plannedManufactureDate: confirmedAt.toISOString().slice(0, 10),
        status: failed ? "FAILED" : "COMPLETED",
        currentStageId: null,
        currentStageArrival: null,
        createdBy: clerkId,
        confirmedBy: clerkId,
        confirmedAt,
        createdAt,
        updatedAt: new Date(clock),
      });
    }
  }

  // Number them oldest-first from the same counters live confirmation uses,
  // reserving each type's whole block in one atomic bump.
  batches.sort((a, b) => a.confirmedAt!.getTime() - b.confirmedAt!.getTime());
  const byType = new Map<string, typeof batches>();
  for (const batch of batches) {
    const list = byType.get(batch.batchType) ?? [];
    list.push(batch);
    byType.set(batch.batchType, list);
  }
  for (const [batchType, list] of byType) {
    const [row] = await db
      .insert(batchCounters)
      .values({ batchType: batchType as Product["batchType"], year: null, currentValue: list.length })
      .onConflictDoUpdate({
        target: batchCounters.batchType,
        targetWhere: sql`${batchCounters.year} IS NULL`,
        set: { currentValue: sql`${batchCounters.currentValue} + ${list.length}`, updatedAt: sql`now()` },
      })
      .returning({ currentValue: batchCounters.currentValue });
    const first = row.currentValue - list.length + 1;
    list.forEach((batch, i) => {
      batch.batchSequence = first + i;
      batch.batchNumber = `${batchType}-${String(first + i).padStart(4, "0")}`;
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < batches.length; i += CHUNK) {
    await db.insert(batchRecords).values(batches.slice(i, i + CHUNK));
  }
  for (let i = 0; i < transitions.length; i += CHUNK) {
    await db.insert(stageTransitions).values(transitions.slice(i, i + CHUNK));
  }
  return batches.length;
}
