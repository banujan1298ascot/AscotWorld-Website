import { describe, expect, it } from "vitest";
import { composeProductName, formatPack, parseProductName } from "./products";

describe("composeProductName", () => {
  it("builds the full name from name, strength and type", () => {
    expect(composeProductName({ medicineName: "Paracetamol", strength: "500mg", dosageForm: "TABLETS" })).toBe(
      "Paracetamol 500mg Tablets",
    );
    expect(composeProductName({ medicineName: " Omeprazole ", strength: " 2mg/ml ", dosageForm: "SUSPENSION" })).toBe(
      "Omeprazole 2mg/ml Suspension",
    );
  });

  it("puts a bracketed note such as (Vet) at the very end", () => {
    expect(composeProductName({ medicineName: "Gabapentin (Vet)", strength: "50mg/ml", dosageForm: "SOLUTION" })).toBe(
      "Gabapentin 50mg/ml Solution (Vet)",
    );
  });

  it("leaves out what isn't given, and adds no word for Other", () => {
    expect(composeProductName({ medicineName: "Emollient", dosageForm: "CREAM" })).toBe("Emollient Cream");
    expect(composeProductName({ medicineName: "Zinc paste", strength: "15%", dosageForm: "OTHER" })).toBe("Zinc paste 15%");
    expect(composeProductName({ medicineName: "  ", strength: "5mg" })).toBeNull();
  });
});

describe("parseProductName", () => {
  it("splits a simple name", () => {
    expect(parseProductName("Paracetamol 500mg Tablets")).toEqual({
      medicineName: "Paracetamol",
      strength: "500mg",
      dosageForm: "TABLETS",
    });
  });

  it("handles per-volume strengths and words between strength and type", () => {
    expect(parseProductName("Omeprazole 2mg/ml Oral Suspension")).toEqual({
      medicineName: "Omeprazole",
      strength: "2mg/ml",
      dosageForm: "SUSPENSION",
    });
    expect(parseProductName("Clonidine 50mcg/5ml Oral Solution")).toEqual({
      medicineName: "Clonidine",
      strength: "50mcg/5ml",
      dosageForm: "SOLUTION",
    });
  });

  it("keeps a bracketed note such as (Vet) on the name", () => {
    expect(parseProductName("Meloxicam 1.5mg/ml Oral Suspension (Vet)")).toEqual({
      medicineName: "Meloxicam (Vet)",
      strength: "1.5mg/ml",
      dosageForm: "SUSPENSION",
    });
  });

  it("copes with percentages and names without a strength", () => {
    expect(parseProductName("Hydrocortisone 1% Cream")).toEqual({
      medicineName: "Hydrocortisone",
      strength: "1%",
      dosageForm: "CREAM",
    });
    expect(parseProductName("Chlorhexidine 0.2% Mouthwash")).toEqual({
      medicineName: "Chlorhexidine",
      strength: "0.2%",
      dosageForm: null,
    });
    expect(parseProductName("Aqueous Cream")).toEqual({ medicineName: "Aqueous", strength: null, dosageForm: "CREAM" });
  });
});

describe("formatPack", () => {
  it("formats a size with its unit", () => {
    expect(formatPack(28, "tablets")).toBe("28 tablets");
    expect(formatPack("100", "ml")).toBe("100 ml");
    expect(formatPack(null, "g")).toBeNull();
  });
});
