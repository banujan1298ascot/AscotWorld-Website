import { describe, expect, it } from "vitest";
import {
  buildOutputSeries,
  buildThroughputSeries,
  computeRatePct,
  formatBatchesCsv,
  outputWindow,
  percentChange,
  productSearchPatterns,
  timingConfidence,
} from "./metrics";

describe("buildThroughputSeries", () => {
  const today = new Date("2026-03-10T12:00:00Z");

  it("produces exactly `days` entries ending today, oldest first", () => {
    const series = buildThroughputSeries(3, [], [], [], today);
    expect(series.map((d) => d.date)).toEqual(["2026-03-08", "2026-03-09", "2026-03-10"]);
  });

  it("fills days with no activity as explicit zeros", () => {
    const series = buildThroughputSeries(3, [], [], [], today);
    series.forEach((d) => expect(d).toMatchObject({ confirmed: 0, completed: 0, failed: 0 }));
  });

  it("places each count on its own day, independently per series", () => {
    const series = buildThroughputSeries(
      3,
      [{ day: "2026-03-09", count: 5 }],
      [{ day: "2026-03-08", count: 2 }],
      [{ day: "2026-03-10", count: 1 }],
      today,
    );
    expect(series).toEqual([
      { date: "2026-03-08", confirmed: 0, completed: 2, failed: 0 },
      { date: "2026-03-09", confirmed: 5, completed: 0, failed: 0 },
      { date: "2026-03-10", confirmed: 0, completed: 0, failed: 1 },
    ]);
  });

  it("ignores rows for days outside the requested window", () => {
    const series = buildThroughputSeries(2, [{ day: "2026-01-01", count: 99 }], [], [], today);
    expect(series.reduce((sum, d) => sum + d.confirmed, 0)).toBe(0);
  });
});

describe("computeRatePct", () => {
  it("returns null when there is no sample (avoids a misleading 0%)", () => {
    expect(computeRatePct(0, 0)).toBeNull();
  });

  it("computes a percentage to one decimal place", () => {
    expect(computeRatePct(1, 3)).toBe(33.3);
    expect(computeRatePct(1, 4)).toBe(25);
    expect(computeRatePct(0, 10)).toBe(0);
    expect(computeRatePct(10, 10)).toBe(100);
  });
});

