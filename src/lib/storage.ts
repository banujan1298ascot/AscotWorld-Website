"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Entity } from "./types";

/* ============================================================================
 * Persistence
 * ----------------------------------------------------------------------------
 * Everything the app stores goes through `StorageAdapter`. The demo build ships
 * `localStorageAdapter`, which keeps data in the browser only.
 *
 * TO MOVE TO A REAL DATABASE: write one object satisfying `StorageAdapter`
 * (fetch calls against your API) and assign it to `activeAdapter` below. No
 * module, page or component needs to change — they only ever touch
 * `createCollection` / `useCollection`.
 * ========================================================================= */

export interface StorageAdapter {
  read<T>(key: string): T[] | null;
  write<T>(key: string, value: T[]): void;
}

const STORAGE_PREFIX = "ascotworld:";

const localStorageAdapter: StorageAdapter = {
  read<T>(key: string): T[] | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      return raw ? (JSON.parse(raw) as T[]) : null;
    } catch {
      // Corrupt or unreadable storage falls back to seed data rather than
      // taking the whole portal down.
      return null;
    }
  },
  write<T>(key: string, value: T[]): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      // Quota exceeded or private mode — the in-memory cache still holds the
      // change for this session.
    }
  },
};

const activeAdapter: StorageAdapter = localStorageAdapter;

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
): Collection<T> {
  let cache: readonly T[] | null = null;
  const listeners = new Set<() => void>();

  function load(): readonly T[] {
    if (cache) return cache;
    const stored = activeAdapter.read<T>(key);
    if (stored) {
      cache = stored;
    } else {
      const seeded = seed();
      activeAdapter.write(key, seeded);
      cache = seeded;
    }
    return cache;
  }

  function commit(next: T[]): void {
    cache = next;
    activeAdapter.write(key, next);
    listeners.forEach((l) => l());
  }

  return {
    key,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      // On the server there is no storage; the hook swaps to the real snapshot
      // immediately after hydration.
      if (typeof window === "undefined") return EMPTY as readonly T[];
      return load();
    },

    getServerSnapshot() {
      return EMPTY as readonly T[];
    },

    all() {
      return load();
    },

    find(id) {
      return load().find((item) => item.id === id);
    },

    create(input) {
      const stamp = nowIso();
      const record = {
        ...input,
        id: input.id ?? newId(key.slice(0, 3)),
        createdAt: input.createdAt ?? stamp,
        updatedAt: stamp,
      } as T;
      commit([...load(), record]);
      return record;
    },

    update(id, patch) {
      const items = load();
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return undefined;
      const updated = { ...items[index], ...patch, updatedAt: nowIso() } as T;
      const next = [...items];
      next[index] = updated;
      commit(next);
      return updated;
    },

    remove(id) {
      commit(load().filter((item) => item.id !== id));
    },

    replaceAll(items) {
      commit(items);
    },

    reset() {
      commit(seed());
    },
  };
}

/* -------------------------------------------------------------------------- */
/* React binding                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe a component to a collection. Re-renders whenever the collection
 * changes, from anywhere in the app.
 *
 * `ready` is false during server render and the first hydration pass, when no
 * browser storage exists yet — screens use it to show a skeleton rather than
 * flashing an incorrect empty state.
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

/**
 * Wipe every portal collection — used by the "Reset demo data" control.
 *
 * Session and theme live under the same prefix but are user state rather than
 * demo content, so they are preserved: resetting the data should not sign
 * someone out or flip them back to light mode.
 */
const PRESERVED_KEYS = new Set([`${STORAGE_PREFIX}session`, `${STORAGE_PREFIX}theme`]);

export function resetAllDemoData(): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(STORAGE_PREFIX) && !PRESERVED_KEYS.has(k)) keys.push(k);
  }
  keys.forEach((k) => window.localStorage.removeItem(k));
  window.location.reload();
}
