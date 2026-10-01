"use client";

/**
 * Whether the desktop sidebar is hidden — a per-browser preference, so it's
 * kept in localStorage rather than shared state. A tiny external store, read
 * with useSyncExternalStore: the server (and hydration) always renders the
 * sidebar shown, then the browser's saved choice applies straight after
 * without a hydration mismatch.
 */
import { useCallback, useSyncExternalStore } from "react";

const KEY = "ascotworld:sidebar-hidden";
const listeners = new Set<() => void>();
/** Used when storage is blocked (private window, say), so the toggle still
 *  works for this visit even though it can't be remembered. */
let fallback = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return fallback;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing it.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSidebarHidden(): [hidden: boolean, setHidden: (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(subscribe, read, () => false);
  const setHidden = useCallback((next: boolean) => {
    fallback = next;
    try {
      if (next) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
    } catch {
      // Storage blocked — `fallback` carries it for this visit.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [hidden, setHidden];
}
