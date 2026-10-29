/**
 * Worksheets (BMRs): uploading them in pieces, listing them, moving them
 * between Approved and Archived, and who's allowed to. The rules themselves
 * are in ./validation.ts.
 */
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ApiError } from "../apiError";
import type { ActingStaff } from "../actingStaff";
import { db } from "../db/client";
import { batchRecords, staff, worksheetEditors, worksheetFileChunks, worksheets } from "../db/schema";
import {
  canGrantWorksheetAccess,
  canManageWorksheets,
  checkChunk,
  checkMove,
  checkUpload,
  type Result,
  type UploadInput,
} from "./validation";

export interface WorksheetView {
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
  /** For a generated copy: its batch, and the approved worksheet it came from. */
  batchId: string | null;
  batchNumber: string | null;
  sourceWorksheetId: string | null;
}

function orThrow<T>(result: Result<T>, status = 422): T {
  if (!result.ok) throw new ApiError(status, result.error);
  return result.value;
}

async function hasWorksheetAccess(staffId: string): Promise<boolean> {
  const [row] = await db
    .select({ staffId: worksheetEditors.staffId })
    .from(worksheetEditors)
    .where(eq(worksheetEditors.staffId, staffId))
    .limit(1);
  return Boolean(row);
}

export async function mayManageWorksheets(actor: ActingStaff): Promise<boolean> {
  return actor.role === "admin" || (await hasWorksheetAccess(actor.id));
}

async function requireManager(actor: ActingStaff): Promise<void> {
  orThrow(canManageWorksheets(actor, actor.role !== "admin" && (await hasWorksheetAccess(actor.id))), 403);
}

const uploader = alias(staff, "uploader");
const archiver = alias(staff, "archiver");

/** Every approved, archived and generated worksheet, by product then
 *  newest first. */
export async function listWorksheets(): Promise<WorksheetView[]> {
  const rows = await db
    .select({
      worksheet: worksheets,
      uploadedByName: uploader.name,
      archivedByName: archiver.name,
      batchNumber: batchRecords.batchNumber,
    })
    .from(worksheets)
    .innerJoin(uploader, eq(uploader.id, worksheets.uploadedBy))
    .leftJoin(archiver, eq(archiver.id, worksheets.archivedBy))
    .leftJoin(batchRecords, eq(batchRecords.id, worksheets.batchId))
    .where(inArray(worksheets.status, ["APPROVED", "ARCHIVED", "GENERATED"]))
    .orderBy(asc(worksheets.productName), desc(worksheets.uploadedAt));

  return rows.map(({ worksheet: w, uploadedByName, archivedByName, batchNumber }) => ({
    id: w.id,
    productName: w.productName,
    version: w.version,
    reference: w.reference,
    notes: w.notes,
    status: w.status as WorksheetView["status"],
    fileName: w.fileName,
    contentType: w.contentType,
    sizeBytes: w.sizeBytes,
    chunkCount: w.chunkCount,
    uploadedBy: w.uploadedBy,
    uploadedByName,
    uploadedAt: w.uploadedAt.toISOString(),
    archivedBy: w.archivedBy,
    archivedByName: archivedByName ?? null,
    archivedAt: w.archivedAt?.toISOString() ?? null,
    archivedNote: w.archivedNote,
    batchId: w.batchId,
    batchNumber: batchNumber ?? null,
    sourceWorksheetId: w.sourceWorksheetId,
  }));
}

/** Starts an upload: records the details and how many pieces the file will
 *  come in. It isn't listed until every piece is in (completeUpload). */
export async function startUpload(input: UploadInput, actor: ActingStaff) {
  await requireManager(actor);
  const upload = orThrow(checkUpload(input));

  // Uploads abandoned part-way (a closed tab, a lost connection) are cleared
  // out after a day; their pieces go with them.
  await db
    .delete(worksheets)
    .where(and(eq(worksheets.status, "UPLOADING"), lt(worksheets.uploadedAt, sql`now() - interval '1 day'`)));

  const [row] = await db
    .insert(worksheets)
    .values({ ...upload, status: "UPLOADING", uploadedBy: actor.id })
    .returning({ id: worksheets.id, chunkCount: worksheets.chunkCount });
  return row;
}

async function pendingUpload(id: string, actor: ActingStaff) {
  const [row] = await db.select().from(worksheets).where(eq(worksheets.id, id)).limit(1);
  if (!row) throw new ApiError(404, "Worksheet not found.");
  if (row.status !== "UPLOADING") throw new ApiError(409, "That worksheet has already been uploaded.");
  if (row.uploadedBy !== actor.id) throw new ApiError(403, "Only the person uploading it can add to this upload.");
  return row;
}

/** Stores one piece of the file. Sending the same piece again replaces it,
 *  so a retry after a dropped connection is safe. */
