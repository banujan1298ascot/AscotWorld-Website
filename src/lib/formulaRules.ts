/**
 * Product formulas and the batch quantity calculation. A formula is data —
 * a list of ingredients, each with how its amount scales — so a new product
 * needs a new definition (entered on the Worksheets page), not new code.
 *
 * For a solution, the batch is made with an overage on every bottle:
 *
 *   total volume (ml)       = bottles × (pack size + overage)
 *   per 100 ml              = amount × total volume ÷ 100
 *   per dose (5 mg in 5 ml) = strength × total volume ÷ dose volume
 *   to volume               = make up to the total volume
 *   fixed                   = the amount as stated, not scaled
 *   final product quantity  = bottles × pack size (no overage)
 *
 * Nothing is rounded until the value shown, to the ingredient's decimal
 * places (g to 3, ml to 1 unless the formula says otherwise). Every line
 * carries its working, so the check can be repeated by hand.
 *
 * Pure (no React, no DB) — the Worksheets page uses it to try a formula out,
 * and the server to fill in a batch's generated worksheet.
 */
import { DOSAGE_FORM_VALUES, type DosageForm } from "./products";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type FormulaBasis = "PER_100ML" | "PER_DOSE" | "TO_VOLUME" | "FIXED";
export type FormulaUnit = "mcg" | "mg" | "g" | "ml";

export const FORMULA_BASES: { value: FormulaBasis; label: string; hint: string }[] = [
  { value: "PER_100ML", label: "Per 100 ml", hint: "amount × total volume ÷ 100" },
  { value: "PER_DOSE", label: "Per dose", hint: "strength × total volume ÷ dose volume" },
  { value: "TO_VOLUME", label: "To volume", hint: "made up to the total volume" },
  { value: "FIXED", label: "Fixed", hint: "the stated amount, not scaled" },
];

export const FORMULA_UNITS: FormulaUnit[] = ["mcg", "mg", "g", "ml"];

/** Decimal places shown when an ingredient doesn't set its own (for the
 *  balance or measuring cylinder it's weighed or measured on). */
export const DEFAULT_DECIMALS: Record<FormulaUnit, number> = { mcg: 0, mg: 1, g: 3, ml: 1 };

/** Extra volume made per bottle of a solution, so every bottle can be
 *  filled to its full volume. */
export const DEFAULT_OVERAGE_ML = 10;

export interface FormulaIngredient {
  /** Stable within the formula — a scanned worksheet's layout refers to it. */
  id: string;
  name: string;
  basis: FormulaBasis;
  /** PER_100ML: per 100 ml of product. PER_DOSE: per dose — null means the
   *  batch's own strength ("5mg/5ml"). FIXED: the amount. TO_VOLUME: unused. */
  amount: number | null;
  amountUnit: FormulaUnit;
  /** PER_DOSE with an amount: the dose volume it's in (ml). */
  doseVolumeMl: number | null;
  /** The unit of the worksheet's Quantity Required column for it. */
  displayUnit: FormulaUnit;
  /** Decimal places shown — null for the unit's default. */
  decimals: number | null;
  /** Such as a flavour — written on the worksheet as optional. */
  optional: boolean;
}

export interface FormulaDefinition {
  medicineName: string;
  dosageForm: DosageForm;
  /** The strength it's for — null when it covers every strength (its
   *  per-dose ingredient then follows the batch's). */
  strength: string | null;
  overageMl: number;
  ingredients: FormulaIngredient[];
  notes: string | null;
}

/** A point on a worksheet page, in PDF points from the bottom-left. */
export interface PagePoint {
  x: number;
  y: number;
}

/**
 * Where the quantities go on a scanned worksheet — one that's a picture,
 * with no text to find the Quantity Required column by. Measured once for
 * the worksheet it names, and used only for that file: a new version of
 * the worksheet needs measuring again.
 */
export interface ScanLayout {
  worksheetId: string;
  /** 1-based. */
  page: number;
  /** Per ingredient id: where its number ends (just before the printed
   *  unit) and its baseline. */
  quantities: Record<string, PagePoint>;
  /** The centres of the two blanks in "____ x ____ ml". */
  finalQuantity?: { bottles: PagePoint; packSize: PagePoint };
  /** The Calculation box. */
  calculation?: { x: number; y: number; width: number; height: number };
}

