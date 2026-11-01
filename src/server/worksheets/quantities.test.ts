import { describe, expect, it } from "vitest";
import { calculateBatch, type FormulaDefinition, type FormulaIngredient } from "@/lib/formulaRules";
import type { TextItem } from "./fill";
import { planQuantities, type Measure } from "./quantities";

// Text and positions from page 4 of the Alimemazine Oral Solution worksheet
// (MD85-0154/11), as pdf.js reads them: [x, y, width, height, text].
const page4: TextItem[] = (
  [
    [30, 715, 52, 10, "FORMULA"],
    [45, 704, 49, 9, "Raw Material"],
    [133, 704, 83, 9, "Name of Manufacturer"],
    [127, 693, 94, 9, "Manufacturer’s Batch No."],
    [148, 683, 51, 9, "QC Batch No."],
    [152, 672, 44, 9, "Expiry Date"],
    [256, 704, 31, 9, "Quantity"],
    [256, 693, 33, 9, "Required"],
    [336, 704, 31, 9, "Quantity"],
    [334, 693, 35, 9, "Measured"],
    [404, 704, 32, 9, "Prepared"],
    [454, 672, 45, 9, "(Supervisor)"],
    [30, 657, 75, 10, "ALIMEMAZINE"],
    [30, 645, 71, 10, "TARTRATE BP"],
    [32, 634, 62, 10, "(QC REF 001)"],
    [121, 657, 21, 10, "Man."],
    [177, 657, 45, 10, "_________"],
    [302, 645, 5, 10, "g"],
    [381, 645, 5, 10, "g"],
    [30, 618, 73, 9, "ASCORBIC ACID"],
    [30, 608, 11, 9, "BP"],
    [30, 596, 77, 10, "(0.091g per 100ml)"],
    [302, 596, 5, 10, "g"],
    [381, 596, 5, 10, "g"],
    [30, 563, 37, 9, "SODIUM"],
    [30, 553, 41, 9, "CITRATE"],
    [30, 542, 69, 9, "DIHYDRATE BP"],
    [301, 536, 5, 10, "g"],
    [381, 536, 5, 10, "g"],
    [30, 498, 58, 9, "CITRIC ACID"],
    [30, 487, 67, 9, "MONOYDRATE"],
    [30, 477, 11, 9, "BP"],
    [301, 470, 5, 10, "g"],
    [381, 470, 5, 10, "g"],
    [30, 432, 54, 9, "PRESERVED"],
    [30, 422, 34, 9, "WATER"],
    [296, 405, 11, 10, "ml"],
    [376, 405, 11, 10, "ml"],
    [241, 350, 202, 14, "DISSOLVED POWDER CHECK"],
    [30, 312, 80, 11, "GLYCEROL BP"],
    [238, 324, 8, 10, "to"],
    [296, 289, 11, 10, "ml"],
    [317, 324, 8, 10, "to"],
    [376, 289, 11, 10, "ml"],
    [30, 270, 139, 10, "FINAL PRODUCT QUANTITY"],
    [30, 251, 95, 10, "No. of bottles x volume"],
    [202, 258, 91, 10, "______ x ________ml"],
    [412, 258, 91, 10, "______ x ________ml"],
    [30, 226, 75, 10, "CALCULATION"],
    [30, 216, 153, 8, "Alimemazine Tartrate is freely soluble in water."],
    [30, 170, 72, 10, "COMPONENTS"],
    [306, 159, 221, 9, "Round Amber Glass Bottle(s) or Round Amber PET bottle(s)"],
    [30, 25, 170, 10, "Refer to SOPs GMP33-41 Checked by SA"],
  ] as const
).map(([x, y, width, height, str]) => ({ x, y, width, height, str }));

const ingredient = (id: string, name: string, patch: Partial<FormulaIngredient>): FormulaIngredient => ({
  id,
  name,
  basis: "PER_100ML",
  amount: null,
  amountUnit: "g",
  doseVolumeMl: null,
  displayUnit: "g",
  decimals: 2,
  optional: false,
  ...patch,
});

