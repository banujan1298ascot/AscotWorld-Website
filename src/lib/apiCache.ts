"use client";

/**
 * Remembers the last answer for server data a page needs straight away, so it
 * can draw from that at once and refresh behind it (stale-while-revalidate) —
 * the same idea src/lib/storage.ts uses for the shared records, applied to
 * plain API reads.
 *
 * Built for the MES, which otherwise loads in a chain — departments, then
 * stages, then queues — each a separate round trip that waits for the one
 * before. In production every hop costs a few hundred milliseconds, which
 * added up to a visible pause on opening the page. With this, a revisit
 * paints instantly; and `prefetchMes` warms it in the background right after
 * sign-in, so even the first visit does.
 *
 * Kept per signed-in account (a shared tablet signed in as another station
 * never sees this account's copies), in memory for the session and in
 * localStorage across reloads. Cleared with the rest of the portal's cached
 * copies (`ascotworld:cache:` prefix).
 */
import { apiFetch } from "./apiClient";

const PREFIX = "ascotworld:cache:api:";
const memory = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

const keyFor = (staffId: string, path: string) => `${staffId}|${path}`;

function write(key: string, value: unknown) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or private mode — only costs a slower first paint next time.
  }
}

/** The last answer for `path` this account got, if any. Cheap to call every
 *  render: localStorage is read once, then it's a Map lookup. */
export function readCached<T>(staffId: string | undefined, path: string | null): T | undefined {
  if (!staffId || !path) return undefined;
  const key = keyFor(staffId, path);
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw) {
      const value = JSON.parse(raw) as T;
      memory.set(key, value);
      return value;
    }
  } catch {
    // Unreadable or blocked — treated as nothing cached.
  }
  return undefined;
}

/**
 * Fetches `path` and remembers the answer. Callers asking for the same path
 * at the same time share one request — unless `fresh` is set, which a
 * refresh right after the caller changed something uses, so it can't be
 * handed a request that started before the change.
 */
export function fetchCached<T>(path: string, staffId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<T> {
  const key = keyFor(staffId, path);
  const pending = fresh ? undefined : inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const request = apiFetch<T>(path, staffId).then((value) => {
    write(key, value);
    return value;
  });
  if (!fresh) {
    inFlight.set(key, request);
    void request.catch(() => undefined).finally(() => inFlight.delete(key));
  }
  return request;
}

/* -------------------------------------------------------------------------- */
/* MES warm-up                                                                */
/* -------------------------------------------------------------------------- */

let mesWarmedFor: string | null = null;

/**
 * Loads what the MES page opens with — departments, the stage list and the
 * queues this account can see — into the cache, quietly, once per sign-in.
 * Called by the portal shell after sign-in, so opening the MES straight
 * after loading the site has nothing left to wait for. Failures are ignored:
 * the page simply fetches as it would have anyway.
 */
export function prefetchMes(staffId: string, mesStage: number | null | undefined) {
  if (mesWarmedFor === staffId) return;
  mesWarmedFor = staffId;
  void (async () => {
    try {
      const { departments } = await fetchCached<{ departments: { id: string }[] }>("/api/departments", staffId);
      const departmentId = departments[0]?.id;
      if (!departmentId) return;
      const { stages } = await fetchCached<{ stages: { id: string; sequenceNumber: number }[] }>(
        `/api/mes/stages?departmentId=${departmentId}`,
        staffId,
      );
      // A station account only ever opens its own queue; anyone else gets
      // every board stage (the table view shows them all at once).
      const wanted = stages.filter((s) => s.sequenceNumber >= 2 && (mesStage == null || s.sequenceNumber === mesStage));
      await Promise.all([
        ...wanted.map((s) => fetchCached(`/api/mes/stages/${s.id}/queue`, staffId)),
        fetchCached(`/api/mes/station-loads?departmentId=${departmentId}`, staffId),
      ]);
    } catch {
      // Best effort — see above.
    }
  })();
}
