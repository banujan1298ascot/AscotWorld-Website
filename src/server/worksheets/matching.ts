/**
 * Which approved worksheet a batch should be made from: the one whose
 * product name, file name or reference names the batch's medicine, its
 * strength and its type — "3,4-DIAMINOPYRIDINE" with "…20mg TABLETS 100s…"
 * in its file name for a batch of 3,4-Diaminopyridine 20mg Tablets.
 * Pure, so it's unit-tested directly (matching.test.ts).
 */
import { parseProductName, type DosageForm } from "@/lib/products";

export interface BatchProduct {
  medicineName: string;
  strength: string | null;
  dosageForm: DosageForm | null;
  packSize: number | null;
}

/** A batch's product as parts — entered that way, or split from an older
 *  free-text name. */
export function batchProductOf(batch: {
  productName: string | null;
  medicineName: string | null;
  strength: string | null;
  dosageForm: DosageForm | null;
  packSize: string | null;
}): BatchProduct | null {
  const parsed = batch.productName ? parseProductName(batch.productName) : null;
  const medicineName = batch.medicineName?.trim() || parsed?.medicineName;
  if (!medicineName) return null;
  return {
    medicineName,
    strength: batch.strength?.trim() || parsed?.strength || null,
    dosageForm: batch.dosageForm ?? parsed?.dosageForm ?? null,
    packSize: batch.packSize ? Number(batch.packSize) : null,
  };
}

/** Lower case, "µg"/"microgram" as "mcg", and a strength's number joined
 *  to its unit ("20 mg" → "20mg"), so the two sides compare like for like. */
export function normaliseProductText(text: string): string {
  return text
    .toLowerCase()
    .replace(/µg|μg|micrograms?/g, "mcg")
    .replace(/milligrams?/g, "mg")
    .replace(/(\d)\s+(mcg|mg|g|ml|iu|%)/g, "$1$2")
    .replace(/[^a-z0-9.,%/+-]+/g, " ")
    .trim();
}

const FORM_WORDS: Partial<Record<DosageForm, string>> = {
  TABLETS: "tablet",
  CAPSULES: "capsule",
  CREAM: "cream",
  OINTMENT: "ointment",
  SOLUTION: "solution",
  SUSPENSION: "suspension",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "20mg", "5mg/5ml", "0.1%" — any strength at all, once normalised. */
const ANY_STRENGTH = /(^|[^0-9.a-z])\d+(\.\d+)?(mcg|mg|g|ml|iu|%)(?![a-z])/;

/**
 * How well a worksheet's text fits the batch: null if it isn't a match at
 * all — the medicine's every word, the strength and the type must all
 * appear — otherwise a score, higher when its pack count ("100s") is the
 * batch's too. A worksheet naming a different pack count isn't a match.
 *
 * A worksheet that names no strength at all ("Melatonin Oral Solution",
 * whose form has "____ mg in 5ml" to fill in) is for every strength: it
 * matches, but one naming the batch's own strength always wins over it.
 */
export function worksheetMatchScore(product: BatchProduct, worksheetText: string): number | null {
  const text = ` ${normaliseProductText(worksheetText)} `;

  const nameWords = normaliseProductText(product.medicineName).split(" ").filter(Boolean);
  if (nameWords.length === 0 || !nameWords.every((word) => text.includes(word))) return null;

  let score = 3;
  if (product.strength) {
    const strength = normaliseProductText(product.strength).replace(/\s+/g, "");
    // "20mg", but not as the end of "120mg".
    if (!new RegExp(`(^|[^0-9.])${escape(strength)}(?![a-z])`).test(text)) {
      if (ANY_STRENGTH.test(text)) return null;
      score = 1;
    }
  }

  const formWord = product.dosageForm ? FORM_WORDS[product.dosageForm] : undefined;
  if (formWord && !text.includes(formWord)) return null;

  const packCounts = [...text.matchAll(/\s(\d+)s(?=[\s.,)])/g)].map((m) => Number(m[1]));
  if (packCounts.length > 0 && product.packSize) {
    if (!packCounts.includes(product.packSize)) return null;
    score += 1;
  }
  return score;
}

/** The best matching worksheet; ties go to the most recently uploaded. */
export function pickWorksheet<T extends { productName: string; fileName: string; reference: string | null; uploadedAt: Date }>(
  product: BatchProduct,
  candidates: T[],
): T | null {
  let best: { worksheet: T; score: number } | null = null;
  for (const worksheet of candidates) {
    const score = worksheetMatchScore(
      product,
      [worksheet.productName, worksheet.fileName.replace(/\.(pdf|docx?|xlsx?)$/i, ""), worksheet.reference ?? ""].join(" "),
    );
    if (score === null) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && worksheet.uploadedAt > best.worksheet.uploadedAt)
    ) {
      best = { worksheet, score };
    }
  }
  return best?.worksheet ?? null;
}

/* -------------------------------------------------------------------------- */
/* Formulas                                                                    */
/* -------------------------------------------------------------------------- */

const strengthKey = (strength: string | null | undefined) =>
  strength ? normaliseProductText(strength).replace(/\s+/g, "") : "";

/**
 * The formula for a batch's product: same medicine name and type, and
 * either the batch's strength or no strength (one formula for every
 * strength). One for the exact strength wins; ties go to the newest.
 */
export function pickFormula<T extends { medicineName: string; dosageForm: DosageForm; strength: string | null; createdAt: Date }>(
  product: BatchProduct,
  candidates: T[],
): T | null {
  const name = normaliseProductText(product.medicineName);
  let best: { formula: T; score: number } | null = null;
  for (const formula of candidates) {
    if (normaliseProductText(formula.medicineName) !== name || formula.dosageForm !== product.dosageForm) continue;
    let score: number;
    if (!formula.strength) score = 1;
    else if (strengthKey(formula.strength) === strengthKey(product.strength)) score = 2;
    else continue;
    if (!best || score > best.score || (score === best.score && formula.createdAt > best.formula.createdAt)) {
      best = { formula, score };
    }
  }
  return best?.formula ?? null;
}

/** Whether two formulas are for the same product — so only one can be in use. */
export function sameFormulaProduct(
  a: { medicineName: string; dosageForm: DosageForm; strength: string | null },
  b: { medicineName: string; dosageForm: DosageForm; strength: string | null },
): boolean {
  return (
    normaliseProductText(a.medicineName) === normaliseProductText(b.medicineName) &&
    a.dosageForm === b.dosageForm &&
    strengthKey(a.strength) === strengthKey(b.strength)
  );
}
