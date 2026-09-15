import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A department/site/production line — the top-level entity a stage pipeline
 * belongs to (spec 3.0's "design implication"). Bespoke is the first one
 * configured; other departments will have their own stage count and names.
 *
 * This is distinct from the `department` string already on `StaffMember`
 * (src/lib/types.ts) — that's a free-text picklist for the staff directory,
 * not a pipeline owner. Reconciling the two (e.g. FK'ing staff to this table)
 * is a decision for when auth moves off browser storage, not now.
 */
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
