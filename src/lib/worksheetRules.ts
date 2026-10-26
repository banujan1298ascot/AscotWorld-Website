/**
 * Rules for worksheet (BMR) files, shared by the upload form and the server
 * so both refuse the same things. Pure — no React, no DB.
 */

/** Files travel in pieces this size: one request to the hosted site can't
 *  carry more than about 4.5 MB, so each piece stays well under that. */
export const WORKSHEET_CHUNK_BYTES = 3 * 1024 * 1024;

/** Largest file accepted — the files live in the database, so keep them
 *  to the size a scanned BMR actually needs. */
export const WORKSHEET_MAX_BYTES = 25 * 1024 * 1024;

/** File types a worksheet can be: PDF, Word or Excel. */
export const WORKSHEET_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** For the file picker's `accept`. */
export const WORKSHEET_ACCEPT = Object.keys(WORKSHEET_FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** The content type to store for a file, or null if it isn't a type
 *  worksheets accept. Goes by the extension: browsers report Word and
 *  Excel types inconsistently. */
export function worksheetContentType(fileName: string): string | null {
  return WORKSHEET_FILE_TYPES[fileExtension(fileName)] ?? null;
}

export function chunkCountFor(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / WORKSHEET_CHUNK_BYTES));
}

/** "2.4 MB", "830 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Product names match whatever the case and spacing — "paracetamol 500mg
 *  tablets " is the same product as "Paracetamol 500mg Tablets". */
export function sameProduct(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}
