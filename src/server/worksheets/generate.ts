/**
 * Generating a batch's worksheet: when Check 1 confirms a batch, the
 * approved worksheet for its product (./matching.ts) is copied and the copy
 * filled in with the batch number, manufacture and expiry dates, quantity
 * and pack size (./fill.ts works out where). The copy is saved as a
 * GENERATED worksheet tied to the batch; the approved master is only ever
 * read, never changed.
 *
 * PDF worksheets only for now — Word and Excel ones are reported as not
 * fillable rather than guessed at.
 */
import { asc, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { roleCan } from "@/lib/types";
import { WORKSHEET_CHUNK_BYTES, chunkCountFor, fileExtension } from "@/lib/worksheetRules";
import { formatPack } from "@/lib/products";
import { ApiError } from "../apiError";
import type { ActingStaff } from "../actingStaff";
import { db } from "../db/client";
import { batchRecords, staff, worksheetFileChunks, worksheets } from "../db/schema";
import { FIELD_LABELS, planFill, type FillField, type FillValues, type TextItem } from "./fill";
import { batchProductOf, pickWorksheet } from "./matching";
import { mayManageWorksheets } from "./service";

export type GenerateResult =
  | {
      status: "generated";
      worksheetId: string;
      fileName: string;
      sourceFileName: string;
      sourceVersion: string;
      /** Fields written onto the worksheet itself. */
      filled: string[];
      /** Fields the worksheet had no blank for — they're still in the
       *  summary line at the top of page 1. */
      notFound: string[];
    }
  | { status: "no-match" | "unsupported" | "failed"; message: string };

/** Ink for everything written onto the copy — a print-blue, so filled-in
 *  values stand apart from the master's own black. */
const INK = rgb(0.05, 0.2, 0.6);

/** The standard PDF fonts only cover Western European characters. */
const printable = (text: string) => text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "-");

const ukDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

