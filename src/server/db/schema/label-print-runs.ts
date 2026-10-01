import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { batchRecords } from "./batch-records";
import { labelPrintKindEnum } from "./enums";
import { stageDefinitions } from "./stage-definitions";
import { staff } from "./staff";

/**
 * Labels printed for a batch at Check 2 (Order/Calculation Check) — one row
 * per print run. Insert-only, like audit_log_entries: a corrected first
 * print is a new FIRST_PRINT row (the latest one counts), never an edit.
 *
 * The batch's totals are also kept on batch_records (labels_printed,
 * labels_reprinted) for the Batch Book, written in the same transaction as
 * each row here — and only from the MES, never from a Batch Book edit.
 */
export const labelPrintRuns = pgTable(
  "label_print_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchRecords.id, { onDelete: "restrict" }),
    /** The station it was recorded at — always the labelling station. */
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stageDefinitions.id, { onDelete: "restrict" }),
    kind: labelPrintKindEnum("kind").notNull(),
    quantity: integer("quantity").notNull(),
    /** Why a reprint/rerun was needed, or why a first print was corrected. */
    reason: text("reason"),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("label_print_runs_batch_id_idx").on(table.batchId),
    check("label_print_runs_quantity_positive", sql`${table.quantity} > 0`),
  ],
);
