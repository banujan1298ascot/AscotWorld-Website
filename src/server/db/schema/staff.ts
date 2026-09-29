import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { staffRoleEnum } from "./enums";

/**
 * Server-side mirror of the staff identities the demo auth in
 * src/lib/auth.tsx already knows about (same ids, e.g. "staff_admin") — it
 * exists purely so batch_records/audit_log_entries/stage_transitions have a
 * real row to point a foreign key at for who-did-what.
 *
 * This is NOT a real auth/user table: there's no password or session here,
 * and nothing in this file checks who's calling. Until real auth replaces
 * the browser-storage demo session, the API layer trusts a staff id supplied
 * by the client and looks up their role here to decide what they may do —
 * see the note on that trust boundary in src/server/auth/requireStaff.ts.
 */
export const staff = pgTable("staff", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: staffRoleEnum("role").notNull(),
  department: text("department"),
  email: text("email").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  /** The MES station this account is pinned to (stage sequence number), as
   *  on the Team page — the server needs it to know who runs a supervised
   *  station. Null for anyone who isn't tied to one station. */
  mesStage: integer("mes_stage"),
  /** Which kind of MES operator they are, if any (see OperatorRole in
   *  src/lib/types.ts) — some stations only accept one kind. */
  operatorRole: text("operator_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
