/**
 * Product formulas and the batch quantity calculation. A formula is data —
 * a list of ingredients, each with how its amount scales, and a table of
 * overages — so a new product needs a new definition (entered on the
 * Worksheets page), not new code.
 *
 * Solutions and suspensions are made by volume (ml); creams and ointments by
 * weight (g) — the formula's base unit. For a batch of `packs` packs of
 * `packSize` each:
 *
 *   overage                 = from the formula's overage table, for this
 *                             pack size and number of packs — added once,
 *                             for the whole batch
 *   total                   = packs × pack size + overage
 *   per 100 (ml or g)       = amount × total ÷ 100
 *   per dose (5 mg in 5 ml) = strength × total ÷ dose
 *   to volume / to weight   = make up to the total
 *   fixed                   = the amount as stated, not scaled
 *   final product quantity  = packs × pack size (no overage)
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

/** "PER_100ML" means per 100 of the base unit — ml or g — and "TO_VOLUME"
 *  made up to the total, by volume or weight; the names predate creams. */
export type FormulaBasis = "PER_100ML" | "PER_DOSE" | "TO_VOLUME" | "FIXED";
export type FormulaUnit = "mcg" | "mg" | "g" | "ml";
/** What the product itself is measured in. */
export type BaseUnit = "ml" | "g";

export const FORMULA_BASES: FormulaBasis[] = ["PER_100ML", "PER_DOSE", "TO_VOLUME", "FIXED"];

/** "Per 100 ml", "To weight" — how a basis reads for a product measured in `unit`. */
export function basisLabel(basis: FormulaBasis, unit: BaseUnit): string {
  switch (basis) {
    case "PER_100ML":
      return `Per 100 ${unit}`;
    case "PER_DOSE":
      return "Per dose";
    case "TO_VOLUME":
      return unit === "g" ? "To weight" : "To volume";
    case "FIXED":
      return "Fixed";
  }
}

export const FORMULA_UNITS: FormulaUnit[] = ["mcg", "mg", "g", "ml"];

/** Decimal places shown when an ingredient doesn't set its own (for the
 *  balance or measuring cylinder it's weighed or measured on). */
export const DEFAULT_DECIMALS: Record<FormulaUnit, number> = { mcg: 0, mg: 1, g: 3, ml: 1 };

/** The product types a formula is for, and what each is measured in. */
export const FORMULA_FORMS: Partial<Record<DosageForm, BaseUnit>> = {
  SOLUTION: "ml",
  SUSPENSION: "ml",
  CREAM: "g",
  OINTMENT: "g",
};

export function defaultBaseUnit(form: DosageForm): BaseUnit {
  return FORMULA_FORMS[form] ?? "ml";
}

export interface FormulaIngredient {
  /** Stable within the formula — a scanned worksheet's layout refers to it. */
  id: string;
  name: string;
  basis: FormulaBasis;
  /** PER_100ML: per 100 ml (or g) of product. PER_DOSE: per dose — null
   *  means the batch's own strength ("5mg/5ml"). FIXED: the amount.
   *  TO_VOLUME: unused. */
  amount: number | null;
  amountUnit: FormulaUnit;
  /** PER_DOSE with an amount: how much product (in the base unit) that
   *  amount is in — 5 for "5 mg in 5 ml". */
  doseVolumeMl: number | null;
  /** The unit of the worksheet's Quantity Required column for it. */
  displayUnit: FormulaUnit;
  /** Decimal places shown — null for the unit's default. */
  decimals: number | null;
  /** Such as a flavour — written on the worksheet as optional. */
  optional: boolean;
}

/**
 * One row of a formula's overage table: for batches of `packSize` (null =
 * any pack size) with `fromPacks` to `toPacks` packs (null = and over), make
 * `amount` extra, once, for the whole batch. A row for a particular pack size
 * wins over an "any pack size" row.
 */
export interface OverageRule {
  packSize: number | null;
  fromPacks: number;
  toPacks: number | null;
  amount: number;
}

