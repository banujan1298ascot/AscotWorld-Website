import { describe, expect, it } from "vitest";
import { batchTypeResetsYearly, formatBatchLabel, yearSuffixFor, type BatchType } from "./numbering";

describe("batchTypeResetsYearly", () => {
  it("is true only for M", () => {
    expect(batchTypeResetsYearly("M")).toBe(true);
    for (const type of ["A", "B", "C", "D"] as BatchType[]) {
      expect(batchTypeResetsYearly(type)).toBe(false);
    }
  });
});

describe("yearSuffixFor", () => {
  it("is null for non-resetting types regardless of date", () => {
    expect(yearSuffixFor("A", new Date("2026-01-01T00:00:00Z"))).toBeNull();
    expect(yearSuffixFor("D", new Date("2099-12-31T23:59:59Z"))).toBeNull();
  });

  it("is the two-digit calendar year (UTC) for M", () => {
    expect(yearSuffixFor("M", new Date("2026-06-15T00:00:00Z"))).toBe(26);
    expect(yearSuffixFor("M", new Date("2031-01-01T00:00:00Z"))).toBe(31);
  });

  it("wraps to 00 at the turn of the century", () => {
    expect(yearSuffixFor("M", new Date("2100-03-01T00:00:00Z"))).toBe(0);
  });
});

describe("formatBatchLabel", () => {
  const jan2026 = new Date("2026-01-15T00:00:00Z");

  it("formats non-resetting types as TYPE-NNNN", () => {
    expect(formatBatchLabel("A", 1, jan2026)).toBe("A-0001");
    expect(formatBatchLabel("B", 42, jan2026)).toBe("B-0042");
    expect(formatBatchLabel("D", 999, jan2026)).toBe("D-0999");
  });

  it("formats M as MYY-NNNN", () => {
    expect(formatBatchLabel("M", 1, jan2026)).toBe("M26-0001");
    expect(formatBatchLabel("M", 8, new Date("2027-11-01T00:00:00Z"))).toBe("M27-0008");
  });

  it("pads to 4 digits but never truncates a longer sequence", () => {
    expect(formatBatchLabel("A", 5, jan2026)).toBe("A-0005");
    expect(formatBatchLabel("A", 12345, jan2026)).toBe("A-12345");
  });

  it("pads the year to 2 digits even when the mod-100 value is small", () => {
    expect(formatBatchLabel("M", 1, new Date("2100-01-01T00:00:00Z"))).toBe("M00-0001");
    expect(formatBatchLabel("M", 1, new Date("2105-01-01T00:00:00Z"))).toBe("M05-0001");
  });
});
