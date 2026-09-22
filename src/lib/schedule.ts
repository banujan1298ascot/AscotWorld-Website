import { RESOURCES, type Batch, type Resource } from "./types";

/* ============================================================================
 * Scheduling logic
 * ----------------------------------------------------------------------------
 * Kept apart from the calendar view so the rules can be read — and later
 * tested — without going through the UI.
 * ========================================================================= */

export function resourceById(id: string | null): Resource | undefined {
  return id ? RESOURCES.find((r) => r.id === id) : undefined;
}

/** Inclusive overlap test on ISO yyyy-MM-dd date strings. */
export function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export interface Conflict {
  other: Batch;
  resource: Resource;
}

/**
 * A physical resource can only run one batch at a time. Returns every clash
 * between `batch` and the rest of the schedule.
 *
 * Cancelled batches release their resources, so they are ignored.
 */
export function findConflicts(batch: Batch, all: readonly Batch[]): Conflict[] {
  if (batch.status === "cancelled") return [];

  const conflicts: Conflict[] = [];
  const claimed = [batch.lineId, batch.roomId, batch.equipmentId].filter(
    (id): id is string => Boolean(id),
  );
  if (claimed.length === 0) return [];

  for (const other of all) {
    if (other.id === batch.id || other.status === "cancelled") continue;
    if (!datesOverlap(batch.startDate, batch.endDate, other.startDate, other.endDate)) continue;

    for (const resourceId of claimed) {
      const clashes =
        other.lineId === resourceId ||
        other.roomId === resourceId ||
        other.equipmentId === resourceId;
      if (!clashes) continue;

      const resource = resourceById(resourceId);
      if (resource) conflicts.push({ other, resource });
    }
  }

  return conflicts;
}

/** Ids of every batch currently double-booked, for flagging on the calendar. */
export function conflictedBatchIds(all: readonly Batch[]): Set<string> {
  const ids = new Set<string>();
  for (const batch of all) {
    if (findConflicts(batch, all).length > 0) ids.add(batch.id);
  }
  return ids;
}

/** One batch's placement on a week's calendar — a single continuous bar
 *  rather than a copy on every day it spans. */
export interface WeekBar {
  batch: Batch;
  /** 0-based index into the week's day list, clipped to it. */
  startIndex: number;
  /** 0-based index into the week's day list, clipped to it, inclusive. */
  endIndex: number;
  /** The batch actually started before this week — the bar's left edge is
   *  a clip, not the batch's real start. */
  clippedStart: boolean;
  /** The batch actually continues after this week — the bar's right edge
   *  is a clip, not the batch's real end. */
  clippedEnd: boolean;
  /** 0-based row to stack into, so two batches overlapping the same dates
   *  (a double-booked line) get separate rows instead of rendering on top
   *  of one another. */
  lane: number;
}

/**
 * Lays a week's batches out as calendar bars: one continuous span per batch,
 * clipped to the visible week and stacked into lanes, instead of a copy
 * repeated in every day cell it covers.
 *
 * `weekDaysIso` is the week's dates as `yyyy-MM-dd` strings, in order — the
 * caller already has these (it needs them to filter each day's batches
 * elsewhere), so this takes plain strings rather than pulling a date
 * library in here just to format them.
 */
export function layoutWeekBars(batches: readonly Batch[], weekDaysIso: readonly string[]): WeekBar[] {
  if (weekDaysIso.length === 0) return [];
  const weekStart = weekDaysIso[0];
  const weekEnd = weekDaysIso[weekDaysIso.length - 1];

  const spans = batches
    .filter((batch) => datesOverlap(batch.startDate, batch.endDate, weekStart, weekEnd))
    .map((batch) => {
      const clippedStart = batch.startDate < weekStart;
      const clippedEnd = batch.endDate > weekEnd;
      const startIndex = weekDaysIso.indexOf(clippedStart ? weekStart : batch.startDate);
      const endIndex = weekDaysIso.indexOf(clippedEnd ? weekEnd : batch.endDate);
      return { batch, startIndex, endIndex, clippedStart, clippedEnd };
    })
    // Longer/earlier batches claim a lane first, so a lane's occupant stays
    // stable rather than shuffling as later batches are considered.
    .sort(
      (a, b) =>
        a.startIndex - b.startIndex || a.endIndex - b.endIndex || a.batch.batchNo.localeCompare(b.batch.batchNo),
    );

  // Greedy interval-graph colouring: each span takes the lowest-numbered
  // lane whose last occupant has already ended, or opens a new one.
  const laneLastEnd: number[] = [];
  return spans.map((span) => {
    let lane = laneLastEnd.findIndex((end) => end < span.startIndex);
    if (lane === -1) {
      lane = laneLastEnd.length;
      laneLastEnd.push(span.endIndex);
    } else {
      laneLastEnd[lane] = span.endIndex;
    }
    return { ...span, lane };
  });
}

