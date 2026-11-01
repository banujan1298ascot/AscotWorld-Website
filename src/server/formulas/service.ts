/**
 * Product formulas: listing them, and saving, replacing and withdrawing
 * them — for the people with worksheet access, the same as uploading
 * worksheets. A formula is never edited in place: saving a change makes a
 * new version and retires the old one, so a generated worksheet's numbers
 * can always be traced back. The rules for what a formula may contain are
 * in src/lib/formulaRules.ts.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { checkFormula, type FormulaDefinition, type FormulaIngredient } from "@/lib/formulaRules";
import type { DosageForm } from "@/lib/products";
import { ApiError } from "../apiError";
import type { ActingStaff } from "../actingStaff";
import { db } from "../db/client";
import { productFormulas, staff } from "../db/schema";
import { mayManageWorksheets } from "../worksheets/service";
import { sameFormulaProduct } from "../worksheets/matching";

export interface FormulaView {
  id: string;
  medicineName: string;
  dosageForm: DosageForm;
  strength: string | null;
  overageMl: number;
  ingredients: FormulaIngredient[];
  notes: string | null;
  version: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  /** Whether quantities have been placed for a scanned worksheet. */
  hasScanLayout: boolean;
}

type FormulaRow = typeof productFormulas.$inferSelect;

export function toDefinition(row: FormulaRow): FormulaDefinition {
  return {
    medicineName: row.medicineName,
    dosageForm: row.dosageForm,
    strength: row.strength,
    overageMl: Number(row.overageMl),
    ingredients: row.ingredients,
    notes: row.notes,
  };
}

async function requireManager(actor: ActingStaff): Promise<void> {
  if (!(await mayManageWorksheets(actor))) {
    throw new ApiError(403, "Only people given worksheet access can change formulas — ask an admin.");
  }
}

function checked(input: unknown): FormulaDefinition {
  const result = checkFormula(input);
  if (!result.ok) throw new ApiError(422, result.error);
  return result.value;
}

/** The formulas in use, by product. */
export async function listFormulas(): Promise<FormulaView[]> {
  const rows = await db
    .select({ formula: productFormulas, createdByName: staff.name })
    .from(productFormulas)
    .innerJoin(staff, eq(staff.id, productFormulas.createdBy))
    .where(isNull(productFormulas.retiredAt))
    .orderBy(asc(productFormulas.medicineName), asc(productFormulas.strength));
  return rows.map(({ formula: f, createdByName }) => ({
    id: f.id,
    medicineName: f.medicineName,
    dosageForm: f.dosageForm,
    strength: f.strength,
    overageMl: Number(f.overageMl),
    ingredients: f.ingredients,
    notes: f.notes,
    version: f.version,
    createdBy: f.createdBy,
    createdByName,
    createdAt: f.createdAt.toISOString(),
    hasScanLayout: f.scanLayout !== null,
  }));
}

/** The formulas in use, as stored — for generating a batch's worksheet. */
export async function activeFormulas(): Promise<FormulaRow[]> {
  return db.select().from(productFormulas).where(isNull(productFormulas.retiredAt));
}

async function refuseDuplicate(formula: FormulaDefinition, exceptId?: string): Promise<void> {
  const clash = (await activeFormulas()).find((row) => row.id !== exceptId && sameFormulaProduct(row, formula));
  if (clash) {
    throw new ApiError(
      409,
      `There's already a formula for ${clash.medicineName}${clash.strength ? ` ${clash.strength}` : ""} — edit that one instead.`,
    );
  }
}

export async function createFormula(input: unknown, actor: ActingStaff): Promise<{ id: string }> {
  await requireManager(actor);
  const formula = checked(input);
  await refuseDuplicate(formula);
  const [row] = await db
    .insert(productFormulas)
    .values({ ...formula, overageMl: String(formula.overageMl), createdBy: actor.id })
    .returning({ id: productFormulas.id });
  return row;
}

async function activeFormula(id: string): Promise<FormulaRow> {
  const [row] = await db.select().from(productFormulas).where(eq(productFormulas.id, id)).limit(1);
  if (!row) throw new ApiError(404, "Formula not found.");
  if (row.retiredAt) throw new ApiError(409, "That formula has already been replaced or withdrawn — reload the page.");
  return row;
}

/** Saves a change as the next version and retires the one it replaces.
 *  A scanned worksheet's layout carries over — it's about the worksheet,
 *  not the amounts. */
export async function replaceFormula(id: string, input: unknown, actor: ActingStaff): Promise<{ id: string }> {
  await requireManager(actor);
  const formula = checked(input);
  const old = await activeFormula(id);
  await refuseDuplicate(formula, id);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(productFormulas)
      .values({
        ...formula,
        overageMl: String(formula.overageMl),
        scanLayout: old.scanLayout,
        version: old.version + 1,
        createdBy: actor.id,
      })
      .returning({ id: productFormulas.id });
    const retired = await tx
      .update(productFormulas)
      .set({ retiredAt: new Date(), retiredBy: actor.id, replacedById: row.id })
      .where(and(eq(productFormulas.id, id), isNull(productFormulas.retiredAt)))
      .returning({ id: productFormulas.id });
    if (retired.length === 0) throw new ApiError(409, "Someone else changed that formula first — reload the page.");
    return row;
  });
}

/** Takes a formula out of use. It stays on record. */
export async function withdrawFormula(id: string, actor: ActingStaff): Promise<void> {
  await requireManager(actor);
  await activeFormula(id);
  await db
    .update(productFormulas)
    .set({ retiredAt: new Date(), retiredBy: actor.id })
    .where(and(eq(productFormulas.id, id), isNull(productFormulas.retiredAt)));
}
