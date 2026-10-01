/**
 * Product suggestions for the Batch Book's "new batch" form: products made
 * before that match what's being typed, each with the strength, type and
 * pack size it was last entered with, so picking one fills the form in.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { productSearchPatterns } from "../dashboard/metrics";
import { parseProductName, type DosageForm, type PackUnit } from "@/lib/products";

export interface ProductSuggestion {
  /** The full name, as shown everywhere else. */
  productName: string;
  medicineName: string;
  strength: string | null;
  dosageForm: DosageForm | null;
  packSize: string | null;
  packUnit: PackUnit | null;
  /** The batch quantity unit it was last entered with ("bottles", ...). */
  unit: string | null;
  /** How many batches of it there have been — the most-made first. */
  batches: number;
  lastEnteredAt: string;
}

/**
 * Every typed word must appear in the product's full name, in any order —
 * "para 500" finds "Paracetamol 500mg Tablets" (same rule as the reports'
 * product search). Batches entered before the separate fields existed are
 * split up from their full name (parseProductName) so they suggest just as
 * well.
 */
export async function suggestProducts(query: string, limit = 8): Promise<ProductSuggestion[]> {
  const patterns = productSearchPatterns(query);
  if (patterns.length === 0) return [];
  const matchesEveryWord = sql.join(
    patterns.map((p) => sql`product_name ILIKE ${p}`),
    sql` AND `,
  );

  // The most recent entry of each product carries its current details; the
  // count is across all of them.
  const result = await db.execute<{
    product_name: string;
    medicine_name: string | null;
    strength: string | null;
    dosage_form: DosageForm | null;
    pack_size: string | null;
    pack_unit: PackUnit | null;
    unit: string | null;
    batches: number;
    created_at: string | Date;
  }>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (product_name)
        product_name, medicine_name, strength, dosage_form, pack_size, pack_unit, unit, created_at,
        COUNT(*) OVER (PARTITION BY product_name)::int AS batches
      FROM "batch_records"
      WHERE product_name IS NOT NULL AND ${matchesEveryWord}
      ORDER BY product_name, created_at DESC
    ) latest
    ORDER BY batches DESC, created_at DESC
    LIMIT ${limit}
  `);

  return result.rows.map((r) => {
    const parsed = r.medicine_name ? null : parseProductName(r.product_name);
    return {
      productName: r.product_name,
      medicineName: r.medicine_name ?? parsed!.medicineName,
      strength: r.medicine_name ? r.strength : parsed!.strength,
      dosageForm: r.medicine_name ? r.dosage_form : parsed!.dosageForm,
      packSize: r.pack_size,
      packUnit: r.pack_unit,
      unit: r.unit,
      batches: r.batches,
      lastEnteredAt: new Date(r.created_at).toISOString(),
    };
  });
}
