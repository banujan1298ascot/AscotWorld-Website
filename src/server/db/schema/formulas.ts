import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { FormulaIngredient, ScanLayout } from "@/lib/formulaRules";
import { dosageFormEnum } from "./enums";
import { staff } from "./staff";

/**
 * Each product's formula, as data — the ingredients and how each scales
 * with the batch (src/lib/formulaRules.ts) — used to fill in the Quantity
 * Required column and the calculation on a batch's generated worksheet.
 * Entered on the Worksheets page by the people with worksheet access.
 *
 * Never edited in place: a change saves a new version and retires the old
 * one (retired_at, replaced_by_id), so every generated worksheet's numbers
 * can be traced to the formula they came from. Rows with no retired_at are
 * the ones in use.
 */
export const productFormulas = pgTable(
  "product_formulas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicineName: text("medicine_name").notNull(),
    dosageForm: dosageFormEnum("dosage_form").notNull(),
    /** Null when the formula covers every strength. */
    strength: text("strength"),
    /** Extra made per bottle (ml), so each can be filled to volume. */
    overageMl: numeric("overage_ml").notNull(),
    ingredients: jsonb("ingredients").$type<FormulaIngredient[]>().notNull(),
    notes: text("notes"),
    /** For a scanned worksheet: where the quantities go on it. */
    scanLayout: jsonb("scan_layout").$type<ScanLayout>(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredBy: text("retired_by").references(() => staff.id, { onDelete: "restrict" }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    /** The version that took over, when it was replaced rather than withdrawn. */
    replacedById: uuid("replaced_by_id").references((): AnyPgColumn => productFormulas.id, { onDelete: "restrict" }),
  },
  (table) => [index("product_formulas_retired_at_idx").on(table.retiredAt)],
);
