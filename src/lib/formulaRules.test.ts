import { describe, expect, it } from "vitest";
import {
  calculateBatch,
  checkFormula,
  parseDoseStrength,
  pickOverage,
  quantityText,
  roundForDisplay,
  type FormulaDefinition,
  type FormulaIngredient,
  type OverageRule,
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
  baseUnit: "ml",
  // 10 ml for up to 5 bottles of any size, 20 ml from 6; 300 ml bottles
  // get their own rows.
  overages: [
    { packSize: null, fromPacks: 1, toPacks: 5, amount: 10 },
    { packSize: null, fromPacks: 6, toPacks: null, amount: 20 },
    { packSize: 300, fromPacks: 1, toPacks: null, amount: 25 },
  ],
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
    const result = calculateBatch(melatonin, { packs: 1, packSize: 150, strength: "5mg/5ml" });
    if (!result.ok) throw new Error(result.error);
    const calc = result.value;
    expect(calc.total).toBe(160);
    expect(calc.finalQuantity).toBe(150);
    expect(calc.lines.map(quantityText)).toEqual(["0.160 g", "12.8 ml", "0.8 ml", "to 160 ml"]);
    expect(calc.lines[2].optional).toBe(true);
    expect(calc.working).toEqual([
      "Total = 1 bottle × 150 ml + 10 ml overage (for any pack size, 1–5 bottles) = 160 ml",
      "Melatonin BP: 5 mg × 160 ml ÷ 5 ml = 160 mg = 0.160 g",
      "Propylene glycol BP: 8 ml × 160 ml ÷ 100 ml = 12.8 ml",
      "Flavour (optional): 0.5 ml × 160 ml ÷ 100 ml = 0.8 ml",
      "Melatonin AF, FF diluent: make up to 160 ml",
      "Final product quantity = 1 × 150 ml = 150 ml (without the overage)",
    ]);
  });

  it("takes the overage from the table, once for the whole batch", () => {
    const result = calculateBatch(melatonin, { packs: 12, packSize: 100, strength: "10mg/5ml" });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.overage).toBe(20);
    expect(result.value.total).toBe(1220);
    expect(result.value.finalQuantity).toBe(1200);
    // 10 mg × 1220 ÷ 5 = 2440 mg
    expect(quantityText(result.value.lines[0])).toBe("2.440 g");

    // A row for the exact pack size wins over "any pack size".
    const big = calculateBatch(melatonin, { packs: 2, packSize: 300, strength: "5mg/5ml" });
    if (!big.ok) throw new Error(big.error);
    expect(big.value.total).toBe(625);
  });

  it("won't guess an overage the table doesn't have", () => {
    const formula: FormulaDefinition = { ...melatonin, overages: [{ packSize: 150, fromPacks: 1, toPacks: 3, amount: 10 }] };
    const result = calculateBatch(formula, { packs: 4, packSize: 150, strength: "5mg/5ml" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no row for 4 × 150 ml/);
  });

  it("makes creams by weight, with a percentage strength", () => {
    const cream: FormulaDefinition = {
      medicineName: "Hydrocortisone",
      dosageForm: "CREAM",
      strength: null,
      baseUnit: "g",
      overages: [{ packSize: null, fromPacks: 1, toPacks: null, amount: 15 }],
      notes: null,
      ingredients: [
        ingredient({ id: "api", name: "Hydrocortisone BP", basis: "PER_DOSE", amount: null, amountUnit: "g", displayUnit: "g" }),
        ingredient({ id: "wax", name: "Emulsifying wax", amount: 9, amountUnit: "g", displayUnit: "g" }),
        ingredient({ id: "base", name: "Aqueous cream", basis: "TO_VOLUME", amount: null, amountUnit: "g", displayUnit: "g" }),
      ],
    };
    const result = calculateBatch(cream, { packs: 4, packSize: 50, strength: "1%" });
    if (!result.ok) throw new Error(result.error);
    // 4 × 50 g + 15 g = 215 g; 1% of 215 g = 2.15 g; 9 g per 100 g = 19.35 g
    expect(result.value.lines.map(quantityText)).toEqual(["2.150 g", "19.350 g", "to 215 g"]);
    expect(result.value.working[0]).toBe("Total = 4 packs × 50 g + 15 g overage (for any pack size, 1 or more packs) = 215 g");
    expect(calculateBatch(cream, { packs: 4, packSize: 50, strength: "5mg/5ml" }).ok).toBe(false);
  });

  it("rounds only the value shown, and says so in the working", () => {
    const formula: FormulaDefinition = {
      ...melatonin,
      ingredients: [ingredient({ name: "Sodium citrate dihydrate BP", amount: 0.197, amountUnit: "g", displayUnit: "g", decimals: 2 })],
    };
    const result = calculateBatch(formula, { packs: 1, packSize: 150, strength: null });
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
    const result = calculateBatch(formula, { packs: 2, packSize: 50, strength: "anything" });
    if (!result.ok) throw new Error(result.error);
    // 2 × 50 ml + 10 ml = 110 ml
    expect(result.value.lines.map(quantityText)).toEqual(["2.000 g", "5.50 mg"]);
    expect(result.value.lines[0].working).toBe("Fixed: fixed amount, 2 g");
    expect(result.value.lines[1].working).toBe("API: 250 mcg × 110 ml ÷ 5 ml = 5500 mcg = 5.50 mg");
  });

  it("refuses zero, negative and part bottles, and a strength it can't read", () => {
    const run = (packs: number, packSize: number, strength = "5mg/5ml") =>
      calculateBatch(melatonin, { packs, packSize, strength });
    expect(run(0, 150).ok).toBe(false);
    expect(run(-1, 150).ok).toBe(false);
    expect(run(1.5, 150).ok).toBe(false);
    expect(run(1, 0).ok).toBe(false);
    expect(run(1, -150).ok).toBe(false);
    expect(run(1, Number.NaN).ok).toBe(false);
    const unreadable = run(1, 150, "5mg");
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) expect(unreadable.error).toMatch(/isn't an amount in the product/);
  });

  it("refuses volumes that leave nothing to make up", () => {
    const formula: FormulaDefinition = {
      ...melatonin,
      ingredients: [ingredient({ amount: 100 }), ingredient({ id: "d", basis: "TO_VOLUME", amount: null })],
    };
    expect(calculateBatch(formula, { packs: 1, packSize: 150, strength: null }).ok).toBe(false);
  });
});

