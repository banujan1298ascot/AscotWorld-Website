"use client";

/**
 * Client-side data access for the Batch Book (spec 2). Unlike the rest of
 * the portal's data (src/lib/storage.ts, browser-storage collections), this
 * is real, server-persisted data — Batch Book is the first module backed by
 * the Postgres API under src/app/api/batch-book. `useBatchBook` is a
 * deliberately small hand-rolled fetch+refresh hook rather than pulling in a
 * cache library, since there's exactly one list view to keep in sync so far;
 * revisit that if a second server-backed module needs the same shape.
 *
 * Every request carries an `x-staff-id` header instead of a real session —
 * see the trust-boundary note in src/server/auth/requireStaff.ts. That's a
 * demo limitation of this phase, not a design choice to keep.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./apiClient";
import { useAuth } from "./auth";

export type BatchType = "A" | "B" | "C" | "D" | "M";
export type BatchBookStatus = "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD" | "FAILED";

export interface BatchRecord {
  id: string;
  batchType: BatchType;
  batchNumber: string | null;
  batchSequence: number | null;
  departmentId: string;
  productName: string | null;
  quantity: string | null;
  unit: string | null;
  plannedManufactureDate: string | null;
  status: BatchBookStatus;
  currentStageId: string | null;
  currentStageArrival: "FORWARD" | "RETURNED" | null;
  isHistoricalImport: boolean;
  customFields: Record<string, unknown>;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface BatchDraftInput {
  batchType: BatchType;
  departmentId: string;
  productName?: string;
  quantity?: string;
  unit?: string;
  plannedManufactureDate?: string;
}

export type BatchPatch = Partial<
  Pick<BatchRecord, "batchType" | "departmentId" | "productName" | "quantity" | "unit" | "plannedManufactureDate">
>;

export function useDepartments(): { departments: DepartmentOption[]; ready: boolean; error: string | null } {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiFetch<{ departments: DepartmentOption[] }>("/api/departments", user.id)
      .then(({ departments }) => {
        if (!cancelled) setDepartments(departments);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load departments.");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { departments, ready, error };
}

export function useBatchBook(statusFilter?: BatchBookStatus) {
  const { user } = useAuth();
  const [batches, setBatches] = useState<BatchRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<{ batches: BatchRecord[] } | { error: string }> => {
    if (!user) return { batches: [] };
    try {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      const result = await apiFetch<{ batches: BatchRecord[] }>(`/api/batch-book${query}`, user.id);
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to load Batch Book." };
    }
  }, [user, statusFilter]);

  // Fetches on mount / whenever `load` changes; `ignore` avoids setting state
  // from a stale request that resolves after a newer one was already fired.
  useEffect(() => {
    let ignore = false;
    load().then((result) => {
      if (ignore) return;
      if ("error" in result) setError(result.error);
      else {
        setBatches(result.batches);
        setError(null);
      }
    });
    return () => {
      ignore = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const result = await load();
    if ("error" in result) setError(result.error);
    else {
      setBatches(result.batches);
      setError(null);
    }
  }, [load]);

  /** Returns the created record, so a caller entering a batch can confirm it
   *  in the same step without waiting for the list to come back. */
  const createDraft = useCallback(
    async (input: BatchDraftInput): Promise<BatchRecord> => {
      if (!user) throw new Error("Not signed in.");
      const { batch } = await apiFetch<{ batch: BatchRecord }>("/api/batch-book", user.id, {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return batch;
    },
    [user, refresh],
  );

  const editBatch = useCallback(
    async (id: string, patch: BatchPatch, reason?: string) => {
      if (!user) throw new Error("Not signed in.");
      await apiFetch(`/api/batch-book/${id}`, user.id, {
        method: "PATCH",
        body: JSON.stringify({ patch, reason }),
      });
      await refresh();
    },
    [user, refresh],
  );

  const confirmBatch = useCallback(
    async (id: string) => {
      if (!user) throw new Error("Not signed in.");
      await apiFetch(`/api/batch-book/${id}/confirm`, user.id, { method: "POST" });
      await refresh();
    },
    [user, refresh],
  );

  return {
    batches,
    ready: batches !== null || error !== null,
    error,
    refresh,
    createDraft,
    editBatch,
    confirmBatch,
  };
}

/**
 * The spec (2.3) gives A/B/C/D/M as confirmed prefixes with examples of what
 * they *might* represent ("such as in-stock production, cytotoxic, batch
 * production, bespoke production") but never pins down which letter is
 * which — that mapping is still an open decision, so labels stay generic
 * here rather than asserting a guess as settled fact. M is the one
 * structural fact that is confirmed: it resets yearly.
 */
export const BATCH_TYPE_LABELS: Record<BatchType, string> = {
  A: "Type A",
  B: "Type B",
  C: "Type C",
  D: "Type D",
  M: "Type M (resets yearly)",
};

export const BATCH_BOOK_STATUS_LABELS: Record<BatchBookStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  ON_HOLD: "On hold",
  FAILED: "Failed",
};
