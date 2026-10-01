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

/**
 * Result of a stage's Outgoing action (spec 3.1, 3.2). REASSIGNED closes one
 * operator's share of a stage visit when the batch is handed to someone
 * else mid-way — the batch hasn't left the stage, so stage-level figures
 * skip these rows, but per-operator timing counts each one.
 */
export const stageOutcomeEnum = pgEnum("stage_outcome", [
  "FORWARD",
  "SENT_BACK",
  "ON_HOLD",
  "FAILED",
  "REASSIGNED",
]);

/**
 * How a batch arrived at its current stage — distinguishes a stage's
 * Incoming column (fresh forward movement) from its Returned column
 * (rework sent back from a later stage), per spec 3.3's board layout. Null
 * while the batch isn't sitting at any stage (DRAFT, COMPLETED, FAILED).
 */
export const stageArrivalEnum = pgEnum("stage_arrival", ["FORWARD", "RETURNED"]);

/**
 * A label print run recorded at Check 2 (Order/Calculation Check): the batch's
 * first print, or a later reprint/rerun. See label_print_runs.
 */
/** Which market a batch's stock is for — chosen at Batch Book entry. Mirrors
 *  BATCH_DESTINATIONS in src/lib/batchBook.ts. */
export const batchDestinationEnum = pgEnum("batch_destination", ["UK", "IRELAND", "SPAIN", "GERMANY", "ABU_DHABI"]);

/** A batch's product type, picked from the Batch Book's dropdown. Mirrors
 *  DOSAGE_FORMS in src/lib/products.ts. */
export const dosageFormEnum = pgEnum("dosage_form", [
  "TABLETS",
  "CAPSULES",
  "CREAM",
  "OINTMENT",
  "SOLUTION",
  "SUSPENSION",
  "OTHER",
]);

/** What a pack size is counted in — a count of tablets/capsules, or a
 *  volume. Mirrors PACK_UNITS in src/lib/products.ts. */
export const packUnitEnum = pgEnum("pack_unit", ["tablets", "capsules", "ml", "g"]);

export const labelPrintKindEnum = pgEnum("label_print_kind", ["FIRST_PRINT", "REPRINT"]);
