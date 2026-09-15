import { describe, expect, it } from "vitest";
import { diffFields } from "./audit";

describe("diffFields", () => {
  it("returns nothing when nothing changed", () => {
    expect(diffFields({ productName: "Paracetamol" }, { productName: "Paracetamol" })).toEqual([]);
  });

  it("reports only the fields that actually changed", () => {
    const before = { productName: "Paracetamol", quantity: 100, unit: "bottles" };
    const after = { productName: "Paracetamol", quantity: 150, unit: "bottles" };
    expect(diffFields(before, after)).toEqual([{ field: "quantity", oldValue: "100", newValue: "150" }]);
  });

  it("renders null/undefined as null, not the string 'null' or 'undefined'", () => {
    const changes = diffFields({ notes: undefined }, { notes: "now set" });
    expect(changes).toEqual([{ field: "notes", oldValue: null, newValue: "now set" }]);
  });

  it("treats a field appearing only on one side as a change", () => {
    expect(diffFields({}, { batchNumber: "A-0001" })).toEqual([
      { field: "batchNumber", oldValue: null, newValue: "A-0001" },
    ]);
  });

  it("serializes non-string values so they're comparable and readable", () => {
    const before = { plannedManufactureDate: new Date("2026-01-01T00:00:00.000Z") };
    const after = { plannedManufactureDate: new Date("2026-02-01T00:00:00.000Z") };
    expect(diffFields(before, after)).toEqual([
      { field: "plannedManufactureDate", oldValue: "2026-01-01T00:00:00.000Z", newValue: "2026-02-01T00:00:00.000Z" },
    ]);
  });

  it("orders multiple changes alphabetically by field for a deterministic trail", () => {
    const before = { unit: "bottles", quantity: 100 };
    const after = { unit: "boxes", quantity: 200 };
    expect(diffFields(before, after).map((c) => c.field)).toEqual(["quantity", "unit"]);
  });
});