export interface BatchQuantities {
  /** How many bottles (packs). */
  bottles: number;
  /** Volume of each bottle, ml. */
  packSizeMl: number;
  /** The batch's strength as written ("5mg/5ml"), for per-dose ingredients
   *  that follow it. */
  strength: string | null;
}

export interface CalculatedLine {
  ingredientId: string;
  name: string;
  basis: FormulaBasis;
  optional: boolean;
  /** Unrounded, in `unit`. */
  value: number;
  unit: FormulaUnit;
  /** The value as shown, rounded: "0.160". */
  text: string;
  /** "Melatonin BP: 5 mg × 160 ml ÷ 5 ml = 160 mg = 0.160 g" */
  working: string;
}

export interface Calculation {
  bottles: number;
  packSizeMl: number;
  overageMl: number;
  totalVolumeMl: number;
  /** Bottles × pack size — what's supplied, without the overage. */
  finalQuantityMl: number;
  lines: CalculatedLine[];
  /** Every line of working, in order: total volume, each ingredient, final
   *  product quantity. */
  working: string[];
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

const MG_PER: Record<Exclude<FormulaUnit, "ml">, number> = { mcg: 0.001, mg: 1, g: 1000 };
const isMass = (unit: FormulaUnit): unit is Exclude<FormulaUnit, "ml"> => unit !== "ml";
export const sameKind = (a: FormulaUnit, b: FormulaUnit) => isMass(a) === isMass(b);

function convert(value: number, from: FormulaUnit, to: FormulaUnit): number {
  if (from === to || !isMass(from) || !isMass(to)) return value;
  return (value * MG_PER[from]) / MG_PER[to];
}

/** Rounded to `decimals` places only here, for display — half away from
 *  zero, without binary fractions tipping 0.0005 the wrong way. */
export function roundForDisplay(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor * (1 + Number.EPSILON)) / factor;
  return (Math.sign(value) * rounded).toFixed(decimals);
}

/** A number in the working: as it is, to at most 6 places, without
 *  trailing zeros — "160", "12.8", "0.3152". */
export function plain(value: number): string {
  return Number(value.toFixed(6)).toLocaleString("en-GB", { useGrouping: false, maximumFractionDigits: 6 });
}

/** "5mg/5ml", "5 mg in 5 ml", "1mg/ml", "250mcg per 5ml" → amount per dose
 *  volume. Null if the strength isn't an amount in a volume. */
export function parseDoseStrength(
  strength: string | null | undefined,
): { amount: number; unit: Exclude<FormulaUnit, "ml">; volumeMl: number } | null {
  const match = strength
    ?.trim()
    .replace(/µg|μg/gi, "mcg")
    .match(/^(\d+(?:\.\d+)?)\s*(mcg|mg|g)\s*(?:\/|in|per)\s*(\d+(?:\.\d+)?)?\s*ml$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const volumeMl = match[3] === undefined ? 1 : Number(match[3]);
  if (!(amount > 0) || !(volumeMl > 0)) return null;
  return { amount, unit: match[2].toLowerCase() as "mcg" | "mg" | "g", volumeMl };
}

/* -------------------------------------------------------------------------- */
/* Checking a definition                                                       */
/* -------------------------------------------------------------------------- */

const BASIS_VALUES = FORMULA_BASES.map((b) => b.value);

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
}

/** A number from a form field or JSON: null when left blank. */
function num(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isFinite(n) ? n : "invalid";
}

/**
 * Checks a formula as entered and returns it tidied. Amounts, dose volumes
 * and decimal places must make sense for the basis; zero and negative
 * amounts are refused.
 */
