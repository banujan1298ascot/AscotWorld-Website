"use client";

/**
 * Client-side data access for the MES pipeline (spec 3), backed by
 * src/app/api/mes. Same shape as src/lib/batchBook.ts's hooks — see that
 * file's header for why this is hand-rolled rather than a cache library.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./apiClient";
import { useAuth } from "./auth";
import type { BatchRecord } from "./batchBook";
import type { OperatorRole } from "./types";

export interface StageDefinition {
  id: string;
  departmentId: string;
  sequenceNumber: number;
  name: string;
  failAuthority: boolean;
  isTerminalReleaseStage: boolean;
  /** A station whose supervisor moves batches on for operators who don't use
   *  the app — see the `supervised` column on stage_definitions. */
  supervised: boolean;
  /** Only operators of this type may be assigned (or claim) here; null
   *  means anyone who can operate the MES. */
  operatorRole: OperatorRole | null;
}

export interface InProgressEntry {
  batch: BatchRecord;
  operatorId: string;
  operatorName: string;
  receivedAt: string;
}

export interface StageQueue {
  stage: StageDefinition;
  incoming: BatchRecord[];
  returned: BatchRecord[];
  inProgress: InProgressEntry[];
}

export function useStages(departmentId?: string): { stages: StageDefinition[]; ready: boolean; error: string | null } {
  const { user } = useAuth();
  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !departmentId) return;
    let cancelled = false;
    apiFetch<{ stages: StageDefinition[] }>(`/api/mes/stages?departmentId=${departmentId}`, user.id)
      .then(({ stages }) => {
        if (!cancelled) setStages(stages);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stages.");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, departmentId]);

  return { stages, ready, error };
}

/** How often an open stage screen re-checks its queue for arrivals it
 *  didn't cause itself (spec 3.5's sound alerts depend on this — there's no
 *  push/WebSocket transport yet, see docs/mes-api.md). */
export const STAGE_QUEUE_POLL_MS = 8000;

export function useStageQueue(stageId: string | undefined, pollIntervalMs: number = STAGE_QUEUE_POLL_MS) {
  const { user } = useAuth();
  const [queue, setQueue] = useState<StageQueue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<{ queue: StageQueue } | { error: string } | null> => {
    if (!user || !stageId) return null;
    try {
      return await apiFetch<{ queue: StageQueue }>(`/api/mes/stages/${stageId}/queue`, user.id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load this stage's queue." };
    }
  }, [user, stageId]);

  useEffect(() => {
    let ignore = false;
    // Reset happens inside the async chain (not synchronously in the effect
    // body) so switching stages shows a loading state rather than briefly
    // flashing the previous stage's queue.
    Promise.resolve().then(() => {
      if (ignore) return;
      setQueue(null);
      setError(null);
    });
    load().then((result) => {
      if (ignore || !result) return;
      if ("error" in result) setError(result.error);
      else setQueue(result.queue);
    });
    return () => {
      ignore = true;
    };
  }, [load, stageId]);

  const refresh = useCallback(async () => {
    const result = await load();
    if (!result) return;
    if ("error" in result) setError(result.error);
    else {
      setQueue(result.queue);
      setError(null);
    }
  }, [load]);

  // Polls for arrivals this screen didn't cause itself (someone else's
  // forward/send-back landing here). Unlike `refresh`, a failed poll is
  // silently skipped rather than replacing a working board with an error
  // banner over one transient network blip — it'll just try again next tick.
  useEffect(() => {
    if (!stageId || pollIntervalMs <= 0) return;
    const id = setInterval(() => {
      load().then((result) => {
        if (result && !("error" in result)) setQueue(result.queue);
      });
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [stageId, pollIntervalMs, load]);

  async function act<T>(path: string, init?: RequestInit): Promise<T> {
    if (!user) throw new Error("Not signed in.");
    const result = await apiFetch<T>(path, user.id, init);
    await refresh();
    return result;
  }

  /** `operatorId` assigns the batch to that person instead of the signed-in
   *  account — see the claim endpoint in docs/mes-api.md. */
  const claim = useCallback(
    (batchId: string, operatorId?: string) =>
      act(`/api/mes/stages/${stageId}/batches/${batchId}/claim`, {
        method: "POST",
        body: JSON.stringify(operatorId ? { operatorId } : {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageId, user, refresh],
  );
  const forward = useCallback(
    (batchId: string) => act(`/api/mes/stages/${stageId}/batches/${batchId}/forward`, { method: "POST" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageId, user, refresh],
  );
  const sendBack = useCallback(
    (batchId: string, notes: string, reasonCodeId?: string) =>
      act(`/api/mes/stages/${stageId}/batches/${batchId}/send-back`, {
        method: "POST",
        body: JSON.stringify({ notes, reasonCodeId }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageId, user, refresh],
  );
  const fail = useCallback(
    (batchId: string, notes: string, reasonCodeId?: string) =>
      act(`/api/mes/stages/${stageId}/batches/${batchId}/fail`, {
        method: "POST",
        body: JSON.stringify({ notes, reasonCodeId }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stageId, user, refresh],
  );

  return { queue, ready: queue !== null || error !== null, error, refresh, claim, forward, sendBack, fail };
}

/**
 * Every given stage's queue at once, for the table view — which lists all
 * batches across the pipeline in one place rather than one stage's board at
 * a time. Same polling as the board, and the same endpoints for actions, so
 * the two views are always working on the same live data.
 */
export function useAllStageQueues(stageIds: string[], pollIntervalMs: number = STAGE_QUEUE_POLL_MS) {
  const { user } = useAuth();
  const [queues, setQueues] = useState<StageQueue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = stageIds.join(",");

  const load = useCallback(async (): Promise<StageQueue[] | { error: string } | null> => {
    if (!user || !key) return null;
    try {
      return await Promise.all(
        key
          .split(",")
          .map((id) => apiFetch<{ queue: StageQueue }>(`/api/mes/stages/${id}/queue`, user.id).then((r) => r.queue)),
      );
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load the pipeline." };
    }
  }, [user, key]);

  const refresh = useCallback(async () => {
    const result = await load();
    if (!result) return;
    if ("error" in result) setError(result.error);
    else {
      setQueues(result);
      setError(null);
    }
  }, [load]);

  useEffect(() => {
    let ignore = false;
    load().then((result) => {
      if (ignore || !result) return;
      if ("error" in result) setError(result.error);
      else {
        setQueues(result);
        setError(null);
      }
    });
    if (pollIntervalMs <= 0) return () => void (ignore = true);
    // A failed poll keeps the table as it was; the next one retries.
    const id = setInterval(() => {
      load().then((result) => {
        if (!ignore && result && !("error" in result)) setQueues(result);
      });
    }, pollIntervalMs);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [load, pollIntervalMs]);

  async function act(path: string, body?: unknown): Promise<void> {
    if (!user) throw new Error("Not signed in.");
    await apiFetch(path, user.id, { method: "POST", body: JSON.stringify(body ?? {}) });
    await refresh();
  }
  const base = (stageId: string, batchId: string) => `/api/mes/stages/${stageId}/batches/${batchId}`;

  return {
    queues,
    ready: queues !== null || error !== null,
    error,
    refresh,
    claim: (stageId: string, batchId: string, operatorId?: string) =>
      act(`${base(stageId, batchId)}/claim`, operatorId ? { operatorId } : {}),
    reassign: (stageId: string, batchId: string, operatorId: string) =>
      act(`${base(stageId, batchId)}/reassign`, { operatorId }),
    forward: (stageId: string, batchId: string) => act(`${base(stageId, batchId)}/forward`),
    sendBack: (stageId: string, batchId: string, notes: string) => act(`${base(stageId, batchId)}/send-back`, { notes }),
    fail: (stageId: string, batchId: string, notes: string) => act(`${base(stageId, batchId)}/fail`, { notes }),
  };
}

/* ---------------------------------------------------------------------------
 * Labels printed at Check 2 — src/app/api/mes/batches/[batchId]/labels
 * ------------------------------------------------------------------------- */

/** The station that prints labels — mirrors LABEL_STATION_SEQUENCE in
 *  src/server/mes/validation.ts. */
export const LABEL_STATION_SEQUENCE = 2;

export type LabelPrintKind = "FIRST_PRINT" | "REPRINT";

export interface LabelRun {
  id: string;
  kind: LabelPrintKind;
  quantity: number;
  reason: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
}

export interface LabelRecord {
  labelsPrinted: number | null;
  labelsReprinted: number;
  runs: LabelRun[];
}

/** Same rule as canRecordLabels on the server, for deciding whether to show
 *  the inputs at all — the server checks again on every save. */
export function canRecordLabels(
  user: { role: string; mesStage?: number | null; operatorRole?: string | null },
  stage: Pick<StageDefinition, "sequenceNumber" | "operatorRole">,
  canClaim: boolean,
): boolean {
  if (stage.sequenceNumber !== LABEL_STATION_SEQUENCE) return false;
  if (user.role === "admin" || user.mesStage === LABEL_STATION_SEQUENCE) return true;
  if (user.mesStage != null || !canClaim) return false;
  return !stage.operatorRole || user.operatorRole === stage.operatorRole;
}

export function useLabelRecord(batchId: string | null) {
  const { user } = useAuth();
  const [state, setState] = useState<{ batchId: string | null; record: LabelRecord | null; error: string | null }>({
    batchId: null,
    record: null,
    error: null,
  });

  useEffect(() => {
    if (!user || !batchId) return;
    let ignore = false;
    apiFetch<{ labels: LabelRecord }>(`/api/mes/batches/${batchId}/labels`, user.id).then(
      ({ labels }) => !ignore && setState({ batchId, record: labels, error: null }),
      (err: unknown) =>
        !ignore &&
        setState({ batchId, record: null, error: err instanceof Error ? err.message : "Failed to load labels." }),
    );
    return () => {
      ignore = true;
    };
  }, [user, batchId]);

  const record = useCallback(
    async (run: { kind: LabelPrintKind; quantity: number; reason?: string }) => {
      if (!user || !batchId) throw new Error("Not signed in.");
      const { labels } = await apiFetch<{ labels: LabelRecord }>(`/api/mes/batches/${batchId}/labels`, user.id, {
        method: "POST",
        body: JSON.stringify(run),
      });
      setState({ batchId, record: labels, error: null });
      return labels;
    },
    [user, batchId],
  );

  const current = state.batchId === batchId;
  return {
    labels: current ? state.record : null,
    error: current ? state.error : null,
    ready: current && (state.record !== null || state.error !== null),
    record,
  };
}

/**
 * Which other stations each station keeps an eye on, by sequence number —
 * shown as live counters at the top of its MES screen so it can see work
 * building up around it. A station not listed here shows no counters.
 */
export const WATCHED_STATIONS: Readonly<Record<number, readonly number[]>> = {
  2: [3, 4],
  3: [2, 4],
  5: [2, 3, 4],
};
