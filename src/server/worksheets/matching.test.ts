import { describe, expect, it } from "vitest";
import { batchProductOf, pickFormula, pickWorksheet, sameFormulaProduct, worksheetMatchScore, type BatchProduct } from "./matching";

const diaminopyridine: BatchProduct = { medicineName: "3,4-Diaminopyridine", strength: "20mg", dosageForm: "TABLETS", packSize: 100 };
const sheet = (productName: string, fileName: string, uploadedAt = "2026-10-01") => ({
  productName,
  fileName,
  reference: null,
  uploadedAt: new Date(uploadedAt),
});

describe("worksheetMatchScore", () => {
  it("matches on name, strength and type across the product and file names", () => {
    expect(
      worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 3,4-DIAMINOPYRIDINE 20mg TABLETS 100s STOCK PACKDOWN Version 8 (0659).pdf"),
    ).toBe(4);
    expect(
      worksheetMatchScore(
        { medicineName: "Levothyroxine", strength: "100 mcg", dosageForm: "CAPSULES", packSize: 28 },
        "levothyroxine 100mcg Levothyroxine 100mcg Capsules Version 2 (0361).pdf",
      ),
    ).toBe(3);
  });

  it("needs the strength, the type and every word of the name", () => {
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 10mg TABLETS")).toBeNull();
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 120mg TABLETS")).toBeNull();
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 20mg CAPSULES")).toBeNull();
    expect(worksheetMatchScore({ ...diaminopyridine, medicineName: "Gabapentin (Vet)" }, "Gabapentin 20mg tablets")).toBeNull();
  });

  it("refuses a worksheet for a different pack count", () => {
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 20mg TABLETS 28s")).toBeNull();
    expect(worksheetMatchScore({ ...diaminopyridine, packSize: null }, "3,4-DIAMINOPYRIDINE 20mg TABLETS 28s")).toBe(3);
  });
});

describe("worksheets for every strength", () => {
  const melatonin: BatchProduct = { medicineName: "Melatonin", strength: "5mg/5ml", dosageForm: "SOLUTION", packSize: 150 };

  it("matches a worksheet that names no strength, below one naming the batch's", () => {
    expect(worksheetMatchScore(melatonin, "Melatonin Oral Solution Melatonin Oral Solution Alcohol Free 0232 v.03")).toBe(1);
    expect(worksheetMatchScore(melatonin, "Melatonin 5mg/5ml Oral Solution")).toBe(3);
    expect(worksheetMatchScore(melatonin, "Melatonin 1mg/ml Oral Solution")).toBeNull();
    const general = sheet("Melatonin Oral Solution", "Melatonin Oral Solution Alcohol Free.pdf", "2026-10-20");
    const exact = sheet("Melatonin 5mg/5ml Oral Solution", "Melatonin 5mg-5ml.pdf", "2026-01-01");
    expect(pickWorksheet(melatonin, [general, exact])).toBe(exact);
    expect(pickWorksheet(melatonin, [general])).toBe(general);
  });
});

describe("pickFormula", () => {
  const formula = (strength: string | null, createdAt = "2026-10-01", medicineName = "Melatonin") => ({
    medicineName,
    dosageForm: "SOLUTION" as const,
    strength,
    createdAt: new Date(createdAt),
  });
  const batch: BatchProduct = { medicineName: "melatonin", strength: "5 mg/5ml", dosageForm: "SOLUTION", packSize: 150 };

  it("prefers the batch's own strength, then one for every strength, then the newest", () => {
    const any = formula(null);
    const exact = formula("5mg/5ml", "2026-01-01");
    const other = formula("1mg/ml", "2026-12-01");
    expect(pickFormula(batch, [any, exact, other])).toBe(exact);
    expect(pickFormula(batch, [any, other])).toBe(any);
    const newer = formula(null, "2026-10-20");
    expect(pickFormula(batch, [any, newer])).toBe(newer);
    expect(pickFormula({ ...batch, dosageForm: "SUSPENSION" }, [any])).toBeNull();
    expect(pickFormula(batch, [formula(null, "2026-10-01", "Melatonin Forte")])).toBeNull();
  });

  it("treats the same name, type and strength as the same product", () => {
    expect(sameFormulaProduct(formula("5 mg/5ml"), { ...formula("5mg/5ml"), medicineName: "MELATONIN" })).toBe(true);
    expect(sameFormulaProduct(formula(null), formula("5mg/5ml"))).toBe(false);
  });
});

describe("pickWorksheet", () => {
  it("prefers a pack-count match, then the newest", () => {
    const generic = sheet("3,4-Diaminopyridine", "3,4-Diaminopyridine 20mg tablets.pdf", "2026-10-05");
    const exact = sheet("3,4-Diaminopyridine", "3,4-Diaminopyridine 20mg tablets 100s.pdf", "2026-09-01");
    expect(pickWorksheet(diaminopyridine, [generic, exact])).toBe(exact);
    const newer = sheet("3,4-Diaminopyridine", "3,4-Diaminopyridine 20mg tablets.pdf", "2026-10-20");
    expect(pickWorksheet({ ...diaminopyridine, packSize: null }, [generic, newer])).toBe(newer);
    expect(pickWorksheet(diaminopyridine, [sheet("Paracetamol", "Paracetamol 500mg tablets.pdf")])).toBeNull();
  });
});

describe("batchProductOf", () => {
  it("uses the entered parts, or splits an older full name", () => {
    expect(
      batchProductOf({ productName: "Omeprazole 2mg/ml Oral Suspension", medicineName: null, strength: null, dosageForm: null, packSize: null }),
    ).toEqual({ medicineName: "Omeprazole", strength: "2mg/ml", dosageForm: "SUSPENSION", packSize: null });
  });
});