export interface FormulaDefinition {
  medicineName: string;
  dosageForm: DosageForm;
  /** The strength it's for — null when it covers every strength (its
   *  per-dose ingredient then follows the batch's). */
  strength: string | null;
  baseUnit: BaseUnit;
  overages: OverageRule[];
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
  /** How many packs (bottles, tubs). */
  packs: number;
  /** Each pack's volume or weight, in the formula's base unit. */
  packSize: number;
  /** The batch's strength as written ("5mg/5ml", "1%"), for per-dose
   *  ingredients that follow it. */
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
  packs: number;
  packSize: number;
  unit: BaseUnit;
  /** The overage made, and the row of the table it came from. */
  overage: number;
  overageRule: OverageRule;
  /** Packs × pack size + overage. */
  total: number;
  /** Packs × pack size — what's supplied, without the overage. */
  finalQuantity: number;
  lines: CalculatedLine[];
  /** Every line of working, in order: total, each ingredient, final
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

/**
 * A strength as an amount in a quantity of product: "5mg/5ml", "5 mg in
 * 5 ml", "1mg/ml", "250mcg per 5ml", "20mg/g", or a percentage — "1%" is
 * 1 g in 100 (ml or g, whichever `baseUnit` is). Null if it isn't one, or
 * isn't in `baseUnit`.
 */
export function parseDoseStrength(
  strength: string | null | undefined,
  baseUnit: BaseUnit = "ml",
): { amount: number; unit: Exclude<FormulaUnit, "ml">; per: number } | null {
  const text = strength?.trim().replace(/µg|μg/gi, "mcg");
  if (!text) return null;
  const percent = text.match(/^(\d+(?:\.\d+)?)\s*%(?:\s*w\/[vw])?$/i);
  if (percent) {
    const amount = Number(percent[1]);
    return amount > 0 ? { amount, unit: "g", per: 100 } : null;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(mcg|mg|g)\s*(?:\/|in|per)\s*(\d+(?:\.\d+)?)?\s*(ml|g)$/i);
  if (!match || match[4].toLowerCase() !== baseUnit) return null;
  const amount = Number(match[1]);
  const per = match[3] === undefined ? 1 : Number(match[3]);
  if (!(amount > 0) || !(per > 0)) return null;
  return { amount, unit: match[2].toLowerCase() as "mcg" | "mg" | "g", per };
}

/* -------------------------------------------------------------------------- */
/* Overages                                                                    */
/* -------------------------------------------------------------------------- */

/** The overage table's row for a batch, or null if there isn't one. A row
 *  for its exact pack size wins over an "any pack size" row. */
export function pickOverage(rules: readonly OverageRule[], packs: number, packSize: number): OverageRule | null {
  const fits = rules.filter(
    (r) =>
      (r.packSize === null || r.packSize === packSize) && packs >= r.fromPacks && (r.toPacks === null || packs <= r.toPacks),
  );
  return fits.find((r) => r.packSize !== null) ?? fits[0] ?? null;
}

/** "1–5", "6 or more", "exactly 3" — the packs a row covers. */
export function packRange(rule: Pick<OverageRule, "fromPacks" | "toPacks">): string {
  if (rule.toPacks === null) return `${rule.fromPacks} or more`;
  return rule.toPacks === rule.fromPacks ? `${rule.fromPacks}` : `${rule.fromPacks}–${rule.toPacks}`;
}

/** Sorted the way the table reads: "any pack size" first, then by pack
 *  size, then by number of packs. */
export function sortOverages(rules: readonly OverageRule[]): OverageRule[] {
  return [...rules].sort(
    (a, b) => (a.packSize ?? -1) - (b.packSize ?? -1) || a.fromPacks - b.fromPacks,
  );
}

/* -------------------------------------------------------------------------- */
/* Checking a definition                                                       */
/* -------------------------------------------------------------------------- */

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

function checkOverages(input: unknown, unit: BaseUnit): Result<OverageRule[]> {
  const fail = (error: string): Result<OverageRule[]> => ({ ok: false, error });
  if (!Array.isArray(input) || input.length === 0) return fail("Add at least one row to the overage table.");
  if (input.length > 100) return fail("The overage table can have at most 100 rows.");

  const rules: OverageRule[] = [];
  for (const [index, entry] of input.entries()) {
    const at = `Overage row ${index + 1}`;
    if (!entry || typeof entry !== "object") return fail(`${at} is missing.`);
    const row = entry as Record<string, unknown>;
    const packSize = num(row.packSize);
    const fromPacks = num(row.fromPacks);
    const toPacks = num(row.toPacks);
    const amount = num(row.amount);
    if ([packSize, fromPacks, toPacks, amount].includes("invalid")) return fail(`${at} has something that isn't a number.`);
    if (packSize !== null && (packSize as number) <= 0) return fail(`${at}: the pack size must be more than 0 ${unit}.`);
    if (fromPacks === null || !Number.isInteger(fromPacks) || (fromPacks as number) < 1) {
      return fail(`${at}: "from" must be a whole number of packs, 1 or more.`);
    }
    if (toPacks !== null && (!Number.isInteger(toPacks) || (toPacks as number) < (fromPacks as number))) {
      return fail(`${at}: "to" must be a whole number, no less than "from" — or blank for "and over".`);
    }
    if (amount === null || (amount as number) < 0) return fail(`${at}: enter the overage — 0 ${unit} or more.`);
    rules.push({
      packSize: packSize as number | null,
      fromPacks: fromPacks as number,
      toPacks: toPacks as number | null,
      amount: amount as number,
    });
  }

  // Two rows for the same pack size mustn't both cover a number of packs.
  for (const [i, a] of rules.entries()) {
    for (const b of rules.slice(i + 1)) {
      if (a.packSize !== b.packSize) continue;
      const overlap = Math.max(a.fromPacks, b.fromPacks) <= Math.min(a.toPacks ?? Infinity, b.toPacks ?? Infinity);
      if (overlap) {
        const size = a.packSize === null ? "any pack size" : `${plain(a.packSize)} ${unit}`;
        return fail(`Two overage rows for ${size} both cover ${Math.max(a.fromPacks, b.fromPacks)} packs.`);
      }
    }
  }
  return { ok: true, value: sortOverages(rules) };
}

/**
 * Checks a formula as entered and returns it tidied. Amounts, dose volumes
 * and decimal places must make sense for the basis; zero and negative
 * amounts are refused, and the overage table can't have overlapping rows.
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
  const baseUnit: BaseUnit = raw.baseUnit === "g" || raw.baseUnit === "ml" ? raw.baseUnit : defaultBaseUnit(dosageForm);

  const overages = checkOverages(raw.overages, baseUnit);
  if (!overages.ok) return overages;

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

    if (!FORMULA_BASES.includes(item.basis as FormulaBasis)) return fail(`Choose how ${label} is worked out.`);
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
    if (doseVolume !== null && doseVolume <= 0) return fail(`The dose for ${label} must be more than zero.`);

    let keptAmount: number | null = amount;
    let keptDose: number | null = null;
    switch (basis) {
      case "PER_100ML":
      case "FIXED":
        if (amount === null) return fail(`Enter the amount of ${label}.`);
        break;
      case "PER_DOSE":
        if (amount !== null) {
          if (doseVolume === null) return fail(`Enter how many ${baseUnit} of product ${label}'s amount is in.`);
          keptDose = doseVolume;
        }
        if (amountUnit === "ml") return fail(`A per-dose amount for ${label} must be a weight (mcg, mg or g).`);
        break;
      case "TO_VOLUME":
        keptAmount = null;
        amountUnit = baseUnit;
        displayUnit = baseUnit;
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
    return fail(`Only one ingredient can be made up to ${baseUnit === "g" ? "weight" : "volume"}.`);
  }

  return {
    ok: true,
    value: { medicineName, dosageForm, strength, baseUnit, overages: overages.value, ingredients, notes },
  };
}

/* -------------------------------------------------------------------------- */
/* Calculating a batch                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Works out every ingredient's Quantity Required for a batch of `packs`
 * packs of `packSize` each. Refuses zero or negative inputs, a batch the
 * overage table has no row for, a per-dose ingredient when the batch's
 * strength isn't an amount in the product, and measured ingredients that
 * would add up to the whole batch before anything is made up to it.
 */
export function calculateBatch(formula: FormulaDefinition, batch: BatchQuantities): Result<Calculation> {
  const fail = (error: string): Result<Calculation> => ({ ok: false, error });
  const unit = formula.baseUnit;
  const { packs, packSize } = batch;
  const packWord = (n: number) => (unit === "ml" ? (n === 1 ? "bottle" : "bottles") : n === 1 ? "pack" : "packs");
  if (!Number.isFinite(packs) || packs <= 0) return fail(`The number of ${packWord(2)} must be more than zero.`);
  if (!Number.isInteger(packs)) return fail(`The number of ${packWord(2)} must be a whole number.`);
  if (!Number.isFinite(packSize) || packSize <= 0) return fail(`The pack size must be more than 0 ${unit}.`);

  const overageRule = pickOverage(formula.overages, packs, packSize);
  if (!overageRule) {
    return fail(
      `The overage table has no row for ${plain(packs)} × ${plain(packSize)} ${unit} — add one to the formula.`,
    );
  }
  const overage = overageRule.amount;
  const totalAmount = packs * packSize + overage;
  const finalQuantity = packs * packSize;
  const total = plain(totalAmount);

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
        value: totalAmount,
        unit,
        text: plain(totalAmount),
        working: `${name}: make up to ${total} ${unit}`,
      });
      continue;
    }

    let raw: number;
    let amountUnit = ingredient.amountUnit;
    let sum: string;
    if (ingredient.basis === "PER_100ML") {
      raw = (ingredient.amount! * totalAmount) / 100;
      sum = `${plain(ingredient.amount!)} ${amountUnit} × ${total} ${unit} ÷ 100 ${unit}`;
    } else if (ingredient.basis === "FIXED") {
      raw = ingredient.amount!;
      sum = `fixed amount`;
    } else {
      // Per dose: the formula's own amount, or the batch's strength.
      let amount = ingredient.amount;
      let per = ingredient.doseVolumeMl;
      if (amount === null || per === null) {
        const dose = parseDoseStrength(batch.strength, unit);
        if (!dose) {
          return fail(
            `${ingredient.name} follows the batch's strength, but "${batch.strength ?? ""}" isn't an amount in the product (such as ${unit === "g" ? "20mg/g or 1%" : "5mg/5ml"}).`,
          );
        }
        amount = dose.amount;
        per = dose.per;
        amountUnit = dose.unit;
      }
      raw = (amount * totalAmount) / per;
      sum = `${plain(amount)} ${amountUnit} × ${total} ${unit} ÷ ${plain(per)} ${unit}`;
    }

    if (!sameKind(amountUnit, ingredient.displayUnit)) {
      return fail(`${ingredient.name} works out in ${amountUnit} but is shown in ${ingredient.displayUnit}.`);
    }
    const value = convert(raw, amountUnit, ingredient.displayUnit);
    const shown = roundForDisplay(value, decimals);

    // "… = 160 mg = 0.160 g": the sum, then the unit the worksheet uses,
    // written to its decimal places — or ", rounded to …" when that
    // changes the number rather than just padding it.
    const steps = [
      ingredient.basis === "FIXED" ? `${sum}, ${plain(raw)} ${amountUnit}` : `${sum} = ${plain(raw)} ${amountUnit}`,
    ];
    const exact = Number(shown) === Number(plain(value));
    if (amountUnit !== ingredient.displayUnit) steps.push(`${exact ? shown : plain(value)} ${ingredient.displayUnit}`);
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

  // What's measured in the product's own unit can't add up to the whole
  // batch when something is made up to it afterwards.
  if (lines.some((l) => l.basis === "TO_VOLUME")) {
    const measured = lines
      .filter((l) => l.basis !== "TO_VOLUME" && sameKind(l.unit, unit))
      .reduce((sum, l) => sum + convert(l.value, l.unit, unit), 0);
    if (measured >= totalAmount) {
      return fail(
        `The other ingredients come to ${plain(measured)} ${unit} — at least the whole batch of ${total} ${unit}, leaving nothing to make up to it.`,
      );
    }
  }

  const covers = `${overageRule.packSize === null ? "any pack size" : `${plain(overageRule.packSize)} ${unit}`}, ${packRange(overageRule)} ${packWord(2)}`;
  const working = [
    `Total = ${plain(packs)} ${packWord(packs)} × ${plain(packSize)} ${unit} + ${plain(overage)} ${unit} overage (for ${covers}) = ${total} ${unit}`,
    ...lines.map((l) => l.working),
    `Final product quantity = ${plain(packs)} × ${plain(packSize)} ${unit} = ${plain(finalQuantity)} ${unit} (without the overage)`,
  ];

  return {
    ok: true,
    value: { packs, packSize, unit, overage, overageRule, total: totalAmount, finalQuantity, lines, working },
  };
}

/** "0.160 g", "to 160 ml" — a line as it reads in a Quantity Required box. */
export function quantityText(line: Pick<CalculatedLine, "basis" | "text" | "unit">): string {
  return line.basis === "TO_VOLUME" ? `to ${line.text} ${line.unit}` : `${line.text} ${line.unit}`;
}
