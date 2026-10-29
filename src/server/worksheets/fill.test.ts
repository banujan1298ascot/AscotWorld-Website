import { describe, expect, it } from "vitest";
import { planFill, type TextItem } from "./fill";

// Positions as pdf.js reports them for the two kinds of worksheet in use.
const t = (str: string, x: number, y: number, width: number, height: number): TextItem => ({ str, x, y, width, height });
const measure = (text: string, size: number) => text.length * size * 0.55;

const values = {
  batchNumber: "A-0301",
  manufactureDate: "2026-11-05",
  expiryDate: "2027-05-31",
  quantity: "165",
  packSize: "100",
};

/** 3,4-Diaminopyridine stock packdown, page 1. */
const packdown = [
  t("_____________/", 417.8, 776.2, 74.6, 11),
  t("M", 495.2, 776.2, 15.1, 16),
  t("____-______", 510.3, 776.2, 58.7, 11),
  t("BATCH No.", 286.3, 774, 115.9, 22),
  t("_______", 133.6, 594.1, 49, 14),
  t("units of", 186.1, 594.1, 42.4, 14),
  t("Batch size", 20, 586.1, 49.6, 12),
  t("1", 133.6, 576.6, 7, 14),
  t("Date manufactured", 20, 559.8, 91.5, 12),
  t(".", 175, 558, 2.8, 11),
  t(".", 216.1, 558, 2.8, 11),
  t(".", 306.9, 558, 2.8, 11),
  t("Expiry date", 20, 541.8, 55.6, 12),
  t(".", 175, 540, 2.8, 11),
  t(".", 216.1, 540, 2.8, 11),
  t(".", 306.9, 540, 2.8, 11),
  t("Shelf life", 20, 523.8, 44.3, 12),
  t("The manufacturer’s expiry date.", 133.6, 522.9, 179.7, 14),
];

/** Levothyroxine capsules, page 1: a drawn box for the batch number, and
 *  "packs x pack size" blanks for the quantity. */
const capsules = [
  t("MASTER TEMPLATE 4", 404.5, 796.4, 65.3, 6),
  t("BATCH No.", 301.1, 774, 115.9, 22),
  t("____x________capsules", 149.4, 617.7, 108.8, 11),
  t("____x________capsules", 300.6, 617.7, 108.8, 11),
  t("Quantity", 20, 617.4, 42, 12),
  t("Date manufactured", 20, 599.4, 91.5, 12),
  t(".", 175, 597.6, 2.8, 11),
  t(".", 216.1, 597.6, 2.8, 11),
  t(".", 306.9, 597.6, 2.8, 11),
  t("12", 133.6, 562.5, 14.1, 14),
];

describe("planFill", () => {
  it("fills the underscore blanks and splits dates across the dots", () => {
    const { draws, placed } = planFill([packdown], values, measure);
    expect(placed).toEqual({ batchNumber: 1, quantity: 1, packSize: 0, manufactureDate: 1, expiryDate: 1 });

    // Centred on its blank ("_____________/" from x 417.8), just above the line.
    const batchNo = draws.find((d) => d.text === "A-0301")!;
    expect(batchNo.x).toBeGreaterThan(419.8);
    expect(batchNo.x + measure("A-0301", batchNo.size)).toBeLessThan(492.4);
    expect(batchNo.y).toBeCloseTo(777.7, 0);

    const quantity = draws.find((d) => d.text === "165")!;
    expect(quantity.x).toBeGreaterThan(135.6);
    expect(quantity.x + measure("165", quantity.size)).toBeLessThan(182.6);

    // Day, month and year each sit between their dots, on the dots' line.
    const made = draws.filter((d) => d.y === 559);
    expect(made.map((d) => d.text)).toEqual(["05", "11", "2026"]);
    expect(made[0].x).toBeGreaterThan(133.6);
    expect(made[0].x).toBeLessThan(175);
    expect(made[1].x).toBeGreaterThan(175);
    expect(made[1].x).toBeLessThan(216.1);
    expect(made[2].x).toBeGreaterThan(216.1);
    expect(made[2].x).toBeLessThan(306.9);
    expect(draws.filter((d) => d.y === 541).map((d) => d.text)).toEqual(["31", "05", "2027"]);
  });

  it("writes beside a batch-number box and fills packs × pack size", () => {
    const { draws, placed } = planFill([capsules], values, measure);
    expect(placed.batchNumber).toBe(1);
    expect(draws.find((d) => d.text === "A-0301")!.x).toBeGreaterThan(417);
    expect(placed.quantity).toBe(1);
    expect(placed.packSize).toBe(1);
    const [packs, size] = draws.filter((d) => d.text === "165" || d.text === "100");
    expect(packs.text).toBe("165");
    expect(size.text).toBe("100");
    expect(size.x).toBeGreaterThan(packs.x);
    expect(placed.manufactureDate).toBe(1);
  });

  it("fills the batch number on every page, and leaves out what the batch doesn't have", () => {
    const { placed, draws } = planFill([packdown, packdown], { ...values, expiryDate: null, quantity: null }, measure);
    expect(placed.batchNumber).toBe(2);
    expect(placed.expiryDate).toBe(0);
    expect(placed.quantity).toBe(0);
    expect(draws.some((d) => d.text === "165")).toBe(false);
  });

  it("doesn't write over text already printed beside a label", () => {
    const { draws } = planFill([[t("Batch size", 20, 586, 50, 12), t("165 units", 133.6, 586, 50, 12)]], values, measure);
    expect(draws).toEqual([]);
  });
});