const alimemazine: FormulaDefinition = {
  medicineName: "Alimemazine",
  dosageForm: "SOLUTION",
  strength: null,
  overageMl: 10,
  notes: null,
  ingredients: [
    ingredient("api", "Alimemazine tartrate BP", { basis: "PER_DOSE", amountUnit: "mg", decimals: 3 }),
    ingredient("ascorbic", "Ascorbic acid BP", { amount: 0.091 }),
    ingredient("citrate", "Sodium citrate dihydrate BP", { amount: 0.197 }),
    ingredient("citric", "Citric acid monohydrate BP", { amount: 0.1 }),
    ingredient("water", "Preserved water", { amount: 80, amountUnit: "ml", displayUnit: "ml", decimals: null }),
    ingredient("glycerol", "Glycerol BP", { basis: "TO_VOLUME", amountUnit: "ml", displayUnit: "ml", decimals: null, optional: true }),
  ],
};

/** Helvetica-ish: half the size per character. */
const measure: Measure = (text, size) => text.length * size * 0.5;

function calc() {
  const result = calculateBatch(alimemazine, { bottles: 1, packSizeMl: 150, strength: "7.5mg/5ml" });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("planQuantities on a worksheet with text", () => {
  const plan = planQuantities([[], [], [], page4], calc(), measure, null, "sheet");
  const at = (text: string) => plan.draws.find((d) => d.text === text);

  it("writes each amount in its own row, ending just before the printed unit", () => {
    expect([...plan.quantities].sort()).toEqual(["api", "ascorbic", "citrate", "citric", "glycerol", "water"]);
    // 7.5 mg × 160 ÷ 5 = 240 mg = 0.240 g, before the "g" at (302, 645).
    const api = at("0.240")!;
    expect(api.page).toBe(3);
    expect(api.y).toBe(645);
    expect(api.x + measure("0.240", api.size, "bold")).toBe(299);
    expect(at("0.15")?.y).toBe(596); // 0.091 × 1.6 = 0.1456
    expect(at("0.32")?.y).toBe(536); // 0.197 × 1.6 = 0.3152
    expect(at("0.16")?.y).toBe(470);
    expect(at("128.0")?.y).toBe(405);
    // "to" is printed, so just the volume — on the ml line, not the "to" line.
    expect(at("160")?.y).toBe(289);
    expect(at("(optional)")?.y).toBe(289);
  });

  it("fills in the bottles and volume in the first blanks", () => {
    expect(plan.finalQuantity).toBe(true);
    expect(at("1")).toMatchObject({ y: 259.5 });
    expect(at("1")!.x).toBeLessThan(250);
    expect(at("150")).toMatchObject({ y: 259.5 });
    expect(at("= 150 ml")).toBeDefined();
  });

  it("points to the added page when the working won't fit the Calculation box legibly", () => {
    expect(plan.calculation).toBe(false);
    expect(plan.draws.filter((d) => d.font === "regular").map((d) => d.text)).toEqual([
      "(optional)",
      "Calculation: see the batch calculation page added at the end of this worksheet.",
    ]);
  });

  it("writes the working in the box when there's room", () => {
    // The same page with nothing below the Calculation heading until the footer.
    const roomy = page4.filter((o) => o.y > 200 || o.y < 30);
    const plan = planQuantities([roomy], calc(), measure, null, "sheet");
    expect(plan.calculation).toBe(true);
    const working = plan.draws.filter((d) => d.font === "regular" && d.text !== "(optional)");
    expect(working.map((d) => d.text)).toEqual(calc().working);
    for (const d of working) {
      expect(d.y).toBeLessThan(216); // below the printed note
      expect(d.y).toBeGreaterThan(36); // above the footer
    }
  });
});

describe("planQuantities on a scanned worksheet", () => {
  const layout = {
    worksheetId: "scan",
    page: 4,
    quantities: { api: { x: 290, y: 550 } },
    finalQuantity: { bottles: { x: 215, y: 305 }, packSize: { x: 260, y: 305 } },
    calculation: { x: 22, y: 60, width: 530, height: 200 },
  };

  it("uses the layout measured for that worksheet only", () => {
    const pages = [[], [], [], []];
    const plan = planQuantities(pages, calc(), measure, layout, "scan");
    expect([...plan.quantities]).toEqual(["api"]);
    expect(plan.draws.find((d) => d.text === "0.240")).toMatchObject({ page: 3, y: 550 });
    expect(plan.finalQuantity && plan.calculation).toBe(true);

    const other = planQuantities(pages, calc(), measure, layout, "a newer version");
    expect(other.draws).toEqual([]);
    expect(other.quantities.size).toBe(0);
  });
});
