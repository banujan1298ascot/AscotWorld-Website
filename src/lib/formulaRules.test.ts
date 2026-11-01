import { describe, expect, it } from "vitest";
import {
  calculateBatch,
  checkFormula,
  parseDoseStrength,
  quantityText,
  roundForDisplay,
  type FormulaDefinition,
  type FormulaIngredient,
} from "./formulaRules";

const ingredient = (overrides: Partial<FormulaIngredient>): FormulaIngredient => ({
  id: "x",
  name: "Ingredient",
  basis: "PER_100ML",
  amount: 1,
  amountUnit: "ml",
  doseVolumeMl: null,
  displayUnit: "ml",
  decimals: null,
  optional: false,
  ...overrides,
});

const melatonin: FormulaDefinition = {
  medicineName: "Melatonin",
  dosageForm: "SOLUTION",
  strength: null,
  overageMl: 10,
  notes: null,
  ingredients: [
    ingredient({ id: "api", name: "Melatonin BP", basis: "PER_DOSE", amount: null, amountUnit: "mg", displayUnit: "g" }),
    ingredient({ id: "pg", name: "Propylene glycol BP", amount: 8 }),
    ingredient({ id: "flavour", name: "Flavour", amount: 0.5, optional: true }),
    ingredient({ id: "diluent", name: "Melatonin AF, FF diluent", basis: "TO_VOLUME", amount: null }),
  ],
};

describe("calculateBatch", () => {
  it("works the Melatonin 5mg/5ml example: 1 × 150 ml makes 160 ml", () => {
    const result = calculateBatch(melatonin, { bottles: 1, packSizeMl: 150, strength: "5mg/5ml" });
    if (!result.ok) throw new Error(result.error);
    const calc = result.value;
    expect(calc.totalVolumeMl).toBe(160);
    expect(calc.finalQuantityMl).toBe(150);
    expect(calc.lines.map(quantityText)).toEqual(["0.160 g", "12.8 ml", "0.8 ml", "to 160 ml"]);
    expect(calc.lines[2].optional).toBe(true);
    expect(calc.working).toEqual([
      "Total volume = 1 bottle × (150 ml + 10 ml overage) = 160 ml",
      "Melatonin BP: 5 mg × 160 ml ÷ 5 ml = 160 mg = 0.160 g",
      "Propylene glycol BP: 8 ml × 160 ml ÷ 100 ml = 12.8 ml",
      "Flavour (optional): 0.5 ml × 160 ml ÷ 100 ml = 0.8 ml",
      "Melatonin AF, FF diluent: make up to 160 ml",
      "Final product quantity = 1 × 150 ml = 150 ml (without the overage)",
    ]);
  });

  it("applies the overage to every bottle", () => {
    const result = calculateBatch(melatonin, { bottles: 12, packSizeMl: 100, strength: "10mg/5ml" });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.totalVolumeMl).toBe(1320);
    expect(result.value.finalQuantityMl).toBe(1200);
    // 10 mg × 1320 ÷ 5 = 2640 mg
    expect(quantityText(result.value.lines[0])).toBe("2.640 g");
  });

  it("rounds only the value shown, and says so in the working", () => {
    const formula: FormulaDefinition = {
      ...melatonin,
      ingredients: [ingredient({ name: "Sodium citrate dihydrate BP", amount: 0.197, amountUnit: "g", displayUnit: "g", decimals: 2 })],
    };
    const result = calculateBatch(formula, { bottles: 1, packSizeMl: 150, strength: null });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.lines[0].value).toBeCloseTo(0.3152, 10);
    expect(result.value.lines[0].text).toBe("0.32");
    expect(result.value.lines[0].working).toBe("Sodium citrate dihydrate BP: 0.197 g × 160 ml ÷ 100 ml = 0.3152 g, rounded to 0.32 g");
  });

  it("uses a fixed amount as it is, and a formula's own per-dose amount", () => {
    const formula: FormulaDefinition = {
      ...melatonin,
      strength: "5mg/5ml",
      ingredients: [
        ingredient({ name: "Fixed", basis: "FIXED", amount: 2, amountUnit: "g", displayUnit: "g" }),
        ingredient({ name: "API", basis: "PER_DOSE", amount: 250, amountUnit: "mcg", doseVolumeMl: 5, displayUnit: "mg", decimals: 2 }),
      ],
    };
    const result = calculateBatch(formula, { bottles: 2, packSizeMl: 50, strength: "anything" });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.lines.map(quantityText)).toEqual(["2.000 g", "6.00 mg"]);
    expect(result.value.lines[0].working).toBe("Fixed: fixed amount, 2 g");
    expect(result.value.lines[1].working).toBe("API: 250 mcg × 120 ml ÷ 5 ml = 6000 mcg = 6.00 mg");
  });

  it("refuses zero, negative and part bottles, and a strength it can't read", () => {
    const run = (bottles: number, packSizeMl: number, strength = "5mg/5ml") =>
      calculateBatch(melatonin, { bottles, packSizeMl, strength });
    expect(run(0, 150).ok).toBe(false);
    expect(run(-1, 150).ok).toBe(false);
    expect(run(1.5, 150).ok).toBe(false);
    expect(run(1, 0).ok).toBe(false);
    expect(run(1, -150).ok).toBe(false);
    expect(run(1, Number.NaN).ok).toBe(false);
    const unreadable = run(1, 150, "5mg");
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) expect(unreadable.error).toMatch(/isn't an amount in a volume/);
  });

  it("refuses volumes that leave nothing to make up", () => {
    const formula: FormulaDefinition = {
      ...melatonin,
      ingredients: [ingredient({ amount: 100 }), ingredient({ id: "d", basis: "TO_VOLUME", amount: null })],
    };
    expect(calculateBatch(formula, { bottles: 1, packSizeMl: 150, strength: null }).ok).toBe(false);
  });
});

