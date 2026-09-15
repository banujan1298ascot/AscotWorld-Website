import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { batchStatusEnum, batchTypeEnum, stageArrivalEnum } from "./enums";
import { departments } from "./departments";
import { stageDefinitions } from "./stage-definitions";
import { staff } from "./staff";

/**
 * The Batch Book source of truth (spec 2.2). A row exists from the moment a
 * user starts a draft; most fields fill in progressively and are still
 * editable up to confirmation, per 2.1's Draft vs Confirmed rules.
 */
export const batchRecords = pgTable(
  "batch_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    batchType: batchTypeEnum("batch_type").notNull(),
    /** Full human-facing label, e.g. "A-0001" or "M26-0001". Assigned
     *  atomically at confirmation from `batch_counters` — null while DRAFT. */
    batchNumber: text("batch_number"),
    /** Same value as the numeric part of batchNumber, kept alongside it so
     *  queries can sort/filter without parsing the label. */
    batchSequence: integer("batch_sequence"),

    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),

    productName: text("product_name"),
    quantity: numeric("quantity"),
    unit: text("unit"),
    plannedManufactureDate: date("planned_manufacture_date"),

    status: batchStatusEnum("status").notNull().default("DRAFT"),
    /** Null until confirmed, and again once the batch leaves the pipeline
     *  (COMPLETED/FAILED) or was imported as historical data. */
    currentStageId: uuid("current_stage_id").references(() => stageDefinitions.id, {
      onDelete: "restrict",
    }),
    /** How the batch arrived at currentStageId — drives whether it shows in
     *  that stage's Incoming or Returned column (spec 3.3). Null alongside
     *  currentStageId whenever the batch isn't sitting at any stage. */
    currentStageArrival: stageArrivalEnum("current_stage_arrival"),

    /** True for rows brought in via the one-off historical import (2.5) —
     *  these are COMPLETED for lookup only and never enter an MES stage queue. */
    isHistoricalImport: boolean("is_historical_import").notNull().default(false),

    /** Department/product-specific extras (formulation, line, shift, ...) that
     *  don't warrant their own column yet. */
    customFields: jsonb("custom_fields").notNull().default(sql`'{}'::jsonb`),

    createdBy: text("created_by")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    confirmedBy: text("confirmed_by").references(() => staff.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("batch_records_batch_number_unique")
      .on(table.batchNumber)
      .where(sql`${table.batchNumber} IS NOT NULL`),
  ],
);
