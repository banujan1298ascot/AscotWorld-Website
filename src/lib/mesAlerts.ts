"use client";

/**
 * Detects new arrivals in a polled stage queue and turns them into the
 * sound + in-app alerts spec 3.5 asks for. Split the same way as the server
 * modules: `diffQueueArrivals` is pure (no DOM, no audio, no React) so the
 * "what counts as a new arrival" rule is unit-testable directly;
 * `useStageArrivalAlerts` is the thin hook that wires it to real effects.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { pushNotification } from "./notifications";
import { playNewArrivalSound, playReturnedArrivalSound } from "./soundAlerts";
import type { StageQueue } from "./mes";

export interface ArrivalDiff {
  newIncoming: string[];
  newReturned: string[];
}

/**
 * Compares two consecutive queue snapshots for the *same* stage and returns
 * the batch ids that newly appeared in Incoming/Returned. Deliberately
 * returns no diff (rather than "everything is new") on the first-ever
 * snapshot or when `current` belongs to a different stage than `previous`
 * — both are "fresh baseline" moments (initial load, or switching stage
 * tabs), not real arrivals, and alerting on either would be noise at best
 * and, on a stage switch, plain wrong (comparing unrelated batch ids).
 */
export function diffQueueArrivals(previous: StageQueue | null, current: StageQueue): ArrivalDiff {
  if (!previous || previous.stage.id !== current.stage.id) {
    return { newIncoming: [], newReturned: [] };
  }
  const prevIncoming = new Set(previous.incoming.map((b) => b.id));
  const prevReturned = new Set(previous.returned.map((b) => b.id));
  return {
    newIncoming: current.incoming.filter((b) => !prevIncoming.has(b.id)).map((b) => b.id),
    newReturned: current.returned.filter((b) => !prevReturned.has(b.id)).map((b) => b.id),
  };
}

function pluralBatches(count: number): string {
  return count === 1 ? "batch" : "batches";
}

/**
 * Watches a polled stage queue for arrivals and, for each: plays the
 * matching sound (if alerts are enabled and audio is unlocked) and pushes a
 * notification to the signed-in viewer via the portal's existing
 * notification center. There's no per-stage staff roster yet (see
 * docs/mes-api.md), so "whoever has this screen open" is who gets alerted
 * — not a fixed list of stage operators, which a kiosk deployment would
 * need to add.
 *
 * Returns the set of batch ids that arrived since the last check and are
 * still sitting unclaimed, for the board to highlight — cleared once a
 * batch is claimed (or otherwise leaves incoming/returned).
 */
export function useStageArrivalAlerts(
  queue: StageQueue | null,
  viewerId: string | undefined,
  soundEnabled: boolean,
): Set<string> {
  const previousRef = useRef<StageQueue | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!queue) return;
    const diff = diffQueueArrivals(previousRef.current, queue);
    previousRef.current = queue;
    if (diff.newIncoming.length === 0 && diff.newReturned.length === 0) return;

    if (diff.newIncoming.length > 0) {
      if (soundEnabled) playNewArrivalSound();
      if (viewerId) {
        pushNotification({
          recipientId: viewerId,
          type: "mes",
          title: `${diff.newIncoming.length} new ${pluralBatches(diff.newIncoming.length)} at ${queue.stage.name}`,
          body: "Ready to claim from Incoming.",
          href: "/mes",
        });
      }
    }
    if (diff.newReturned.length > 0) {
      if (soundEnabled) playReturnedArrivalSound();
      if (viewerId) {
        pushNotification({
          recipientId: viewerId,
          type: "mes",
          title: `${diff.newReturned.length} ${pluralBatches(diff.newReturned.length)} sent back to ${queue.stage.name}`,
          body: "Needs rework — check the Returned column.",
          href: "/mes",
        });
      }
    }

    setHighlighted((prev) => new Set([...prev, ...diff.newIncoming, ...diff.newReturned]));
  }, [queue, viewerId, soundEnabled]);

  // Prune at read-time rather than with a second effect+setState: a batch
  // stops being "highlighted" the moment it's no longer sitting unclaimed in
  // this stage's queue (claimed, or otherwise moved on). `highlighted` itself
  // may accumulate stale ids between renders; this is what actually filters
  // them for display.
  return useMemo(() => {
    if (!queue) return highlighted;
    const stillUnclaimed = new Set([...queue.incoming, ...queue.returned].map((b) => b.id));
    return new Set([...highlighted].filter((id) => stillUnclaimed.has(id)));
  }, [highlighted, queue]);
}
