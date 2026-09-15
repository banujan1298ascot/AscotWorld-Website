import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { batchRecords } from "./batch-records";
import { staff } from "./staff";

/**
 * One field-level edit to a batch record (spec 2.1, 2.2). Insert-only — rows
 * are never updated or deleted, which is what makes this an audit trail
 * rather than just a "last edited by" column, and is what the compliance
 * section (6) means by attributable and unalterable.
 */
export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchRecords.id, { onDelete: "restrict" }),
    fieldChanged: text("field_changed").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedBy: text("changed_by")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Required at the application layer for supervisor edits to
     *  confirmed/historical records (2.1) — optional here for the same reason
     *  as stage_transitions.notes: the DB can't see the calling context. */
    reason: text("reason"),
  },
  (table) => [index("audit_log_entries_batch_id_idx").on(table.batchId)],
);
