"use client";

/**
 * Client-side data access for the production report page, backed by
 * src/app/api/mes/reports/*. Types mirror src/server/dashboard/reports.ts.
 */
import { useEffect, useState } from "react";
import { fetchCached, readCached } from "./apiCache";
import { useAuth } from "./auth";

export type OutputRange = "week" | "month" | "year";

export interface OutputPoint {
  key: string;
  made: number;
  started: number;
}

export interface OutputReport {
  range: OutputRange;
  bucket: "day" | "month";
  points: OutputPoint[];
  totalMade: number;
  totalStarted: number;
  previousMade: number;
  changePct: number | null;
}

export interface StationLoad {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  incoming: number;
  returned: number;
  inProgress: number;
}

export interface ReportException {
  id: string;
  outcome: "SENT_BACK" | "FAILED";
  at: string;
  batchNumber: string | null;
  productName: string | null;
  stageName: string;
  sequenceNumber: number;
  operatorName: string;
  notes: string | null;
}

export interface ProductMatch {
  productName: string;
  batches: number;
  completed: number;
}

export type TimingConfidence = "none" | "early" | "building" | "reliable";

export interface ProductStageTiming {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  avgSeconds: number | null;
  sampleSize: number;
}

export interface ProductOperatorTiming {
  operatorId: string;
  operatorName: string;
  stageName: string;
  sequenceNumber: number;
  avgSeconds: number | null;
  sampleSize: number;
}

export interface ProductTiming {
  productName: string;
  sampleSize: number;
  confidence: TimingConfidence;
  avgLeadSeconds: number | null;
  minLeadSeconds: number | null;
  maxLeadSeconds: number | null;
  avgHandsOnSeconds: number | null;
  lastFinishedAt: string | null;
  stages: ProductStageTiming[];
  operators?: ProductOperatorTiming[];
}

interface Resource<T> {
  data: T | null;
  error: string | null;
  /** First response (or failure) has arrived. */
  ready: boolean;
  /** A request for the current `path` is in flight. */
  loading: boolean;
}

/**
 * Fetches `path` (skipping while it's null), keeping the previous data on
 * screen while a new path loads so switching a chart range doesn't flash
 * empty. With `pollMs`, re-fetches silently on that interval — a failed
 * poll keeps the last good data rather than blanking the card. Until the
 * first answer arrives, the last one this browser saw for `path` is shown
 * (src/lib/apiCache.ts), so a revisit paints at once.
 */
function useApiResource<T>(path: string | null, pollMs?: number): Resource<T> {
  const { user } = useAuth();
  const staffId = user?.id;
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>({
    path: null,
    data: null,
    error: null,
  });
  const cached = readCached<T>(staffId, path) ?? null;

  useEffect(() => {
    if (!path || !staffId) return;
    let ignore = false;
    const load = (initial: boolean) =>
      fetchCached<T>(path, staffId).then(
        (data) => {
          if (!ignore) setState({ path, data, error: null });
        },
        (err: unknown) => {
          if (ignore || !initial) return;
          setState((prev) => ({
            path,
            data: prev.data,
            error: err instanceof Error ? err.message : "Failed to load.",
          }));
        },
      );
    load(true);
    if (!pollMs) {
      return () => {
        ignore = true;
      };
    }
    // Polled while the tab is on screen; a hidden tab skips its ticks and
    // catches up the moment it's looked at again.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ignore = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, staffId, pollMs]);

  // The cached copy only stands in for this exact path, before it's answered.
  const data = state.path === path ? state.data : (cached ?? state.data);
  return {
    data,
    error: state.error,
    ready: data !== null || state.error !== null,
    loading: path !== null && state.path !== path,
  };
}

const enc = encodeURIComponent;

export function useOutputReport(departmentId: string | undefined, range: OutputRange) {
  return useApiResource<OutputReport>(
    departmentId ? `/api/mes/reports/output?departmentId=${enc(departmentId)}&range=${range}` : null,
  );
}

/** Polled — the floor model is meant to show "right now", so a batch sent
 *  forward or back shows up within a few seconds. One small count query a
 *  tick, and nothing while the tab is hidden (see useApiResource). */
export const STATION_POLL_MS = 3_000;

export function useStationLoads(departmentId: string | undefined) {
  return useApiResource<{ stations: StationLoad[] }>(
    departmentId ? `/api/mes/reports/stations?departmentId=${enc(departmentId)}` : null,
    STATION_POLL_MS,
  );
}

export function useRecentExceptions(departmentId: string | undefined) {
  return useApiResource<{ exceptions: ReportException[] }>(
    departmentId ? `/api/mes/reports/exceptions?departmentId=${enc(departmentId)}` : null,
    60_000,
  );
}

/** `query` should already be debounced by the caller. */
export function useProductSearch(departmentId: string | undefined, query: string) {
  const trimmed = query.trim();
  return useApiResource<{ products: ProductMatch[] }>(
    departmentId && trimmed ? `/api/mes/reports/products?departmentId=${enc(departmentId)}&q=${enc(trimmed)}` : null,
  );
}

export function useProductTiming(departmentId: string | undefined, productName: string | null) {
  return useApiResource<ProductTiming>(
    departmentId && productName
      ? `/api/mes/reports/products/timing?departmentId=${enc(departmentId)}&product=${enc(productName)}`
      : null,
  );
}

/** Seconds → "45s" / "38m" / "2.4h" / "3.1d", or an em dash for no data. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const abs = Math.abs(seconds);
  if (abs < 60) return `${Math.round(abs)}s`;
  const minutes = abs / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

/** How often a station's live counters re-check the stations it watches. */
export const STATION_COUNTER_POLL_MS = 5000;

/** Live per-station counts for the counters at the top of an MES screen.
 *  Unlike useStationLoads this uses the counts-only endpoint, which station
 *  accounts may read without access to the reports. */
export function useStationCounters(departmentId: string | undefined) {
  return useApiResource<{ stations: StationLoad[] }>(
    departmentId ? `/api/mes/station-loads?departmentId=${enc(departmentId)}` : null,
    STATION_COUNTER_POLL_MS,
  );
}
