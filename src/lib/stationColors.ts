"use client";

/**
 * Each station's colour, by its sequence number (Check 1-6, Warehouse = 7).
 * A station account's pages all sit on its light pastel (in dark mode too),
 * and so does the MES while you're looking at a station — the
 * `--station-*` tokens and `:root[data-station]` rules in globals.css.
 * `dot` is the solid shade for the small station markers (numbers in the
 * switcher, the counters, the table's Station column).
 *
 * Which station the page is tinted for lives on <html data-station>, like
 * data-theme: the portal layout sets it from the signed-in account, and a
 * page about one station (the MES board) can take it over while it's open.
 */
import { useEffect, useSyncExternalStore, type CSSProperties } from "react";

export interface StationColor {
  name: string;
  /** Solid shade for markers; white text sits on it. */
  dot: string;
  /** Text colour on `dot` — dark on the light ones (yellow, sky blue). */
  dotInk: string;
}

export const STATION_COLORS: Record<number, StationColor> = {
  1: { name: "Orange", dot: "#f28c28", dotInk: "#ffffff" },
  2: { name: "Purple", dot: "#8b5cf6", dotInk: "#ffffff" },
  3: { name: "Blue", dot: "#2563eb", dotInk: "#ffffff" },
  4: { name: "Red", dot: "#dc2626", dotInk: "#ffffff" },
  5: { name: "Sky blue", dot: "#38bdf8", dotInk: "#0b2533" },
  6: { name: "Yellow", dot: "#facc15", dotInk: "#2b2300" },
  7: { name: "Green", dot: "#16a34a", dotInk: "#ffffff" },
};

export function stationColor(sequence: number | null | undefined): StationColor | undefined {
  return sequence == null ? undefined : STATION_COLORS[sequence];
}

/** Inline style for a station's round number marker. */
export function stationDotStyle(sequence: number | null | undefined): CSSProperties | undefined {
  const color = stationColor(sequence);
  return color ? { background: color.dot, color: color.dotInk } : undefined;
}

/* -------------------------------------------------------------------------- */
/* Which station the page is tinted for                                       */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
/** Set by a page about one station; wins over the signed-in account's own. */
let pageStation: number | null = null;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setPageStation(next: number | null) {
  if (pageStation === next) return;
  pageStation = next;
  listeners.forEach((listener) => listener());
}

/** A page showing one station tints the background for it while open. */
export function usePageStation(sequence: number | null | undefined) {
  const value = sequence ?? null;
  useEffect(() => {
    setPageStation(value);
    return () => setPageStation(null);
  }, [value]);
}

/** Portal layout: tint every page for the account's station, unless the
 *  page open is about a different one. */
export function useStationBackground(accountStation: number | null | undefined) {
  const page = useSyncExternalStore(subscribe, () => pageStation, () => null);
  const station = page ?? accountStation ?? null;
  useEffect(() => {
    const root = document.documentElement;
    if (station != null && STATION_COLORS[station]) root.setAttribute("data-station", String(station));
    else root.removeAttribute("data-station");
    return () => root.removeAttribute("data-station");
  }, [station]);
}