describe("parseDoseStrength", () => {
  it("reads an amount in a volume", () => {
    expect(parseDoseStrength("5mg/5ml")).toEqual({ amount: 5, unit: "mg", volumeMl: 5 });
    expect(parseDoseStrength("5 mg in 5 ml")).toEqual({ amount: 5, unit: "mg", volumeMl: 5 });
    expect(parseDoseStrength("1mg/ml")).toEqual({ amount: 1, unit: "mg", volumeMl: 1 });
    expect(parseDoseStrength("250µg/5ml")).toEqual({ amount: 250, unit: "mcg", volumeMl: 5 });
    expect(parseDoseStrength("500mg")).toBeNull();
    expect(parseDoseStrength("0mg/5ml")).toBeNull();
    expect(parseDoseStrength(null)).toBeNull();
  });
});

describe("roundForDisplay", () => {
  it("rounds half away from zero without float slips", () => {
    expect(roundForDisplay(1.0005, 3)).toBe("1.001");
    expect(roundForDisplay(0.16, 3)).toBe("0.160");
    expect(roundForDisplay(12.85, 1)).toBe("12.9");
  });
});

describe("checkFormula", () => {
  const valid = {
    medicineName: " Melatonin ",
    dosageForm: "SOLUTION",
    strength: "",
    overageMl: "10",
    ingredients: [
      { id: "api", name: "Melatonin BP", basis: "PER_DOSE", amount: "", amountUnit: "mg", displayUnit: "g", decimals: "" },
      { id: "d", name: "Diluent", basis: "TO_VOLUME", amountUnit: "g", displayUnit: "g", amount: "5" },
    ],
  };

  it("tidies a valid formula", () => {
    const result = checkFormula(valid);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.medicineName).toBe("Melatonin");
    expect(result.value.strength).toBeNull();
    expect(result.value.overageMl).toBe(10);
    expect(result.value.ingredients[0]).toMatchObject({ amount: null, doseVolumeMl: null, decimals: null });
    // Made up to volume is always ml, with no amount.
    expect(result.value.ingredients[1]).toMatchObject({ amount: null, amountUnit: "ml", displayUnit: "ml" });
  });

  it("refuses zero or negative amounts and impossible units", () => {
    const withIngredient = (patch: Record<string, unknown>) => ({
      ...valid,
      ingredients: [{ id: "a", name: "A", basis: "PER_100ML", amount: 1, amountUnit: "ml", displayUnit: "ml", ...patch }],
    });
    expect(checkFormula(withIngredient({ amount: 0 })).ok).toBe(false);
    expect(checkFormula(withIngredient({ amount: -2 })).ok).toBe(false);
    expect(checkFormula(withIngredient({ amount: "" })).ok).toBe(false);
    expect(checkFormula(withIngredient({ displayUnit: "g" })).ok).toBe(false);
    expect(checkFormula(withIngredient({ decimals: 1.5 })).ok).toBe(false);
    expect(checkFormula(withIngredient({ basis: "PER_DOSE", amount: 5, amountUnit: "mg", displayUnit: "g" })).ok).toBe(false);
    expect(checkFormula(withIngredient({ basis: "PER_DOSE", amount: 5, amountUnit: "mg", displayUnit: "g", doseVolumeMl: 0 })).ok).toBe(false);
    expect(checkFormula({ ...valid, overageMl: -1 }).ok).toBe(false);
    expect(checkFormula({ ...valid, ingredients: [] }).ok).toBe(false);
    expect(
      checkFormula({ ...valid, ingredients: [valid.ingredients[1], { ...valid.ingredients[1], id: "e" }] }).ok,
    ).toBe(false);
  });
});
