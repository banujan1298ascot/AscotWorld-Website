/**
 * Sequential batch numbering (spec 2.3). Split in two on purpose:
 *
 *  - `formatBatchLabel` is pure — given a batch type, the sequence number to
 *    use, and a clock, it just formats the human-facing label. No DB, so the
 *    padding/year-suffix rules can be unit tested exhaustively.
 *  - `assignNextBatchNumber` is the part that actually has to be safe under
 *    concurrency: it uses a single atomic `INSERT ... ON CONFLICT DO UPDATE`
 *    against `batch_counters` to get the next sequence. This is
 *    provably race-free even for "two users confirm the very first A batch
 *    at the same instant" — a plain `SELECT` (even `FOR UPDATE`) followed by
 *    a separate `INSERT` would still race on that first-ever row, since
 *    `FOR UPDATE` can't lock a row that doesn't exist yet. Postgres's upsert
 *    is specifically designed to serialize exactly this case.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { batchCounters } from "../db/schema";

export type BatchType = "A" | "B" | "C" | "D" | "M";

/** M resets every calendar year and embeds the year in the prefix; the rest never reset. */
export function batchTypeResetsYearly(batchType: BatchType): boolean {
  return batchType === "M";
}

/** Two-digit calendar year to embed for a resetting type, else null. */
export function yearSuffixFor(batchType: BatchType, now: Date): number | null {
  return batchTypeResetsYearly(batchType) ? now.getUTCFullYear() % 100 : null;
}

/** Zero-pads to at least 4 digits; never truncates a longer number. */
function padSequence(sequence: number): string {
  return String(sequence).padStart(4, "0");
}

/** Pure formatting: e.g. ("A", 42, ...) -> "A-0042", ("M", 1, <2026>) -> "M26-0001". */
export function formatBatchLabel(batchType: BatchType, sequence: number, now: Date): string {
  const year = yearSuffixFor(batchType, now);
  return year === null
    ? `${batchType}-${padSequence(sequence)}`
    : `${batchType}${String(year).padStart(2, "0")}-${padSequence(sequence)}`;
}

export interface NextBatchNumber {
  sequence: number;
  year: number | null;
  label: string;
}

/**
 * Atomically assigns and persists the next number for `batchType`. Intended
 * to run inside the same transaction as the rest of batch confirmation, so a
 * failure elsewhere in that transaction rolls the counter increment back too.
 *
 * Non-resetting types (A/B/C/D) key their counter row on `batchType` alone
 * (`year IS NULL`, one row forever). M keys on `(batchType, year)` — the
 * first confirmation of a new year inserts a fresh row starting at 1 instead
 * of updating last year's, which is what makes it "reset". The two partial
 * unique indexes on batch_counters (see schema) are exactly these two
 * conflict targets.
 */
export async function assignNextBatchNumber(
  tx: NodePgDatabase<Record<string, unknown>>,
  batchType: BatchType,
  now: Date = new Date(),
): Promise<NextBatchNumber> {
  const resetsYearly = batchTypeResetsYearly(batchType);
  const year = yearSuffixFor(batchType, now);

  const [row] = await tx
    .insert(batchCounters)
    .values({ batchType, year, currentValue: 1 })
    .onConflictDoUpdate({
      target: resetsYearly ? [batchCounters.batchType, batchCounters.year] : batchCounters.batchType,
      targetWhere: resetsYearly ? sql`${batchCounters.year} IS NOT NULL` : sql`${batchCounters.year} IS NULL`,
      set: { currentValue: sql`${batchCounters.currentValue} + 1`, updatedAt: sql`now()` },
    })
    .returning({ currentValue: batchCounters.currentValue });

  const sequence = row.currentValue;
  return { sequence, year, label: formatBatchLabel(batchType, sequence, now) };
}