export function checkFormula(input: unknown): Result<FormulaDefinition> {
  const fail = (error: string): Result<FormulaDefinition> => ({ ok: false, error });
  if (!input || typeof input !== "object") return fail("Expected a formula.");
  const raw = input as Record<string, unknown>;

  const medicineName = text(raw.medicineName, 120);
  if (!medicineName) return fail("Enter the medicine name.");
  if (!DOSAGE_FORM_VALUES.includes(raw.dosageForm as DosageForm)) return fail("Choose the product type.");
  const dosageForm = raw.dosageForm as DosageForm;
  const strength = text(raw.strength, 40);
  const notes = text(raw.notes, 1000);

  const overage = num(raw.overageMl);
  if (overage === "invalid" || overage === null || overage < 0 || overage > 1000) {
    return fail("The overage per bottle must be 0 ml or more.");
  }

  if (!Array.isArray(raw.ingredients) || raw.ingredients.length === 0) return fail("Add at least one ingredient.");
  if (raw.ingredients.length > 40) return fail("A formula can have at most 40 ingredients.");

  const ingredients: FormulaIngredient[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of raw.ingredients.entries()) {
    const at = `Ingredient ${index + 1}`;
    if (!entry || typeof entry !== "object") return fail(`${at} is missing.`);
    const item = entry as Record<string, unknown>;
    const name = text(item.name, 120);
    if (!name) return fail(`${at} needs a name.`);
    const label = `${name} (ingredient ${index + 1})`;

    let id = text(item.id, 40) ?? `i${index + 1}`;
    while (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);

    if (!BASIS_VALUES.includes(item.basis as FormulaBasis)) return fail(`Choose how ${label} is worked out.`);
    const basis = item.basis as FormulaBasis;
    if (!FORMULA_UNITS.includes(item.amountUnit as FormulaUnit) || !FORMULA_UNITS.includes(item.displayUnit as FormulaUnit)) {
      return fail(`Choose the units for ${label}.`);
    }
    let amountUnit = item.amountUnit as FormulaUnit;
    let displayUnit = item.displayUnit as FormulaUnit;

    const amount = num(item.amount);
    const doseVolume = num(item.doseVolumeMl);
    const decimals = num(item.decimals);
    if (amount === "invalid" || doseVolume === "invalid" || decimals === "invalid") {
      return fail(`${label} has something that isn't a number.`);
    }
    if (decimals !== null && (!Number.isInteger(decimals) || decimals < 0 || decimals > 4)) {
      return fail(`Decimal places for ${label} must be a whole number from 0 to 4.`);
    }
    if (amount !== null && amount <= 0) return fail(`The amount for ${label} must be more than zero.`);
    if (doseVolume !== null && doseVolume <= 0) return fail(`The dose volume for ${label} must be more than zero.`);

    let keptAmount: number | null = amount;
    let keptDose: number | null = null;
    switch (basis) {
      case "PER_100ML":
      case "FIXED":
        if (amount === null) return fail(`Enter the amount of ${label}.`);
        break;
      case "PER_DOSE":
        if (amount !== null) {
          if (doseVolume === null) return fail(`Enter the dose volume (ml) ${label}'s amount is in.`);
          keptDose = doseVolume;
        }
        if (amountUnit === "ml") return fail(`A per-dose amount for ${label} must be a weight (mcg, mg or g).`);
        break;
      case "TO_VOLUME":
        keptAmount = null;
        amountUnit = "ml";
        displayUnit = "ml";
        break;
    }
    if (!sameKind(amountUnit, displayUnit)) {
      return fail(`${label} is measured in ${amountUnit} but shown in ${displayUnit} — a weight can't become a volume.`);
    }

    ingredients.push({
      id,
      name,
      basis,
      amount: keptAmount,
      amountUnit,
      doseVolumeMl: keptDose,
      displayUnit,
      decimals,
      optional: item.optional === true,
    });
  }
  if (ingredients.filter((i) => i.basis === "TO_VOLUME").length > 1) {
    return fail("Only one ingredient can be made up to volume.");
  }

  return { ok: true, value: { medicineName, dosageForm, strength, overageMl: overage, ingredients, notes } };
}

/* -------------------------------------------------------------------------- */
/* Calculating a batch                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Works out every ingredient's Quantity Required for a batch of `bottles`
 * bottles of `packSizeMl` each. Refuses zero or negative inputs, a per-dose
 * ingredient when the batch's strength isn't an amount per volume, and
 * ingredients measured in ml that would add up to more than the batch.
 */
