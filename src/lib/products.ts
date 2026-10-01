/**
 * How a batch's product is described, shared by the Batch Book form and the
 * server: a name ("Paracetamol"), a strength ("500mg"), a type (Tablets,
 * Cream, ...) and a pack size or volume. The full product name the rest of
 * the portal shows and groups by ("Paracetamol 500mg Tablets") is built from
 * those — `composeProductName` — so the MES, the reports and the product
 * timing search keep working on one consistent string.
 *
 * Batches entered before these fields existed only have the full name;
 * `parseProductName` splits it back up as best it can, so they still offer
 * themselves as suggestions with the fields filled in.
 *
 * Pure (no React, no DB) — imported by both client and server.
 */

export type DosageForm = "TABLETS" | "CAPSULES" | "CREAM" | "OINTMENT" | "SOLUTION" | "SUSPENSION" | "OTHER";
export type PackUnit = "tablets" | "capsules" | "ml" | "g";

export interface DosageFormInfo {
  value: DosageForm;
  label: string;
  /** What the pack field is called for this type: tablets and capsules
   *  come in a count per pack, liquids and creams in a volume. */
  packLabel: "Pack size" | "Volume";
  /** Units the pack field offers, the usual one first. */
  packUnits: PackUnit[];
}

/** In the order the type dropdown lists them. */
export const DOSAGE_FORMS: DosageFormInfo[] = [
  { value: "TABLETS", label: "Tablets", packLabel: "Pack size", packUnits: ["tablets"] },
  { value: "CAPSULES", label: "Capsules", packLabel: "Pack size", packUnits: ["capsules"] },
  { value: "CREAM", label: "Cream", packLabel: "Volume", packUnits: ["g", "ml"] },
  { value: "OINTMENT", label: "Ointment", packLabel: "Volume", packUnits: ["g", "ml"] },
  { value: "SOLUTION", label: "Solution", packLabel: "Volume", packUnits: ["ml"] },
  { value: "SUSPENSION", label: "Suspension", packLabel: "Volume", packUnits: ["ml"] },
  { value: "OTHER", label: "Other", packLabel: "Pack size", packUnits: ["ml", "g", "tablets", "capsules"] },
];

export const DOSAGE_FORM_VALUES = DOSAGE_FORMS.map((f) => f.value);
export const PACK_UNITS: PackUnit[] = ["tablets", "capsules", "ml", "g"];

export function dosageFormInfo(form: DosageForm | null | undefined): DosageFormInfo | undefined {
  return DOSAGE_FORMS.find((f) => f.value === form);
}

/** "Paracetamol" + "500mg" + Tablets → "Paracetamol 500mg Tablets". "Other"
 *  adds no type word. A bracketed note on the name — "Gabapentin (Vet)" —
 *  goes at the very end, as it always has: "Gabapentin 50mg/ml Solution
 *  (Vet)". Null when there's no name to build from. */
export function composeProductName(parts: {
  medicineName?: string | null;
  strength?: string | null;
  dosageForm?: DosageForm | null;
}): string | null {
  const raw = parts.medicineName?.trim();
  if (!raw) return null;
  const notes = raw.match(/\([^)]*\)/g) ?? [];
  const name = raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  const form = parts.dosageForm && parts.dosageForm !== "OTHER" ? dosageFormInfo(parts.dosageForm)?.label : undefined;
  return [name, parts.strength?.trim() || undefined, form, ...(name === raw ? [] : notes)].filter(Boolean).join(" ");
}

/** "28 tablets", "100 ml", "50 g". */
export function formatPack(size: number | string | null | undefined, unit: PackUnit | null | undefined): string | null {
  if (size === null || size === undefined || size === "" || !unit) return null;
  const n = Number(size);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString("en-GB")} ${unit}`;
}

/* -------------------------------------------------------------------------- */
/* Splitting an older, free-text product name                                 */
/* -------------------------------------------------------------------------- */

// "500mg", "2mg/ml", "50mcg/5ml", "1.5mg/ml", "0.9%", "1 %", "100 IU".
const STRENGTH = /(\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|iu|units?|%)(?:\s?\/\s?\d*(?:\.\d+)?\s?(?:mg|mcg|g|ml))?)(?=\s|$|\))/i;

const FORM_WORDS: [RegExp, DosageForm][] = [
  [/\btablets?\b/i, "TABLETS"],
  [/\bcapsules?\b/i, "CAPSULES"],
  [/\bcreams?\b/i, "CREAM"],
  [/\bointments?\b/i, "OINTMENT"],
  [/\bsuspensions?\b/i, "SUSPENSION"],
  [/\bsolutions?\b/i, "SOLUTION"],
];

/**
 * Best-effort split of a full product name into its parts — for batches
 * entered as one free-text name before the separate fields existed. The
 * name is what comes before the strength, with anything in brackets (such
 * as "(Vet)") kept on it; the type is the first type word found. Whatever
 * can't be placed is left out rather than guessed.
 */
export function parseProductName(full: string): {
  medicineName: string;
  strength: string | null;
  dosageForm: DosageForm | null;
} {
  const text = full.trim().replace(/\s+/g, " ");
  const brackets = text.match(/\([^)]*\)/g) ?? [];
  const withoutBrackets = text.replace(/\s*\([^)]*\)/g, "").trim();

  const strengthMatch = withoutBrackets.match(STRENGTH);
  const strength = strengthMatch ? strengthMatch[1].replace(/\s+/g, "") : null;

  const formEntry = FORM_WORDS.find(([re]) => re.test(withoutBrackets));
  const dosageForm = formEntry ? formEntry[1] : null;

  let name: string;
  if (strengthMatch && strengthMatch.index !== undefined && strengthMatch.index > 0) {
    name = withoutBrackets.slice(0, strengthMatch.index).trim();
  } else {
    name = formEntry ? withoutBrackets.replace(formEntry[0], "").trim() : withoutBrackets;
  }
  const medicineName = [name, ...brackets].filter(Boolean).join(" ") || text;
  return { medicineName, strength, dosageForm };
}
