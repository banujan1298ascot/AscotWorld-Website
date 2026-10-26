import { describe, expect, it } from "vitest";
import { WORKSHEET_CHUNK_BYTES, WORKSHEET_MAX_BYTES, sameProduct } from "@/lib/worksheetRules";
import { canGrantWorksheetAccess, canManageWorksheets, checkChunk, checkMove, checkUpload, isWorksheetId } from "./validation";

describe("canManageWorksheets", () => {
  it("lets admins and people given access upload and move worksheets", () => {
    expect(canManageWorksheets({ id: "a", role: "admin" }, false).ok).toBe(true);
    expect(canManageWorksheets({ id: "p", role: "production" }, true).ok).toBe(true);
    expect(canManageWorksheets({ id: "q", role: "qa" }, true).ok).toBe(true);
  });

  it("refuses everyone else, whatever their role", () => {
    for (const role of ["production", "qa", "viewer"] as const) {
      expect(canManageWorksheets({ id: "x", role }, false).ok).toBe(false);
    }
  });

  it("only lets an admin grant access", () => {
    expect(canGrantWorksheetAccess({ id: "a", role: "admin" }).ok).toBe(true);
    expect(canGrantWorksheetAccess({ id: "q", role: "qa" }).ok).toBe(false);
  });
});

describe("checkUpload", () => {
  const good = { productName: " Paracetamol  500mg Tablets ", version: "4", fileName: "BMR.pdf", sizeBytes: 1000 };

  it("accepts a PDF, Word or Excel file and tidies the text", () => {
    const result = checkUpload(good);
    expect(result).toMatchObject({
      ok: true,
      value: { productName: "Paracetamol 500mg Tablets", contentType: "application/pdf", chunkCount: 1 },
    });
    expect(checkUpload({ ...good, fileName: "bmr.DOCX" }).ok).toBe(true);
    expect(checkUpload({ ...good, fileName: "bmr.xlsx" }).ok).toBe(true);
  });

  it("needs a product, a version and a file", () => {
    expect(checkUpload({ ...good, productName: "  " }).ok).toBe(false);
    expect(checkUpload({ ...good, version: "" }).ok).toBe(false);
    expect(checkUpload({ ...good, fileName: "" }).ok).toBe(false);
  });

  it("refuses other file types, empty files and anything too large", () => {
    expect(checkUpload({ ...good, fileName: "bmr.exe" }).ok).toBe(false);
    expect(checkUpload({ ...good, fileName: "bmr" }).ok).toBe(false);
    expect(checkUpload({ ...good, sizeBytes: 0 }).ok).toBe(false);
    expect(checkUpload({ ...good, sizeBytes: WORKSHEET_MAX_BYTES + 1 }).ok).toBe(false);
  });

  it("splits a large file into pieces", () => {
    const result = checkUpload({ ...good, sizeBytes: WORKSHEET_CHUNK_BYTES * 2 + 5 });
    expect(result.ok && result.value.chunkCount).toBe(3);
  });
});

describe("checkChunk", () => {
  const upload = { sizeBytes: WORKSHEET_CHUNK_BYTES * 2 + 5, chunkCount: 3 };

  it("expects full pieces, then whatever's left", () => {
    expect(checkChunk(upload, 0, WORKSHEET_CHUNK_BYTES).ok).toBe(true);
    expect(checkChunk(upload, 2, 5).ok).toBe(true);
    expect(checkChunk(upload, 0, 10).ok).toBe(false);
    expect(checkChunk(upload, 2, WORKSHEET_CHUNK_BYTES).ok).toBe(false);
  });

  it("refuses a piece out of range", () => {
    expect(checkChunk(upload, 3, 5).ok).toBe(false);
    expect(checkChunk(upload, -1, 5).ok).toBe(false);
  });
});

describe("checkMove", () => {
  it("archives approved worksheets and restores archived ones", () => {
    expect(checkMove("APPROVED", "ARCHIVED")).toEqual({ ok: true, value: "ARCHIVED" });
    expect(checkMove("ARCHIVED", "APPROVED")).toEqual({ ok: true, value: "APPROVED" });
  });

  it("refuses no-op moves, unfinished uploads and anything else", () => {
    expect(checkMove("ARCHIVED", "ARCHIVED").ok).toBe(false);
    expect(checkMove("UPLOADING", "APPROVED").ok).toBe(false);
    expect(checkMove("APPROVED", "DELETED").ok).toBe(false);
  });
});

describe("helpers", () => {
  it("matches a product whatever the case and spacing", () => {
    expect(sameProduct("Paracetamol 500mg Tablets", " paracetamol  500MG tablets")).toBe(true);
    expect(sameProduct("Paracetamol 500mg Tablets", "Paracetamol 250mg Tablets")).toBe(false);
  });

  it("only treats a UUID as a worksheet id", () => {
    expect(isWorksheetId("2f1c6b7e-3d4a-4b5c-9d8e-1a2b3c4d5e6f")).toBe(true);
    expect(isWorksheetId("../etc")).toBe(false);
  });
});
