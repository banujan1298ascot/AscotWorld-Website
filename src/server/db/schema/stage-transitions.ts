import { sql } from "drizzle-orm";
import { boolean, index, interval, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { stageOutcomeEnum } from "./enums";
import { batchRecords } from "./batch-records";
import { stageDefinitions } from "./stage-definitions";
import { reasonCodes } from "./reason-codes";
import { staff } from "./staff";

/**
 * One batch's visit to one stage (spec 3.1-3.3). A row is created the moment
 * an operator claims a batch from Incoming (receivedAt stamped then) and
 * closed out when they send it forward, back, or fail it (completedAt +
 * outcome stamped then) — so an open row (completedAt null) *is* "in
 * progress at this stage, held by this operator".
 */
export const stageTransitions = pgTable(
  "stage_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchRecords.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stageDefinitions.id, { onDelete: "restrict" }),

    operatorId: text("operator_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Postgres-generated column — null until completedAt is set. */
    duration: interval("duration").generatedAlwaysAs(sql`(completed_at - received_at)`),

    /** Null while still in progress at this stage. */
    outcome: stageOutcomeEnum("outcome"),
    /** Next stage's Incoming on FORWARD, previous stage's Returned queue on
     *  SENT_BACK, null on FAILED (the batch leaves the pipeline entirely). */
    destinationStageId: uuid("destination_stage_id").references(() => stageDefinitions.id, {
      onDelete: "restrict",
    }),

    /** Optional — the dropdown starts empty (see reason_codes) and fills in
     *  over time. */
    reasonCodeId: uuid("reason_code_id").references(() => reasonCodes.id, { onDelete: "restrict" }),
    /** Free-text reason. Required at the application layer whenever outcome is
     *  SENT_BACK or FAILED (spec 3.2) — the DB doesn't enforce that condition
     *  since a CHECK constraint here couldn't see the eventual outcome at
     *  insert time (the row starts out with outcome null). */
    notes: text("notes"),

    /** Set true on a FAILED outcome. A fuller investigation sub-record
     *  (opened/closed by, findings) is the natural next table once this one
     *  exists — the spec flags it in 3.2 but it's out of scope here. */
    investigationFlagged: boolean("investigation_flagged").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Claim exclusivity (spec 3.3): an operator can hold at most one open
    // (uncompleted) transition across the whole pipeline at a time.
    uniqueIndex("stage_transitions_active_operator_unique")
      .on(table.operatorId)
      .where(sql`${table.completedAt} IS NULL`),
    index("stage_transitions_batch_id_idx").on(table.batchId),
    // Board queries filter "this stage's open transitions" constantly.
    index("stage_transitions_stage_open_idx").on(table.stageId).where(sql`${table.completedAt} IS NULL`),
  ],
);
