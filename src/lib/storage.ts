"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Entity } from "./types";

/* ============================================================================
 * Persistence
 * ----------------------------------------------------------------------------
 * Every portal section that isn't the Batch Book, MES or messaging keeps its
 * data in a `Collection`: Task planner, Batch schedule, Team & rota,
 * departments and bell notifications. Collections live on the server
 * (src/app/api/records → the `app_records` table), so every device sees the
 * same data — they used to live in each browser's own storage, which meant a
 * change made on a phone never reached a PC.
 *
 * The API stays synchronous, so pages didn't need rewriting: a change shows
 * immediately on the device that made it and is saved in the background;
 * other devices pick it up on their next check, every few seconds (and
 * straight away when a tab comes back into view). A copy is kept in browser
 * storage purely so pages open instantly on the next visit.
 * ========================================================================= */

const STORAGE_PREFIX = "ascotworld:";
const CACHE_PREFIX = `${STORAGE_PREFIX}cache:`;
const SESSION_KEY = `${STORAGE_PREFIX}session`;

/** How often an open page re-checks the collections it's showing. */
export const SYNC_INTERVAL_MS = 5000;

function sessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function requestHeaders(): HeadersInit {
  const id = sessionId();
  return { "Content-Type": "application/json", ...(id ? { "x-staff-id": id } : {}) };
}

function readCache<T>(key: string): T[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, items: readonly T[]): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(items));
  } catch {
    // Quota or private mode — only costs a slower first paint next time.
  }
}

/* -------------------------------------------------------------------------- */
/* Background sync — one timer for every collection currently on screen       */
/* -------------------------------------------------------------------------- */

interface Syncable {
  refresh(force?: boolean): Promise<void>;
  isWatched(): boolean;
}

const registry: Syncable[] = [];
let syncStarted = false;

function syncWatched(): void {
  if (document.visibilityState !== "visible") return;
  registry.filter((c) => c.isWatched()).forEach((c) => void c.refresh());
}

