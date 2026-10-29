import { describe, expect, it } from "vitest";
import { batchProductOf, pickWorksheet, worksheetMatchScore, type BatchProduct } from "./matching";

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
    ).toBe(2);
    expect(
      worksheetMatchScore(
        { medicineName: "Levothyroxine", strength: "100 mcg", dosageForm: "CAPSULES", packSize: 28 },
        "levothyroxine 100mcg Levothyroxine 100mcg Capsules Version 2 (0361).pdf",
      ),
    ).toBe(1);
  });

  it("needs the strength, the type and every word of the name", () => {
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 10mg TABLETS")).toBeNull();
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 120mg TABLETS")).toBeNull();
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 20mg CAPSULES")).toBeNull();
    expect(worksheetMatchScore({ ...diaminopyridine, medicineName: "Gabapentin (Vet)" }, "Gabapentin 20mg tablets")).toBeNull();
  });

  it("refuses a worksheet for a different pack count", () => {
    expect(worksheetMatchScore(diaminopyridine, "3,4-DIAMINOPYRIDINE 20mg TABLETS 28s")).toBeNull();
    expect(worksheetMatchScore({ ...diaminopyridine, packSize: null }, "3,4-DIAMINOPYRIDINE 20mg TABLETS 28s")).toBe(1);
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
