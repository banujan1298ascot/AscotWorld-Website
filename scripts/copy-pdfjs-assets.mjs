/**
 * Copies the files pdf.js loads on demand — image decoders (JBIG2 for
 * scanned black-and-white pages, JPEG 2000), colour profiles, standard
 * fonts and character maps — from the installed pdfjs-dist into
 * public/pdfjs/, where the worksheet viewer points pdf.js at them
 * (src/components/worksheets/WorksheetPreview.tsx). Without them a scanned
 * worksheet's pages come out blank.
 *
 * Runs before `dev` and `build`, so the copies always match the installed
 * version; public/pdfjs/ isn't committed.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

if (!existsSync(source)) {
  console.warn("pdfjs-dist isn't installed — skipping the viewer's pdf.js files.");
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const folder of ["wasm", "iccs", "standard_fonts", "cmaps"]) {
  cpSync(join(source, folder), join(target, folder), {
    recursive: true,
    // quickjs-eval runs scripts embedded in PDFs — the viewer never does that.
    filter: (file) => !/quickjs/i.test(file),
  });
}
console.log("Copied pdf.js decoders, fonts and character maps to public/pdfjs/.");
