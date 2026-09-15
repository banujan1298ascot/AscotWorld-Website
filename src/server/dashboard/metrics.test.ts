import { describe, expect, it } from "vitest";
import { buildThroughputSeries, computeRatePct, formatBatchesCsv } from "./metrics";

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
