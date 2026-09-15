import { sql } from "drizzle-orm";
import { integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { batchTypeEnum } from "./enums";

/**
 * Backing store for the atomic "get next number" operation the spec asks for
 * (2.3) — not one of the five named entities, but required to satisfy
 * batch_records.batchNumber/batchSequence without a race condition. Business
 * logic will read a row with `SELECT ... FOR UPDATE` and increment it inside
 * the same transaction that confirms a batch.
 *
 * A/B/C/D key off `batchType` alone (`year` stays null, one row per type,
 * counts up forever). M keys off `(batchType, year)` and gets a fresh row —
 * and a fresh count starting at 1 — every year. Two partial unique indexes
 * enforce "at most one counter row per type" and "at most one per type+year"
 * respectively, since plain NULL columns don't dedupe against each other in a
 * regular unique constraint.
 */
export const batchCounters = pgTable(
  "batch_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchType: batchTypeEnum("batch_type").notNull(),
    /** Null for non-resetting types (A/B/C/D). Set for resetting types (M). */
    year: integer("year"),
    currentValue: integer("current_value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("batch_counters_type_unique").on(table.batchType).where(sql`${table.year} IS NULL`),
    uniqueIndex("batch_counters_type_year_unique")
      .on(table.batchType, table.year)
      .where(sql`${table.year} IS NOT NULL`),
  ],
);