export async function putChunk(id: string, index: number, data: Buffer, actor: ActingStaff): Promise<void> {
  await requireManager(actor);
  const upload = await pendingUpload(id, actor);
  orThrow(checkChunk(upload, index, data.byteLength));
  await db
    .insert(worksheetFileChunks)
    .values({ worksheetId: id, chunkIndex: index, data })
    .onConflictDoUpdate({
      target: [worksheetFileChunks.worksheetId, worksheetFileChunks.chunkIndex],
      set: { data },
    });
}

/**
 * Finishes an upload once every piece is in: the worksheet becomes Approved,
 * and the worksheets named in `archiveIds` — the product's previous
 * version(s) — move to Archived, noted as replaced by this one. All in one
 * transaction, so there's never a moment with both or neither approved.
 */
export async function completeUpload(id: string, archiveIds: unknown, actor: ActingStaff) {
  await requireManager(actor);
  const upload = await pendingUpload(id, actor);

  const [{ pieces, bytes }] = await db
    .select({
      pieces: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${worksheetFileChunks.data})), 0)::int`,
    })
    .from(worksheetFileChunks)
    .where(eq(worksheetFileChunks.worksheetId, id));
  if (pieces !== upload.chunkCount || bytes !== upload.sizeBytes) {
    throw new ApiError(422, "Part of the file is missing — try uploading it again.");
  }

  const replacing = Array.isArray(archiveIds) ? archiveIds.filter((x): x is string => typeof x === "string") : [];

  await db.transaction(async (tx) => {
    await tx.update(worksheets).set({ status: "APPROVED", uploadedAt: new Date() }).where(eq(worksheets.id, id));
    if (replacing.length > 0) {
      await tx
        .update(worksheets)
        .set({
          status: "ARCHIVED",
          archivedBy: actor.id,
          archivedAt: new Date(),
          archivedNote: `Replaced by version ${upload.version}`,
        })
        .where(and(inArray(worksheets.id, replacing), eq(worksheets.status, "APPROVED")));
    }
  });
}

/** Moves a worksheet to Archived (with an optional note) or back to
 *  Approved — restoring clears the archive details. */
export async function moveWorksheet(id: string, to: unknown, note: unknown, actor: ActingStaff): Promise<void> {
  await requireManager(actor);
  const [row] = await db.select({ status: worksheets.status }).from(worksheets).where(eq(worksheets.id, id)).limit(1);
  if (!row) throw new ApiError(404, "Worksheet not found.");
  const target = orThrow(checkMove(row.status, to));
  const archivedNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;

  await db
    .update(worksheets)
    .set(
      target === "ARCHIVED"
        ? { status: "ARCHIVED", archivedBy: actor.id, archivedAt: new Date(), archivedNote }
        : { status: "APPROVED", archivedBy: null, archivedAt: null, archivedNote: null },
    )
    .where(eq(worksheets.id, id));
}

/** One piece of a finished worksheet's file — anyone signed in. */
export async function getChunk(id: string, index: number): Promise<{ data: Buffer; contentType: string }> {
  const [row] = await db
    .select({ data: worksheetFileChunks.data, status: worksheets.status, contentType: worksheets.contentType })
    .from(worksheetFileChunks)
    .innerJoin(worksheets, eq(worksheets.id, worksheetFileChunks.worksheetId))
    .where(and(eq(worksheetFileChunks.worksheetId, id), eq(worksheetFileChunks.chunkIndex, index)))
    .limit(1);
  if (!row || row.status === "UPLOADING") throw new ApiError(404, "File not found.");
  return { data: row.data, contentType: row.contentType };
}

export interface AccessEntry {
  staffId: string;
  name: string;
  role: string;
  department: string | null;
  hasAccess: boolean;
}

/** Everyone active, and whether they can upload and move worksheets — for
 *  an admin deciding who gets access. */
export async function listAccess(actor: ActingStaff): Promise<AccessEntry[]> {
  orThrow(canGrantWorksheetAccess(actor), 403);
  const rows = await db
    .select({
      staffId: staff.id,
      name: staff.name,
      role: staff.role,
      department: staff.department,
      editor: worksheetEditors.staffId,
    })
    .from(staff)
    .leftJoin(worksheetEditors, eq(worksheetEditors.staffId, staff.id))
    .where(eq(staff.isActive, true))
    .orderBy(asc(staff.name));
  return rows.map(({ editor, ...rest }) => ({ ...rest, hasAccess: rest.role === "admin" || editor !== null }));
}

export async function setAccess(staffId: unknown, allowed: unknown, actor: ActingStaff): Promise<void> {
  orThrow(canGrantWorksheetAccess(actor), 403);
  if (typeof staffId !== "string" || typeof allowed !== "boolean") {
    throw new ApiError(422, "Say who, and whether they should have access.");
  }
  const [person] = await db.select({ id: staff.id }).from(staff).where(eq(staff.id, staffId)).limit(1);
  if (!person) throw new ApiError(404, "No such person.");

  if (allowed) {
    await db.insert(worksheetEditors).values({ staffId, grantedBy: actor.id }).onConflictDoNothing();
  } else {
    await db.delete(worksheetEditors).where(eq(worksheetEditors.staffId, staffId));
  }
}
