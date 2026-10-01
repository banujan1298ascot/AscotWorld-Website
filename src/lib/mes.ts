"use client";

/**
 * Client-side data access for the MES pipeline (spec 3), backed by
 * src/app/api/mes. Same shape as src/lib/batchBook.ts's hooks — see that
 * file's header for why this is hand-rolled rather than a cache library.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./apiClient";
import { fetchCached, readCached } from "./apiCache";
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

/** The stage list rarely changes, so the last one this browser saw is shown
 *  at once and refreshed behind it (see src/lib/apiCache.ts). */
export function useStages(departmentId?: string): { stages: StageDefinition[]; ready: boolean; error: string | null } {
  const { user } = useAuth();
  const staffId = user?.id;
  const path = departmentId ? `/api/mes/stages?departmentId=${departmentId}` : null;
  const [fetched, setFetched] = useState<{ path: string; stages: StageDefinition[] } | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const cached = readCached<{ stages: StageDefinition[] }>(staffId, path);

  useEffect(() => {
    if (!staffId || !path) return;
    let cancelled = false;
    fetchCached<{ stages: StageDefinition[] }>(path, staffId)
      .then(({ stages }) => {
        if (!cancelled) setFetched({ path, stages });
      })
      .catch((err) => {
        if (!cancelled) setError({ path, message: err instanceof Error ? err.message : "Failed to load stages." });
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, path]);

  const stages = (fetched?.path === path ? fetched.stages : undefined) ?? cached?.stages;
  const failed = error?.path === path && !stages ? error.message : null;
  return { stages: stages ?? [], ready: Boolean(stages) || failed !== null, error: failed };
}

/** How often an open stage screen re-checks its queue for arrivals it
 *  didn't cause itself (spec 3.5's sound alerts depend on this — there's no
 *  push/WebSocket transport yet, see docs/mes-api.md). */
export const STAGE_QUEUE_POLL_MS = 8000;

/**
 * One stage's queue, polled. Until the server first answers, the last queue
 * this browser saw for the stage is shown (from src/lib/apiCache.ts), so the
 * board paints at once instead of waiting on the round trip; `fresh` says
 * whether what's showing has come back from the server yet.
 */
export function useStageQueue(stageId: string | undefined, pollIntervalMs: number = STAGE_QUEUE_POLL_MS) {
  const { user } = useAuth();
  const staffId = user?.id;
  const path = stageId ? `/api/mes/stages/${stageId}/queue` : null;
  // The server's latest answer, tagged with the stage it's for — switching
  // stages then shows the new stage's cached queue (or a loading state),
  // never a flash of the previous stage's.
  const [state, setState] = useState<{ path: string; queue: StageQueue | null; error: string | null } | null>(null);
  const cached = readCached<{ queue: StageQueue }>(staffId, path)?.queue ?? null;
  const current = state && state.path === path ? state : null;

  const load = useCallback(
    async (fresh = false): Promise<{ path: string; queue: StageQueue } | { path: string; error: string } | null> => {
      if (!staffId || !path) return null;
      try {
        const { queue } = await fetchCached<{ queue: StageQueue }>(path, staffId, { fresh });
        return { path, queue };
      } catch (err) {
        return { path, error: err instanceof Error ? err.message : "Failed to load this stage's queue." };
      }
    },
    [staffId, path],
  );

  useEffect(() => {
    let ignore = false;
    load().then((result) => {
      if (ignore || !result) return;
      if ("error" in result) setState({ path: result.path, queue: null, error: result.error });
      else setState({ path: result.path, queue: result.queue, error: null });
    });
    return () => {
      ignore = true;
    };
  }, [load]);

  /** After this screen changed something — never handed a request that
   *  started before the change. */
  const refresh = useCallback(async () => {
    const result = await load(true);
    if (!result) return;
    if ("error" in result) {
      setState((prev) => ({
        path: result.path,
        queue: prev?.path === result.path ? prev.queue : null,
        error: result.error,
      }));
    } else setState({ path: result.path, queue: result.queue, error: null });
  }, [load]);

  // Polls for arrivals this screen didn't cause itself (someone else's
  // forward/send-back landing here). Unlike `refresh`, a failed poll is
  // silently skipped rather than replacing a working board with an error
  // banner over one transient network blip — it'll just try again next tick.
  useEffect(() => {
    if (!path || pollIntervalMs <= 0) return;
    const id = setInterval(() => {
      load().then((result) => {
        if (result && !("error" in result)) setState({ path: result.path, queue: result.queue, error: null });
      });
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [path, pollIntervalMs, load]);

  const queue = current?.queue ?? cached;
  const error = current?.error ?? null;
  const fresh = Boolean(current?.queue);

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

  return { queue, ready: queue !== null || error !== null, fresh, error, refresh, claim, forward, sendBack, fail };
}

/** The cached queue for every stage in `key` (comma-separated ids), or null
 *  unless all of them are cached — a table with some stations missing would
 *  look like those stations were empty. */
function cachedQueues(staffId: string | undefined, key: string): StageQueue[] | null {
  if (!staffId || !key) return null;
  const queues: StageQueue[] = [];
  for (const id of key.split(",")) {
    const hit = readCached<{ queue: StageQueue }>(staffId, `/api/mes/stages/${id}/queue`);
    if (!hit) return null;
    queues.push(hit.queue);
  }
  return queues;
}

/**
 * Every given stage's queue at once, for the table view — which lists all
 * batches across the pipeline in one place rather than one stage's board at
 * a time. Same polling as the board, and the same endpoints for actions, so
 * the two views are always working on the same live data.
 */
export function useAllStageQueues(stageIds: string[], pollIntervalMs: number = STAGE_QUEUE_POLL_MS) {
  const { user } = useAuth();
  const staffId = user?.id;
  const key = stageIds.join(",");
  // As in useStageQueue: the server's latest answer for this set of stages,
  // and until then the queues this browser last saw for them.
  const [state, setState] = useState<{ key: string; queues: StageQueue[] | null; error: string | null } | null>(null);
  const current = state && state.key === key ? state : null;
  // Memoised so the table isn't handed a new array every render while it
  // waits; the fresh answer replaces it anyway.
  const cached = useMemo(() => cachedQueues(staffId, key), [staffId, key]);

  const load = useCallback(
    async (fresh = false): Promise<{ key: string; queues: StageQueue[] } | { key: string; error: string } | null> => {
      if (!staffId || !key) return null;
      try {
        const queues = await Promise.all(
          key
            .split(",")
            .map((id) =>
              fetchCached<{ queue: StageQueue }>(`/api/mes/stages/${id}/queue`, staffId, { fresh }).then((r) => r.queue),
            ),
        );
        return { key, queues };
      } catch (err) {
        return { key, error: err instanceof Error ? err.message : "Failed to load the pipeline." };
      }
    },
    [staffId, key],
  );

  const refresh = useCallback(async () => {
    const result = await load(true);
    if (!result) return;
    if ("error" in result) {
      setState((prev) => ({
        key: result.key,
        queues: prev?.key === result.key ? prev.queues : null,
        error: result.error,
      }));
    } else setState({ key: result.key, queues: result.queues, error: null });
  }, [load]);

  useEffect(() => {
    let ignore = false;
    load().then((result) => {
      if (ignore || !result) return;
      if ("error" in result) setState({ key: result.key, queues: null, error: result.error });
      else setState({ key: result.key, queues: result.queues, error: null });
    });
    if (pollIntervalMs <= 0) return () => void (ignore = true);
    // A failed poll keeps the table as it was; the next one retries.
    const id = setInterval(() => {
      load().then((result) => {
        if (!ignore && result && !("error" in result)) setState({ key: result.key, queues: result.queues, error: null });
      });
    }, pollIntervalMs);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [load, pollIntervalMs]);

  const queues = current?.queues ?? cached;
  const error = current?.error ?? null;

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
