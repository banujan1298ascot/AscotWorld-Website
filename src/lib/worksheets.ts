"use client";

/**
 * Client side of Worksheets (BMRs) — see src/server/worksheets/service.ts.
 * Files go up and come back down in pieces (WORKSHEET_CHUNK_BYTES), because
 * one request to the hosted site can't carry more than about 4.5 MB.
 *
 * Every request carries an `x-staff-id` header instead of a real session —
 * see the trust-boundary note in src/server/auth/requireStaff.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, apiFetch } from "./apiClient";
import { useAuth } from "./auth";
import { WORKSHEET_CHUNK_BYTES } from "./worksheetRules";

/** Mirrors WorksheetView in src/server/worksheets/service.ts. */
export interface Worksheet {
  id: string;
  productName: string;
  version: string;
  reference: string | null;
  notes: string | null;
  status: "APPROVED" | "ARCHIVED" | "GENERATED";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  archivedBy: string | null;
  archivedByName: string | null;
  archivedAt: string | null;
  archivedNote: string | null;
  /** For a generated copy: its batch, and the approved worksheet it was
   *  made from. */
  batchId: string | null;
  batchNumber: string | null;
  sourceWorksheetId: string | null;
}

/** Mirrors GenerateResult in src/server/worksheets/generate.ts. */
export type WorksheetGenerateResult =
  | {
      status: "generated";
      worksheetId: string;
      fileName: string;
      sourceFileName: string;
      sourceVersion: string;
      filled: string[];
      notFound: string[];
    }
  | { status: "no-match" | "unsupported" | "failed"; message: string };

export interface WorksheetDetails {
  productName: string;
  version: string;
  reference: string;
  notes: string;
}

/** Mirrors AccessEntry in src/server/worksheets/service.ts. */
export interface WorksheetAccessEntry {
  staffId: string;
  name: string;
  role: string;
  department: string | null;
  hasAccess: boolean;
}

export function useWorksheets() {
  const { user } = useAuth();
  const staffId = user?.id;
  const [state, setState] = useState<{ worksheets: Worksheet[]; canManage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to fetch the list again after an upload or a move. */
  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    apiFetch<{ worksheets: Worksheet[]; canManage: boolean }>("/api/worksheets", staffId)
      .then((result) => {
        if (cancelled) return;
        setState(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load worksheets.");
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, reloads]);

  return {
    worksheets: state?.worksheets ?? [],
    canManage: state?.canManage ?? false,
    ready: state !== null || error !== null,
    error,
    refresh,
  };
}

/**
 * Uploads `file` as a new worksheet: starts it, sends the file in pieces
 * (reporting progress 0-1), then finishes it — which approves it and moves
 * `archiveIds` (the product's previous version) to Archived.
 */
export async function uploadWorksheet(
  staffId: string,
  file: File,
  details: WorksheetDetails,
  archiveIds: string[],
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { id, chunkCount } = await apiFetch<{ id: string; chunkCount: number }>("/api/worksheets", staffId, {
    method: "POST",
    body: JSON.stringify({ ...details, fileName: file.name, sizeBytes: file.size }),
  });

  for (let index = 0; index < chunkCount; index++) {
    const piece = file.slice(index * WORKSHEET_CHUNK_BYTES, (index + 1) * WORKSHEET_CHUNK_BYTES);
    // One retry per piece rides out a brief connection drop.
    for (let attempt = 0; ; attempt++) {
      try {
        await apiFetch(`/api/worksheets/${id}/chunks/${index}`, staffId, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: piece,
        });
        break;
      } catch (err) {
        if (attempt >= 1 || err instanceof ApiRequestError) throw err;
      }
    }
    onProgress((index + 1) / chunkCount);
  }

  await apiFetch(`/api/worksheets/${id}/complete`, staffId, {
    method: "POST",
    body: JSON.stringify({ archiveIds }),
  });
}

/** Fetches a worksheet's file and joins its pieces back into one. */
export async function downloadWorksheetFile(staffId: string, worksheet: Worksheet): Promise<Blob> {
  const parts: ArrayBuffer[] = [];
  for (let index = 0; index < worksheet.chunkCount; index++) {
    const res = await fetch(`/api/worksheets/${worksheet.id}/chunks/${index}`, { headers: { "x-staff-id": staffId } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiRequestError(typeof body?.error === "string" ? body.error : "Couldn't fetch the file.");
    }
    parts.push(await res.arrayBuffer());
  }
  return new Blob(parts, { type: worksheet.contentType });
}

export function moveWorksheet(staffId: string, id: string, to: "ARCHIVED" | "APPROVED", note?: string) {
  return apiFetch(`/api/worksheets/${id}`, staffId, {
    method: "PATCH",
    body: JSON.stringify({ status: to, note }),
  });
}

/** Generates (again) the worksheet for a confirmed batch. */
export async function generateWorksheet(staffId: string, batchId: string): Promise<WorksheetGenerateResult> {
  const { worksheet } = await apiFetch<{ worksheet: WorksheetGenerateResult }>("/api/worksheets/generate", staffId, {
    method: "POST",
    body: JSON.stringify({ batchId }),
  });
  return worksheet;
}

export function fetchWorksheetAccess(staffId: string) {
  return apiFetch<{ people: WorksheetAccessEntry[] }>("/api/worksheets/access", staffId);
}

export function setWorksheetAccess(staffId: string, person: string, allowed: boolean) {
  return apiFetch<{ people: WorksheetAccessEntry[] }>("/api/worksheets/access", staffId, {
    method: "PUT",
    body: JSON.stringify({ staffId: person, allowed }),
  });
}
