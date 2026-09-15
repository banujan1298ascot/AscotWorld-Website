import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { departments } from "./departments";

/**
 * One stage in a department's pipeline (spec 3.0, 3.2). Deliberately not
 * hardcoded to "6 checks" — Bespoke's pipeline is just the first configured
 * template; other departments will define their own ordered stage list here,
 * ideally through admin tooling rather than a code change.
 */
export const stageDefinitions = pgTable(
  "stage_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    /** Order within this department's pipeline — 1-based, not necessarily 1-6. */
    sequenceNumber: integer("sequence_number").notNull(),
    name: text("name").notNull(),
    /** Can a transition at this stage mark a batch FAILED? Per spec 3.2, only
     *  Check 4 onward has this — Check 1-3 cannot scrap a batch. */
    failAuthority: boolean("fail_authority").notNull().default(false),
    /** Does completing this stage release the batch onward (e.g. Check 6 -> Warehouse)? */
    isTerminalReleaseStage: boolean("is_terminal_release_stage").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("stage_definitions_department_sequence_unique").on(table.departmentId, table.sequenceNumber)],
);
