"use client";

/**
 * Client-side data access for the production dashboard (spec 4), backed by
 * src/app/api/mes/dashboard and src/app/api/mes/batches/export. Same shape
 * as src/lib/batchBook.ts's hooks.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiRequestError } from "./apiClient";
import { useAuth } from "./auth";

export interface StageOccupancy {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  count: number;
}

export interface ThroughputDay {
  date: string;
  confirmed: number;
  completed: number;
  failed: number;
}

export interface StageDuration {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  avgSeconds: number | null;
  sampleSize: number;
}

export interface StageReworkRate {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  totalClosed: number;
  sentBack: number;
  failed: number;
}

export interface CycleTimeSummary {
  avgSeconds: number | null;
  sampleSize: number;
}

export interface OperatorStageDuration {
  stageId: string;
  stageName: string;
  sequenceNumber: number;
  operatorId: string;
  operatorName: string;
  avgSeconds: number | null;
  sampleSize: number;
}

export interface DashboardData {
  days: number;
  stageOccupancy: StageOccupancy[];
  throughput: ThroughputDay[];
  stageDurations: StageDuration[];
  stageReworkRates: StageReworkRate[];
  cycleTime: CycleTimeSummary;
  /** Present only when the caller has dashboard.viewOperatorMetrics — the
   *  server omits the field entirely otherwise, it isn't just hidden here. */
  operatorStageDurations?: OperatorStageDuration[];
}

export function useDashboard(departmentId: string | undefined, days: number = 14) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<{ data: DashboardData } | { error: string } | null> => {
    if (!user || !departmentId) return null;
    try {
      const result = await apiFetch<DashboardData>(
        `/api/mes/dashboard?departmentId=${departmentId}&days=${days}`,
        user.id,
      );
      return { data: result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load the dashboard." };
    }
  }, [user, departmentId, days]);

  useEffect(() => {
    let ignore = false;
    load().then((result) => {
      if (ignore || !result) return;
      if ("error" in result) setError(result.error);
      else {
        setData(result.data);
        setError(null);
      }
    });
    return () => {
      ignore = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const result = await load();
    if (!result) return;
    if ("error" in result) setError(result.error);
    else {
      setData(result.data);
      setError(null);
    }
  }, [load]);

  return { data, ready: data !== null || error !== null, error, refresh };
}

/** Fetches the CSV export and saves it via a temporary object URL — a plain
 *  <a href> can't carry the x-staff-id header this API needs. */
export async function downloadBatchesCsv(departmentId: string, staffId: string): Promise<void> {
  const res = await fetch(`/api/mes/batches/export?departmentId=${departmentId}`, {
    headers: { "x-staff-id": staffId },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiRequestError(typeof body?.error === "string" ? body.error : `Export failed (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const filename = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "batches.csv";
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