export function calculateBatch(formula: FormulaDefinition, batch: BatchQuantities): Result<Calculation> {
  const fail = (error: string): Result<Calculation> => ({ ok: false, error });
  const { bottles, packSizeMl } = batch;
  if (!Number.isFinite(bottles) || bottles <= 0) return fail("The number of bottles must be more than zero.");
  if (!Number.isInteger(bottles)) return fail("The number of bottles must be a whole number.");
  if (!Number.isFinite(packSizeMl) || packSizeMl <= 0) return fail("The pack size must be more than 0 ml.");
  if (!Number.isFinite(formula.overageMl) || formula.overageMl < 0) return fail("The formula's overage can't be negative.");

  const totalVolumeMl = bottles * (packSizeMl + formula.overageMl);
  const finalQuantityMl = bottles * packSizeMl;
  const total = plain(totalVolumeMl);

  const lines: CalculatedLine[] = [];
  for (const ingredient of formula.ingredients) {
    const name = ingredient.optional ? `${ingredient.name} (optional)` : ingredient.name;
    const decimals = ingredient.decimals ?? DEFAULT_DECIMALS[ingredient.displayUnit];

    if (ingredient.basis === "TO_VOLUME") {
      lines.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        basis: "TO_VOLUME",
        optional: ingredient.optional,
        value: totalVolumeMl,
        unit: "ml",
        text: plain(totalVolumeMl),
        working: `${name}: make up to ${total} ml`,
      });
      continue;
    }

    let raw: number;
    let unit = ingredient.amountUnit;
    let sum: string;
    if (ingredient.basis === "PER_100ML") {
      raw = (ingredient.amount! * totalVolumeMl) / 100;
      sum = `${plain(ingredient.amount!)} ${unit} × ${total} ml ÷ 100 ml`;
    } else if (ingredient.basis === "FIXED") {
      raw = ingredient.amount!;
      sum = `fixed amount`;
    } else {
      // Per dose: the formula's own amount, or the batch's strength.
      let amount = ingredient.amount;
      let doseVolume = ingredient.doseVolumeMl;
      if (amount === null || doseVolume === null) {
        const dose = parseDoseStrength(batch.strength);
        if (!dose) {
          return fail(
            `${ingredient.name} follows the batch's strength, but "${batch.strength ?? ""}" isn't an amount in a volume (such as 5mg/5ml).`,
          );
        }
        amount = dose.amount;
        doseVolume = dose.volumeMl;
        unit = dose.unit;
      }
      raw = (amount * totalVolumeMl) / doseVolume;
      sum = `${plain(amount)} ${unit} × ${total} ml ÷ ${plain(doseVolume)} ml`;
    }

    if (!sameKind(unit, ingredient.displayUnit)) {
      return fail(`${ingredient.name} works out in ${unit} but is shown in ${ingredient.displayUnit}.`);
    }
    const value = convert(raw, unit, ingredient.displayUnit);
    const shown = roundForDisplay(value, decimals);

    // "… = 160 mg = 0.160 g": the sum, then the unit the worksheet uses,
    // written to its decimal places — or ", rounded to …" when that
    // changes the number rather than just padding it.
    const steps = [ingredient.basis === "FIXED" ? `${sum}, ${plain(raw)} ${unit}` : `${sum} = ${plain(raw)} ${unit}`];
    const exact = Number(shown) === Number(plain(value));
    if (unit !== ingredient.displayUnit) steps.push(`${exact ? shown : plain(value)} ${ingredient.displayUnit}`);
    let working = `${name}: ${steps.join(" = ")}`;
    if (!exact) working += `, rounded to ${shown} ${ingredient.displayUnit}`;

    lines.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      basis: ingredient.basis,
      optional: ingredient.optional,
      value,
      unit: ingredient.displayUnit,
      text: shown,
      working,
    });
  }

  // What's measured by volume can't add up to more than the batch when
  // something is made up to volume after it.
  if (lines.some((l) => l.basis === "TO_VOLUME")) {
    const byVolume = lines.filter((l) => l.basis !== "TO_VOLUME" && l.unit === "ml").reduce((sum, l) => sum + l.value, 0);
    if (byVolume >= totalVolumeMl) {
      return fail(
        `The ingredients measured in ml come to ${plain(byVolume)} ml — at least the whole batch of ${total} ml, leaving nothing to make up to volume.`,
      );
    }
  }

  const bottleWord = bottles === 1 ? "bottle" : "bottles";
  const working = [
    `Total volume = ${plain(bottles)} ${bottleWord} × (${plain(packSizeMl)} ml + ${plain(formula.overageMl)} ml overage) = ${total} ml`,
    ...lines.map((l) => l.working),
    `Final product quantity = ${plain(bottles)} × ${plain(packSizeMl)} ml = ${plain(finalQuantityMl)} ml (without the overage)`,
  ];

  return {
    ok: true,
    value: {
      bottles,
      packSizeMl,
      overageMl: formula.overageMl,
      totalVolumeMl,
      finalQuantityMl,
      lines,
      working,
    },
  };
}

/** "0.160 g", "to 160 ml" — a line as it reads in a Quantity Required box. */
export function quantityText(line: Pick<CalculatedLine, "basis" | "text" | "unit">): string {
  return line.basis === "TO_VOLUME" ? `to ${line.text} ${line.unit}` : `${line.text} ${line.unit}`;
}
