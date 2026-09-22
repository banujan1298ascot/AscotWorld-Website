import { describe, expect, it } from "vitest";
import { diffQueueArrivals } from "./mesAlerts";
import type { BatchRecord } from "./batchBook";
import type { StageDefinition, StageQueue } from "./mes";

function makeBatch(id: string): BatchRecord {
  return {
    id,
    batchType: "A",
    batchNumber: `A-${id}`,
    batchSequence: 1,
    departmentId: "dept_1",
    productName: "Test product",
    quantity: "100",
    unit: "bottles",
    plannedManufactureDate: null,
    status: "IN_PROGRESS",
    currentStageId: "stage_2",
    currentStageArrival: "FORWARD",
    isHistoricalImport: false,
    customFields: {},
    createdBy: "staff_1",
    confirmedBy: "staff_1",
    confirmedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeStage(id: string): StageDefinition {
  return {
    id,
    departmentId: "dept_1",
    sequenceNumber: 2,
    name: "Order/Calculation Check",
    failAuthority: false,
    isTerminalReleaseStage: false,
    supervised: false,
  };
}

function makeQueue(stageId: string, incomingIds: string[], returnedIds: string[] = []): StageQueue {
  return {
    stage: makeStage(stageId),
    incoming: incomingIds.map(makeBatch),
    returned: returnedIds.map(makeBatch),
    inProgress: [],
  };
}

describe("diffQueueArrivals", () => {
  it("reports no arrivals on the very first snapshot (previous is null)", () => {
    const current = makeQueue("stage_2", ["b1", "b2"]);
    expect(diffQueueArrivals(null, current)).toEqual({ newIncoming: [], newReturned: [] });
  });

  it("reports batches newly present in Incoming", () => {
    const previous = makeQueue("stage_2", ["b1"]);
    const current = makeQueue("stage_2", ["b1", "b2", "b3"]);
    expect(diffQueueArrivals(previous, current)).toEqual({ newIncoming: ["b2", "b3"], newReturned: [] });
  });

  it("reports batches newly present in Returned, independently of Incoming", () => {
    const previous = makeQueue("stage_2", ["b1"], ["r1"]);
    const current = makeQueue("stage_2", ["b1"], ["r1", "r2"]);
    expect(diffQueueArrivals(previous, current)).toEqual({ newIncoming: [], newReturned: ["r2"] });
  });

  it("does not report a batch that disappeared as an arrival", () => {
    const previous = makeQueue("stage_2", ["b1", "b2"]);
    const current = makeQueue("stage_2", ["b1"]);
    expect(diffQueueArrivals(previous, current)).toEqual({ newIncoming: [], newReturned: [] });
  });

  it("reports nothing when nothing changed", () => {
    const previous = makeQueue("stage_2", ["b1"], ["r1"]);
    const current = makeQueue("stage_2", ["b1"], ["r1"]);
    expect(diffQueueArrivals(previous, current)).toEqual({ newIncoming: [], newReturned: [] });
  });

  it("treats a switch to a different stage as a fresh baseline, not a flood of arrivals", () => {
    const previous = makeQueue("stage_2", ["b1", "b2"]);
    // Entirely different batch ids at a different stage — must not be
    // reported as arrivals just because they weren't in `previous`.
    const current = makeQueue("stage_3", ["c1", "c2", "c3"]);
    expect(diffQueueArrivals(previous, current)).toEqual({ newIncoming: [], newReturned: [] });
  });
});
