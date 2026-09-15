import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Mirrors `Role` in src/lib/types.ts. Kept in sync by hand for now — there's
 * one small, stable set of roles and no codegen step linking the two yet.
 */
export const staffRoleEnum = pgEnum("staff_role", ["admin", "production", "qa", "viewer"]);

/**
 * Batch/production type prefix (spec 2.3). Each type draws from its own
 * numbering sequence — A/B/C/D count up forever, M resets every year.
 */
export const batchTypeEnum = pgEnum("batch_type", ["A", "B", "C", "D", "M"]);

/** Batch Book + MES lifecycle (spec 2.2). */
export const batchStatusEnum = pgEnum("batch_status", [
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "ON_HOLD",
  "FAILED",
]);

/** Result of a stage's Outgoing action (spec 3.1, 3.2). */
export const stageOutcomeEnum = pgEnum("stage_outcome", [
  "FORWARD",
  "SENT_BACK",
  "ON_HOLD",
  "FAILED",
]);

/**
 * How a batch arrived at its current stage — distinguishes a stage's
 * Incoming column (fresh forward movement) from its Returned column
 * (rework sent back from a later stage), per spec 3.3's board layout. Null
 * while the batch isn't sitting at any stage (DRAFT, COMPLETED, FAILED).
 */
export const stageArrivalEnum = pgEnum("stage_arrival", ["FORWARD", "RETURNED"]);