async function readPdfText(bytes: Uint8Array): Promise<TextItem[][]> {
  // The legacy build is the one that runs under Node. Its worker runs in
  // this same process; handing pdf.js the worker's code directly means it
  // never has to find the worker file at run time, which it can't once the
  // server code is bundled.
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  const scope = globalThis as { pdfjsWorker?: typeof worker };
  scope.pdfjsWorker ??= worker;
  const task = pdfjs.getDocument({
    data: bytes,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    disableFontFace: true,
    useSystemFonts: false,
  });
  try {
    const doc = await task.promise;
    const pages: TextItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items
          .filter((item): item is Extract<typeof item, { str: string }> => "str" in item && item.str.trim() !== "")
          .map((item) => ({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: Math.abs(item.transform[3]) || item.height,
          })),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function readFile(worksheetId: string): Promise<Buffer> {
  const chunks = await db
    .select({ data: worksheetFileChunks.data })
    .from(worksheetFileChunks)
    .where(eq(worksheetFileChunks.worksheetId, worksheetId))
    .orderBy(asc(worksheetFileChunks.chunkIndex));
  return Buffer.concat(chunks.map((c) => c.data));
}

function drawLine(page: ReturnType<PDFDocument["getPages"]>[number], font: PDFFont, text: string, x: number, y: number, size: number) {
  page.drawText(printable(text), { x, y, size, font, color: INK });
}

/**
 * Generates the worksheet for a confirmed batch. Never throws for "no
 * worksheet to use" — that comes back as a result for the Batch Book to
 * show — only for a request it must refuse (permission, unconfirmed batch).
 */
export async function generateWorksheetForBatch(batchId: string, actor: ActingStaff): Promise<GenerateResult> {
  if (!roleCan(actor.role, "batchbook.confirm") && !(await mayManageWorksheets(actor))) {
    throw new ApiError(403, "Only Batch Book entry or people with worksheet access can generate worksheets.");
  }
  const [batch] = await db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).limit(1);
  if (!batch) throw new ApiError(404, "Batch not found.");
  if (!batch.batchNumber) throw new ApiError(422, "Confirm the batch first — the worksheet needs its batch number.");

  const product = batchProductOf(batch);
  const productLabel = batch.productName ?? product?.medicineName ?? "this product";
  if (!product) return { status: "no-match", message: "The batch has no product name to find a worksheet by." };

  const approved = await db.select().from(worksheets).where(eq(worksheets.status, "APPROVED"));
  const source = pickWorksheet(product, approved);
  if (!source) {
    return {
      status: "no-match",
      message: `No approved worksheet matches ${productLabel} — its product name or file name needs the name, strength and type.`,
    };
  }
  if (fileExtension(source.fileName) !== "pdf") {
    return {
      status: "unsupported",
      message: `The approved worksheet for ${productLabel} (${source.fileName}) is a Word or Excel file — only PDF worksheets can be filled in so far.`,
    };
  }

  const values: FillValues = {
    batchNumber: batch.batchNumber,
    manufactureDate: batch.plannedManufactureDate,
    expiryDate: batch.expiryDate,
    quantity: batch.quantity ? String(Number(batch.quantity)) : null,
    packSize: batch.packSize ? String(Number(batch.packSize)) : null,
  };

  let output: Uint8Array;
  let placed: Record<FillField, number>;
  try {
    const original = await readFile(source.id);
    const textPages = await readPdfText(new Uint8Array(original));
    const doc = await PDFDocument.load(original, { updateMetadata: false });
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();

    const plan = planFill(textPages, values, (text, size) => bold.widthOfTextAtSize(printable(text), size));
    placed = plan.placed;
    for (const d of plan.draws) {
      if (pages[d.page]) drawLine(pages[d.page], bold, d.text, d.x, d.y, d.size);
    }

    const [person] = await db.select({ name: staff.name }).from(staff).where(eq(staff.id, actor.id)).limit(1);
    const today = new Date().toISOString().slice(0, 10);
    const quantity = values.quantity ? `${values.quantity} ${batch.unit ?? ""}`.trim() : "—";
    const pack = formatPack(batch.packSize, batch.packUnit) ?? "—";
    pages.forEach((page, i) => {
      const box = page.getCropBox();
      if (i === 0) {
        // Everything on one line too, in case a blank wasn't found.
        drawLine(
          page,
          bold,
          `Batch ${values.batchNumber}   |   Mfd ${ukDate(values.manufactureDate)}   |   Exp ${ukDate(values.expiryDate)}   |   Qty ${quantity}   |   Pack ${pack}`,
          box.x + 14,
          box.y + box.height - 9,
          7,
        );
      }
      drawLine(
        page,
        regular,
        `GENERATED COPY for batch ${values.batchNumber} from ${source.fileName.slice(0, 70)} (version ${source.version}) on ${ukDate(today)} by ${person?.name ?? actor.id}. The approved worksheet is unchanged.`,
        box.x + 14,
        box.y + 4,
        5.5,
      );
    });
    output = await doc.save();
  } catch (err) {
    return {
      status: "failed",
      message: `Couldn't fill in ${source.fileName}: ${err instanceof Error ? err.message : "the PDF couldn't be read"}.`,
    };
  }

  const fields = Object.keys(FIELD_LABELS) as FillField[];
  const wanted = fields.filter((f) => (f === "batchNumber" ? true : values[f] !== null));
  const filled = wanted
    .filter((f) => placed[f] > 0)
    .map((f) => (f === "batchNumber" && placed[f] > 1 ? `${FIELD_LABELS[f]} (${placed[f]} places)` : FIELD_LABELS[f]));
  const notFound = wanted.filter((f) => placed[f] === 0).map((f) => FIELD_LABELS[f]);
  const missingFromBatch = fields.filter((f) => f !== "batchNumber" && values[f] === null).map((f) => FIELD_LABELS[f]);

  const notes = [
    filled.length ? `Filled in: ${filled.join(", ")}.` : "No blanks found to fill in.",
    notFound.length ? `No blank found for: ${notFound.join(", ")} — shown in the line at the top of page 1.` : "",
    missingFromBatch.length ? `Not in the Batch Book: ${missingFromBatch.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const fileName = `${batch.batchNumber} - ${source.fileName}`.slice(0, 255);
  const buffer = Buffer.from(output);
  const chunkCount = chunkCountFor(buffer.byteLength);

  const worksheetId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(worksheets)
      .values({
        productName: batch.productName ?? source.productName,
        version: source.version,
        reference: source.reference,
        notes,
        status: "GENERATED",
        fileName,
        contentType: "application/pdf",
        sizeBytes: buffer.byteLength,
        chunkCount,
        uploadedBy: actor.id,
        batchId: batch.id,
        sourceWorksheetId: source.id,
      })
      .returning({ id: worksheets.id });
    for (let i = 0; i < chunkCount; i++) {
      await tx.insert(worksheetFileChunks).values({
        worksheetId: row.id,
        chunkIndex: i,
        data: buffer.subarray(i * WORKSHEET_CHUNK_BYTES, (i + 1) * WORKSHEET_CHUNK_BYTES),
      });
    }
    return row.id;
  });

  return {
    status: "generated",
    worksheetId,
    fileName,
    sourceFileName: source.fileName,
    sourceVersion: source.version,
    filled,
    notFound,
  };
}