describe("parseDoseStrength", () => {
  it("reads an amount in a volume", () => {
    expect(parseDoseStrength("5mg/5ml")).toEqual({ amount: 5, unit: "mg", per: 5 });
    expect(parseDoseStrength("5 mg in 5 ml")).toEqual({ amount: 5, unit: "mg", per: 5 });
    expect(parseDoseStrength("1mg/ml")).toEqual({ amount: 1, unit: "mg", per: 1 });
    expect(parseDoseStrength("250µg/5ml")).toEqual({ amount: 250, unit: "mcg", per: 5 });
    expect(parseDoseStrength("20mg/g", "g")).toEqual({ amount: 20, unit: "mg", per: 1 });
    expect(parseDoseStrength("1%", "g")).toEqual({ amount: 1, unit: "g", per: 100 });
    expect(parseDoseStrength("0.5% w/v")).toEqual({ amount: 0.5, unit: "g", per: 100 });
    // Per gram isn't per ml.
    expect(parseDoseStrength("20mg/g")).toBeNull();
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

describe("pickOverage", () => {
  const rules: OverageRule[] = [
    { packSize: null, fromPacks: 1, toPacks: 5, amount: 10 },
    { packSize: 150, fromPacks: 1, toPacks: 2, amount: 12 },
  ];
  it("prefers a row for the exact pack size, and covers ranges inclusively", () => {
    expect(pickOverage(rules, 2, 150)?.amount).toBe(12);
    expect(pickOverage(rules, 3, 150)?.amount).toBe(10);
    expect(pickOverage(rules, 5, 100)?.amount).toBe(10);
    expect(pickOverage(rules, 6, 100)).toBeNull();
  });
});

describe("checkFormula", () => {
  const valid = {
    medicineName: " Melatonin ",
    dosageForm: "SOLUTION",
    strength: "",
    overages: [{ packSize: "", fromPacks: "1", toPacks: "", amount: "10" }],
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
    expect(result.value.baseUnit).toBe("ml");
    expect(result.value.overages).toEqual([{ packSize: null, fromPacks: 1, toPacks: null, amount: 10 }]);
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
    const overage = (rows: Record<string, unknown>[]) => checkFormula({ ...valid, overages: rows });
    expect(overage([]).ok).toBe(false);
    expect(overage([{ fromPacks: 1, amount: -1 }]).ok).toBe(false);
    expect(overage([{ fromPacks: 0, amount: 5 }]).ok).toBe(false);
    expect(overage([{ fromPacks: 3, toPacks: 2, amount: 5 }]).ok).toBe(false);
    expect(overage([{ packSize: 0, fromPacks: 1, amount: 5 }]).ok).toBe(false);
    // Overlapping rows for the same pack size can't both apply.
    expect(overage([{ fromPacks: 1, toPacks: 5, amount: 5 }, { fromPacks: 5, amount: 9 }]).ok).toBe(false);
    expect(overage([{ fromPacks: 1, toPacks: 5, amount: 5 }, { packSize: 150, fromPacks: 5, amount: 9 }]).ok).toBe(true);
    expect(checkFormula({ ...valid, ingredients: [] }).ok).toBe(false);
    expect(
      checkFormula({ ...valid, ingredients: [valid.ingredients[1], { ...valid.ingredients[1], id: "e" }] }).ok,
    ).toBe(false);
  });
});
