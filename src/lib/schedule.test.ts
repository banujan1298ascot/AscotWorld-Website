import { describe, expect, it } from "vitest";
import { layoutWeekBars } from "./schedule";
import type { Batch } from "./types";

/** A week of Monday–Saturday, matching the calendar's own working week. */
const WEEK = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06"];

function makeBatch(overrides: Partial<Batch> & { startDate: string; endDate: string }): Batch {
  return {
    id: overrides.id ?? `batch_${overrides.startDate}_${overrides.endDate}_${Math.random()}`,
    batchNo: overrides.batchNo ?? "AW-00001",
    product: "Test product",
    productLine: "human",
    quantity: 100,
    unit: "bottles",
    status: "scheduled",
    lineId: "line-1",
    roomId: null,
    equipmentId: null,
    operatorIds: [],
    qaOwnerId: null,
    releasedById: null,
    releasedAt: null,
    notes: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("layoutWeekBars", () => {
  it("gives a single-day batch a one-column, unclipped bar", () => {
    const batch = makeBatch({ startDate: "2026-06-03", endDate: "2026-06-03" });
    const [bar] = layoutWeekBars([batch], WEEK);
    expect(bar).toMatchObject({ startIndex: 2, endIndex: 2, clippedStart: false, clippedEnd: false, lane: 0 });
  });

  it("spans a multi-day batch across every day it covers, as one bar", () => {
    const batch = makeBatch({ startDate: "2026-06-02", endDate: "2026-06-05" });
    const bars = layoutWeekBars([batch], WEEK);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ startIndex: 1, endIndex: 4, clippedStart: false, clippedEnd: false });
  });

  it("clips a batch that started before the visible week", () => {
    const batch = makeBatch({ startDate: "2026-05-28", endDate: "2026-06-02" });
    const [bar] = layoutWeekBars([batch], WEEK);
    expect(bar).toMatchObject({ startIndex: 0, endIndex: 1, clippedStart: true, clippedEnd: false });
  });

  it("clips a batch that continues past the visible week", () => {
    const batch = makeBatch({ startDate: "2026-06-05", endDate: "2026-06-12" });
    const [bar] = layoutWeekBars([batch], WEEK);
    expect(bar).toMatchObject({ startIndex: 4, endIndex: 5, clippedStart: false, clippedEnd: true });
  });

  it("clips both edges of a batch that runs the entire week and beyond", () => {
    const batch = makeBatch({ startDate: "2026-05-01", endDate: "2026-07-01" });
    const [bar] = layoutWeekBars([batch], WEEK);
    expect(bar).toMatchObject({ startIndex: 0, endIndex: 5, clippedStart: true, clippedEnd: true });
  });

  it("excludes a batch that doesn't touch the visible week at all", () => {
    const batch = makeBatch({ startDate: "2026-06-10", endDate: "2026-06-12" });
    expect(layoutWeekBars([batch], WEEK)).toHaveLength(0);
  });

  it("gives non-overlapping batches the same lane", () => {
    const first = makeBatch({ batchNo: "AW-00001", startDate: "2026-06-01", endDate: "2026-06-02" });
    const second = makeBatch({ batchNo: "AW-00002", startDate: "2026-06-03", endDate: "2026-06-04" });
    const bars = layoutWeekBars([first, second], WEEK);
    expect(bars.map((b) => b.lane)).toEqual([0, 0]);
  });

  it("puts overlapping batches (a double-booked line) in separate lanes", () => {
    const first = makeBatch({ batchNo: "AW-00001", startDate: "2026-06-02", endDate: "2026-06-04" });
    const second = makeBatch({ batchNo: "AW-00002", startDate: "2026-06-03", endDate: "2026-06-05" });
    const bars = layoutWeekBars([first, second], WEEK);
    const byNo = new Map(bars.map((b) => [b.batch.batchNo, b.lane]));
    expect(byNo.get("AW-00001")).not.toBe(byNo.get("AW-00002"));
  });

  it("reuses a freed lane rather than growing forever", () => {
    // A ends before B starts, then B ends before C starts — B and C can
    // both reuse A's lane once it's free, so three sequential batches
    // should still fit in a single lane.
    const a = makeBatch({ batchNo: "AW-00001", startDate: "2026-06-01", endDate: "2026-06-01" });
    const b = makeBatch({ batchNo: "AW-00002", startDate: "2026-06-02", endDate: "2026-06-02" });
    const c = makeBatch({ batchNo: "AW-00003", startDate: "2026-06-03", endDate: "2026-06-03" });
    const bars = layoutWeekBars([a, b, c], WEEK);
    expect(bars.every((bar) => bar.lane === 0)).toBe(true);
  });

  it("returns nothing for an empty week", () => {
    const batch = makeBatch({ startDate: "2026-06-01", endDate: "2026-06-01" });
    expect(layoutWeekBars([batch], [])).toEqual([]);
  });
});