describe("formatBatchesCsv", () => {
  it("writes the header row even with no data", () => {
    expect(formatBatchesCsv([])).toBe(
      "Batch number,Type,Department,Product,Quantity,Unit,Status,Current stage,Created at,Confirmed at,Created by,Confirmed by",
    );
  });

  it("renders a row, substituting empty string for null fields", () => {
    const csv = formatBatchesCsv([
      {
        batchNumber: "A-0001",
        batchType: "A",
        departmentName: "Bespoke",
        productName: "Paracetamol",
        quantity: "100",
        unit: "bottles",
        status: "IN_PROGRESS",
        currentStageName: "Order/Calculation Check",
        createdAt: "2026-03-01T09:00:00.000Z",
        confirmedAt: "2026-03-01T09:05:00.000Z",
        createdByName: "Daniel Okafor",
        confirmedByName: null,
      },
    ]);
    const rows = csv.split("\r\n");
    expect(rows[1]).toBe(
      "A-0001,A,Bespoke,Paracetamol,100,bottles,IN_PROGRESS,Order/Calculation Check,2026-03-01T09:00:00.000Z,2026-03-01T09:05:00.000Z,Daniel Okafor,",
    );
  });

  it("quotes fields containing a comma and escapes embedded quotes", () => {
    const csv = formatBatchesCsv([
      {
        batchNumber: "A-0002",
        batchType: "A",
        departmentName: "Bespoke",
        productName: 'Widget, 10" model',
        quantity: null,
        unit: null,
        status: "DRAFT",
        currentStageName: null,
        createdAt: "2026-03-01T09:00:00.000Z",
        confirmedAt: null,
        createdByName: "Someone",
        confirmedByName: null,
      },
    ]);
    const rows = csv.split("\r\n");
    expect(rows[1]).toContain('"Widget, 10"" model"');
  });

  it("uses CRLF row endings", () => {
    const csv = formatBatchesCsv([
      {
        batchNumber: "A-0001",
        batchType: "A",
        departmentName: "Bespoke",
        productName: null,
        quantity: null,
        unit: null,
        status: "DRAFT",
        currentStageName: null,
        createdAt: "2026-03-01T09:00:00.000Z",
        confirmedAt: null,
        createdByName: "Someone",
        confirmedByName: null,
      },
    ]);
    expect(csv).toContain("\r\n");
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("outputWindow", () => {
  const today = new Date("2026-03-10T15:00:00Z");

  it("covers the last 7 days a day at a time for a week", () => {
    const w = outputWindow("week", today);
    expect(w.bucket).toBe("day");
    expect(w.keys).toHaveLength(7);
    expect(w.keys[0]).toBe("2026-03-04");
    expect(w.keys[6]).toBe("2026-03-10");
    expect(w.start.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(w.previousStart.toISOString()).toBe("2026-02-25T00:00:00.000Z");
  });

  it("covers the last 30 days for a month", () => {
    const w = outputWindow("month", today);
    expect(w.keys).toHaveLength(30);
    expect(w.keys[0]).toBe("2026-02-09");
    expect(w.keys[29]).toBe("2026-03-10");
  });

  it("covers the last 12 calendar months, crossing the year, for a year", () => {
    const w = outputWindow("year", today);
    expect(w.bucket).toBe("month");
    expect(w.keys).toEqual([
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ]);
    expect(w.start.toISOString()).toBe("2025-04-01T00:00:00.000Z");
    expect(w.previousStart.toISOString()).toBe("2024-04-01T00:00:00.000Z");
  });
});

describe("buildOutputSeries", () => {
  it("puts a point on every bucket, zero where nothing happened", () => {
    const series = buildOutputSeries(
      ["2026-03-08", "2026-03-09", "2026-03-10"],
      [{ bucket: "2026-03-09", count: 4 }],
      [{ bucket: "2026-03-08", count: 2 }],
    );
    expect(series).toEqual([
      { key: "2026-03-08", made: 0, started: 2 },
      { key: "2026-03-09", made: 4, started: 0 },
      { key: "2026-03-10", made: 0, started: 0 },
    ]);
  });

  it("ignores counts outside the window", () => {
    const series = buildOutputSeries(["2026-03"], [{ bucket: "2025-01", count: 9 }], []);
    expect(series).toEqual([{ key: "2026-03", made: 0, started: 0 }]);
  });
});

describe("percentChange", () => {
  it("rounds to one decimal place", () => {
    expect(percentChange(12, 9)).toBe(33.3);
    expect(percentChange(6, 8)).toBe(-25);
  });

  it("has no percentage when the previous period made nothing", () => {
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("productSearchPatterns", () => {
  it("makes one contains-pattern per word, lower-cased and de-duplicated", () => {
    expect(productSearchPatterns("  Amox  500MG amox ")).toEqual(["%amox%", "%500mg%"]);
  });

  it("returns nothing for a blank search", () => {
    expect(productSearchPatterns("   ")).toEqual([]);
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(productSearchPatterns("0.9% nasal_spray")).toEqual(["%0.9\\%%", "%nasal\\_spray%"]);
    expect(productSearchPatterns("a\\b")).toEqual(["%a\\\\b%"]);
  });

  it("caps the number of words", () => {
    expect(productSearchPatterns("a b c d e f g h")).toHaveLength(6);
  });
});

describe("timingConfidence", () => {
  it("grows with the number of finished batches", () => {
    expect(timingConfidence(0)).toBe("none");
    expect(timingConfidence(1)).toBe("early");
    expect(timingConfidence(2)).toBe("early");
    expect(timingConfidence(3)).toBe("building");
    expect(timingConfidence(9)).toBe("building");
    expect(timingConfidence(10)).toBe("reliable");
  });
});
