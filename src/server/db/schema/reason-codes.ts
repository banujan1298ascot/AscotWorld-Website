import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Admin-managed dropdown options for a stage transition's reason (spec 3.2).
 * Starts empty at launch by design — operators use the free-text field on
 * `stage_transitions.notes` until an admin adds useful options here, which
 * must stay a data change, never a code change.
 */
export const reasonCodes = pgTable("reason_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