function startSync(): void {
  if (syncStarted || typeof window === "undefined") return;
  syncStarted = true;
  window.setInterval(syncWatched, SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", syncWatched);
  window.addEventListener("focus", syncWatched);
}

/** Re-fetch every collection now — e.g. right after signing in, when what
 *  the server will show (your notifications) has changed. */
export function refreshCollections(): void {
  registry.forEach((c) => void c.refresh(true));
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

/** Stable empty reference — `useSyncExternalStore` requires the server
 *  snapshot to be referentially stable across calls. */
const EMPTY: readonly never[] = Object.freeze([]);

export interface Collection<T extends Entity> {
  key: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly T[];
  getServerSnapshot(): readonly T[];
  all(): readonly T[];
  find(id: string): T | undefined;
  create(input: Omit<T, keyof Entity> & Partial<Entity>): T;
  update(id: string, patch: Partial<Omit<T, keyof Entity>>): T | undefined;
  remove(id: string): void;
  replaceAll(items: T[]): void;
  reset(): void;
}

export interface CollectionOptions {
  /**
   * Show the sample data until the server answers, instead of a loading
   * state — for the staff list, which sign-in needs before anything else
   * has loaded (and which only changes when someone edits the team).
   */
  provisionalSeed?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCollection<T extends Entity>(
  key: string,
  seed: () => T[],
  options: CollectionOptions = {},
): Collection<T> {
  const url = `/api/records/${key}`;
  const listeners = new Set<() => void>();

  /** Last list the server gave us; null until it has answered once. */
  let server: T[] | null = null;
  let version: string | null = null;
  let versionFor: string | null = null;
  /** Changes made here that the server hasn't confirmed yet; null = deleted. */
  const pending = new Map<string, T | null>();
  let view: readonly T[] | null = null;
  let started = false;
  let inflight: Promise<void> | null = null;
  let seedAttempted = false;

  /** Server data (or last visit's copy) with unconfirmed local changes on top. */
  function computeView(): readonly T[] | null {
    const base = server ?? readCache<T>(key) ?? (options.provisionalSeed ? seed() : null);
    if (!base) return null;
    let items = [...base];
    pending.forEach((record, id) => {
      const index = items.findIndex((item) => item.id === id);
      if (record === null) items = items.filter((item) => item.id !== id);
      else if (index === -1) items.push(record);
      else items[index] = record;
    });
    return items;
  }

  function recompute(): void {
    view = computeView();
    listeners.forEach((l) => l());
  }

  async function fetchOnce(): Promise<void> {
    const session = sessionId();
    const known = version && versionFor === session ? `?version=${encodeURIComponent(version)}` : "";
    const res = await fetch(url + known, { headers: requestHeaders() });
    if (!res.ok) return; // signed out, or a blip — keep what's on screen
    const body = (await res.json()) as { version: string; unchanged?: true; items?: T[] };
    if (body.unchanged) return;

    const items = body.items ?? [];
    if (items.length === 0 && !seedAttempted) {
      // A fresh database: fill it with the sample data, then read it back.
      seedAttempted = true;
      const sample = seed();
      if (sample.length > 0) {
        await fetch(url, { method: "POST", headers: requestHeaders(), body: JSON.stringify({ items: sample }) });
        version = null;
        return fetchOnce();
      }
    }

    server = items;
    version = body.version;
    versionFor = session;
    writeCache(key, items);
    recompute();
  }

  const syncable: Syncable = {
    async refresh(force = false) {
      if (typeof window === "undefined") return;
      if (inflight) {
        if (!force) return inflight;
        await inflight.catch(() => {});
      }
      inflight = fetchOnce()
        .catch(() => {
          // Offline or server trouble — the next check will retry.
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    isWatched: () => listeners.size > 0,
  };
  registry.push(syncable);

  function start(): void {
    if (started || typeof window === "undefined") return;
    started = true;
    // No listener call here — this can run mid-render, via getSnapshot.
    view = computeView();
    startSync();
    void syncable.refresh();
  }

  function current(): readonly T[] {
    start();
    return view ?? (EMPTY as readonly T[]);
  }

  /** Shows the change now, saves it in the background. If the server
   *  refuses, the change is rolled back to what the server has. */
  function save(id: string, record: T | null): void {
    start();
    pending.set(id, record);
    recompute();
    const request =
      record === null
        ? fetch(`${url}/${encodeURIComponent(id)}`, { method: "DELETE", headers: requestHeaders() })
        : fetch(`${url}/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: requestHeaders(),
            body: JSON.stringify(record),
          });
    void request
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(`Couldn't save ${key}/${id}:`, body?.error ?? res.status);
        }
      })
      .catch((error) => console.error(`Couldn't save ${key}/${id}:`, error))
      .finally(async () => {
        await syncable.refresh(true);
        // Only clear it if nothing newer was queued for the same record.
        if (pending.get(id) === record) {
          pending.delete(id);
          recompute();
        }
      });
  }

  return {
    key,

    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      // On the server there's no data yet; the hook swaps to the real
      // snapshot straight after hydration.
      if (typeof window === "undefined") return EMPTY as readonly T[];
      return current();
    },

    getServerSnapshot() {
      return EMPTY as readonly T[];
    },

    all() {
      return current();
    },

    find(id) {
      return current().find((item) => item.id === id);
    },

    create(input) {
      const stamp = nowIso();
      const record = {
        ...input,
        id: input.id ?? newId(key.slice(0, 3)),
        createdAt: input.createdAt ?? stamp,
        updatedAt: stamp,
      } as T;
      save(record.id, record);
      return record;
    },

    update(id, patch) {
      const existing = current().find((item) => item.id === id);
      if (!existing) return undefined;
      const updated = { ...existing, ...patch, updatedAt: nowIso() } as T;
      save(id, updated);
      return updated;
    },

    remove(id) {
      save(id, null);
    },

    replaceAll(items) {
      const keep = new Set(items.map((item) => item.id));
      current()
        .filter((item) => !keep.has(item.id))
        .forEach((item) => save(item.id, null));
      items.forEach((item) => save(item.id, item));
    },

    reset() {
      this.replaceAll(seed());
    },
  };
}

/* -------------------------------------------------------------------------- */
/* React binding                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe a component to a collection. Re-renders whenever the collection
 * changes — from this device or, within a few seconds, any other.
 *
 * `ready` is false until there's something real to show (the server's
 * answer, or this browser's copy from last time) — screens use it to show a
 * skeleton rather than flashing an incorrect empty state.
 */
export function useCollection<T extends Entity>(
  collection: Collection<T>,
): { items: readonly T[]; ready: boolean } {
  const subscribe = useCallback(
    (listener: () => void) => collection.subscribe(listener),
    [collection],
  );

  const items = useSyncExternalStore(
    subscribe,
    () => collection.getSnapshot(),
    () => collection.getServerSnapshot(),
  );

  return { items, ready: items !== (EMPTY as readonly T[]) };
}

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

/** Browser-only copies from before collections moved to the server. They're
 *  never read any more; clearing them just stops them looking like data. */
const LEGACY_KEYS = [
  "staff",
  "departments",
  "batches",
  "tasks",
  "shifts",
  "notifications",
  "conversations",
  "messages",
].map((k) => STORAGE_PREFIX + k);

if (typeof window !== "undefined") {
  try {
    LEGACY_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/**
 * Reset the shared sample data — used by the "Reset demo data" control.
 * Since the data is shared, this resets it for everyone, so the server only
 * lets an admin do it. Throws with the server's reason if refused.
 */
export async function resetAllDemoData(): Promise<void> {
  const res = await fetch("/api/records/reset", { method: "POST", headers: requestHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : `Reset failed (${res.status}).`);
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Cached copies will be replaced on the next check anyway.
  }
  window.location.reload();
}
