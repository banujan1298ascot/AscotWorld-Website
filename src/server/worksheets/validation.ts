/**
 * Pure rules for worksheets (BMRs) — who may change them and what an upload
 * must look like. No DB access, so they're unit-tested directly
 * (validation.test.ts); src/server/worksheets/service.ts applies them.
 */
import type { ActingStaff } from "../actingStaff";
import {
  WORKSHEET_CHUNK_BYTES,
  WORKSHEET_MAX_BYTES,
  chunkCountFor,
  formatFileSize,
  worksheetContentType,
} from "@/lib/worksheetRules";

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Uploading and moving worksheets is for the people an admin has given
 * access (`hasAccess` — a worksheet_editors row) and admins themselves.
 * Everyone signed in can view and download them.
 */
export function canManageWorksheets(actor: ActingStaff, hasAccess: boolean): Result {
  if (actor.role === "admin" || hasAccess) return { ok: true, value: undefined };
  return {
    ok: false,
    error: "Only people given worksheet access can upload or move worksheets — ask an admin.",
  };
}

/** Granting access is an admin's call. */
export function canGrantWorksheetAccess(actor: ActingStaff): Result {
  return actor.role === "admin"
    ? { ok: true, value: undefined }
    : { ok: false, error: "Only an admin can change who has worksheet access." };
}

export interface UploadInput {
  productName?: unknown;
  version?: unknown;
  reference?: unknown;
  notes?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
}

export interface CheckedUpload {
  productName: string;
  version: string;
  reference: string | null;
  notes: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  chunkCount: number;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
};

/** What starting an upload needs: the product, its version, and a file of a
 *  type and size worksheets accept. */
export function checkUpload(input: UploadInput): Result<CheckedUpload> {
  const productName = text(input.productName, 200);
  if (!productName) return { ok: false, error: "Enter the product this worksheet is for." };
  const version = text(input.version, 50);
  if (!version) return { ok: false, error: "Enter the worksheet's version." };

  const fileName = typeof input.fileName === "string" ? input.fileName.trim().slice(0, 255) : "";
  if (!fileName) return { ok: false, error: "Choose a file to upload." };
  const contentType = worksheetContentType(fileName);
  if (!contentType) return { ok: false, error: "Worksheets must be a PDF, Word or Excel file." };

  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return { ok: false, error: "That file is empty." };
  if (sizeBytes > WORKSHEET_MAX_BYTES) {
    return { ok: false, error: `That file is too large — worksheets can be up to ${formatFileSize(WORKSHEET_MAX_BYTES)}.` };
  }

  return {
    ok: true,
    value: {
      productName,
      version,
      reference: text(input.reference, 100),
      notes: text(input.notes, 1000),
      fileName,
      contentType,
      sizeBytes,
      chunkCount: chunkCountFor(sizeBytes),
    },
  };
}

/** One piece of an upload: in range, and the size that piece should be —
 *  every piece is full except the last. */
export function checkChunk(
  upload: { sizeBytes: number; chunkCount: number },
  index: number,
  byteLength: number,
): Result {
  if (!Number.isInteger(index) || index < 0 || index >= upload.chunkCount) {
    return { ok: false, error: "That piece of the file is out of range." };
  }
  const expected =
    index < upload.chunkCount - 1 ? WORKSHEET_CHUNK_BYTES : upload.sizeBytes - WORKSHEET_CHUNK_BYTES * (upload.chunkCount - 1);
  if (byteLength !== expected) return { ok: false, error: "That piece of the file arrived incomplete — try again." };
  return { ok: true, value: undefined };
}

export type WorksheetMove = "ARCHIVED" | "APPROVED";

/** Approved ones can be archived; archived ones restored to approved. */
export function checkMove(current: string, to: unknown): Result<WorksheetMove> {
  if (to !== "ARCHIVED" && to !== "APPROVED") return { ok: false, error: "Move a worksheet to Approved or Archived." };
  if (current === "UPLOADING") return { ok: false, error: "That worksheet hasn't finished uploading." };
  if (current === "GENERATED") {
    return { ok: false, error: "A generated worksheet belongs to its batch — it can't be approved or archived." };
  }
  if (current === to) {
    return { ok: false, error: to === "ARCHIVED" ? "That worksheet is already archived." : "That worksheet is already approved." };
  }
  return { ok: true, value: to };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A worksheet id from the URL — anything that isn't one is simply "not
 *  found", rather than an error from the database. */
export function isWorksheetId(value: string): boolean {
  return UUID.test(value);
}
