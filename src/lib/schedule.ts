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

