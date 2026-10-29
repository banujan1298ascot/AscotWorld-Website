// pdf.js's worker module ships without its own types. All the server needs
// from it is the handler it hands to pdf.js — see readPdfText in generate.ts.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
