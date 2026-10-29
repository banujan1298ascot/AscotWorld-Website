"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  DownloadSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from "@phosphor-icons/react/dist/ssr";
import { Button, ErrorNotice, Skeleton } from "@/components/ui";
import { fileExtension, formatFileSize } from "@/lib/worksheetRules";
import { downloadWorksheetFile, type Worksheet } from "@/lib/worksheets";

/**
 * Views a worksheet inside the portal, so nobody has to download it to read
 * it. Each file type gets its own renderer, loaded only when needed:
 *
 *  - PDF — drawn page by page with pdf.js. Not the browser's own viewer:
 *    tablets and phones (Chrome on Android especially) won't show a PDF
 *    inside a page at all.
 *  - Word (.docx) — laid out as pages with docx-preview.
 *  - Excel (.xlsx, .xls) — each sheet as a table, read with SheetJS.
 *
 * Old-style Word .doc files can't be read in the browser, so those offer
 * the download instead.
 */

type Kind = "pdf" | "docx" | "sheet" | "unsupported";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** One click of a zoom button, or Ctrl + / Ctrl −. */
const ZOOM_STEP = 1.25;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

function kindOf(worksheet: Worksheet): Kind {
  const ext = fileExtension(worksheet.fileName);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx" || ext === "xls") return "sheet";
  return "unsupported";
}

export function WorksheetPreview({
  staffId,
  worksheet,
  onClose,
  onDownload,
}: {
  staffId: string;
  worksheet: Worksheet;
  onClose: () => void;
  onDownload: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const kind = kindOf(worksheet);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  /** Where the zoom was centred — the point under the mouse, or the middle
   *  of the view — as a fraction across the zoomed content
   *  (`[data-zoom-target]`), so that same spot of the worksheet can be put
   *  back under it once the new size is laid out. */
  const anchorRef = useRef<{ fx: number; fy: number; clientX: number; clientY: number } | null>(null);

  const zoomTo = useCallback((next: number, at?: { clientX: number; clientY: number }) => {
    const scroller = scrollRef.current;
    const to = clampZoom(next);
    if (!scroller || to === zoomRef.current) return;
    const target = scroller.querySelector<HTMLElement>("[data-zoom-target]");
    if (target) {
      const view = scroller.getBoundingClientRect();
      const clientX = at ? at.clientX : view.left + view.width / 2;
      const clientY = at ? at.clientY : view.top + view.height / 2;
      const rect = target.getBoundingClientRect();
      anchorRef.current = {
        fx: (clientX - rect.left) / Math.max(1, rect.width),
        fy: (clientY - rect.top) / Math.max(1, rect.height),
        clientX,
        clientY,
      };
    }
    zoomRef.current = to;
    setZoom(to);
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const anchor = anchorRef.current;
    const target = scroller?.querySelector<HTMLElement>("[data-zoom-target]");
    anchorRef.current = null;
    if (!scroller || !anchor || !target) return;
    const rect = target.getBoundingClientRect();
    scroller.scrollLeft += rect.left + anchor.fx * rect.width - anchor.clientX;
    scroller.scrollTop += rect.top + anchor.fy * rect.height - anchor.clientY;
  }, [zoom]);

  // Ctrl + scroll (or a trackpad pinch, which browsers send the same way)
  // zooms the worksheet instead of the whole page. A wheel notch is about
  // 25%; a pinch moves in small, smooth steps.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      zoomTo(zoomRef.current * Math.exp(-delta * 0.0022), e);
    }
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (kind === "unsupported") return;
    let cancelled = false;
    downloadWorksheetFile(staffId, worksheet)
      .then((file) => {
        if (!cancelled) setBlob(file);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load this worksheet.");
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, worksheet, kind]);

  function openInTab() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const zoomable = kind !== "unsupported";

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Preview of ${worksheet.fileName}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // Ctrl + / − / 0 zoom the worksheet rather than the browser page.
        if (!zoomable || (!e.ctrlKey && !e.metaKey)) return;
        if (e.key === "=" || e.key === "+") zoomTo(zoomRef.current * ZOOM_STEP);
        else if (e.key === "-") zoomTo(zoomRef.current / ZOOM_STEP);
        else if (e.key === "0") zoomTo(1);
        else return;
        e.preventDefault();
      }}
      className="m-auto flex h-[min(92dvh,1100px)] w-[min(78rem,calc(100vw-1rem))] max-w-none flex-col overflow-hidden rounded-lg
        border border-[var(--border)] bg-[var(--surface)] p-0 text-foreground shadow-[var(--shadow-overlay)]
        backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-extrabold tracking-tight">
            {worksheet.productName} <span className="text-[var(--muted-foreground)]">· version {worksheet.version}</span>
          </h2>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {[worksheet.reference, worksheet.fileName, formatFileSize(worksheet.sizeBytes)].filter(Boolean).join(" · ")}
            {worksheet.status === "ARCHIVED" ? " · Archived — not the version in use" : ""}
          </p>
        </div>
        {zoomable ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => zoomTo(zoom / ZOOM_STEP)}
            >
              <MagnifyingGlassMinus size={16} weight="bold" />
            </Button>
            <button
              type="button"
              onClick={() => zoomTo(1)}
              title="Back to fit width (Ctrl + 0). Ctrl + scroll to zoom."
              className="w-12 cursor-pointer rounded py-1 text-center text-xs font-semibold tabular-nums text-[var(--muted-foreground)] hover:bg-[var(--surface-sunken)] hover:text-foreground"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => zoomTo(zoom * ZOOM_STEP)}
            >
              <MagnifyingGlassPlus size={16} weight="bold" />
            </Button>
          </div>
        ) : null}
        {kind === "pdf" ? (
          <Button size="sm" variant="secondary" disabled={!blob} onClick={openInTab}>
            <ArrowSquareOut size={15} weight="bold" />
            New tab
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onDownload}>
          <DownloadSimple size={15} weight="bold" />
          Download
        </Button>
        <Button size="sm" variant="ghost" aria-label="Close preview" onClick={onClose}>
          <X size={18} weight="bold" />
        </Button>
      </header>

      {worksheet.status === "ARCHIVED" ? (
        <p className="border-b border-[var(--border)] bg-[var(--status-qa-bg)] px-4 py-1.5 text-xs font-semibold text-[var(--status-qa)]">
          This is an archived version{worksheet.archivedNote ? ` — ${worksheet.archivedNote}` : ""}. Use the approved
          worksheet for production.
        </p>
      ) : null}

      <div
        ref={scrollRef}
        data-preview-scroll
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[var(--surface-sunken)]"
      >
        {kind === "unsupported" ? (
          <div className="mx-auto max-w-md px-6 py-16 text-center">
            <p className="text-sm font-bold">This file can&apos;t be previewed here</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Older Word files (.doc) can&apos;t be opened in a browser. Download it to view it — or upload it as a PDF
              or .docx so everyone can preview it.
            </p>
            <Button className="mt-4" variant="primary" onClick={onDownload}>
              <DownloadSimple size={15} weight="bold" />
              Download
            </Button>
          </div>
        ) : loadError ? (
          <div className="p-4">
            <ErrorNotice message={loadError} />
          </div>
        ) : !blob ? (
          <div className="mx-auto grid max-w-3xl gap-3 p-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-[60vh] w-full" />
          </div>
        ) : kind === "pdf" ? (
          <PdfView blob={blob} zoom={zoom} />
        ) : kind === "docx" ? (
          <DocxView blob={blob} zoom={zoom} />
        ) : (
          <SheetView blob={blob} zoom={zoom} />
        )}
      </div>
    </dialog>
  );
}

/* -------------------------------------------------------------------------- */

function RenderError({ message }: { message: string }) {
  return (
    <div className="p-4">
      <ErrorNotice message={message} />
    </div>
  );
}

/** Sharpest a page is drawn: big enough for any zoom on a 2x screen, and
 *  under the canvas limit phones and tablets enforce. */
const MAX_PAGE_PIXELS = 8_000_000;
/** Pages out of view are kept at a lower resolution, so a long BMR zoomed
 *  right in doesn't hold every page at full size in memory. */
const OFFSCREEN_PAGE_PIXELS = 1_500_000;

interface PdfPage {
  page: import("pdfjs-dist").PDFPageProxy;
  wrapper: HTMLDivElement;
  /** Scale that fits the window's width at 100% zoom. */
  fit: number;
  /** The PDF's own page size. */
  baseWidth: number;
  baseHeight: number;
  /** The scale it was last drawn at (0 = not yet). */
  rendered: number;
  visible: boolean;
}

/**
 * Every page of a PDF, fitted to the window's width. Zooming only changes
 * the pages' CSS size (the `--pdf-zoom` variable), so it's instant however
 * fast the wheel turns; once zooming stops, the pages on screen are redrawn
 * sharp at the new size, and pages scrolled into view later catch up as
 * they appear.
 */
function PdfView({ blob, zoom }: { blob: Blob; zoom: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const redrawRef = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    containerRef.current?.style.setProperty("--pdf-zoom", String(zoom));
    const settle = window.setTimeout(() => redrawRef.current(), 180);
    return () => window.clearTimeout(settle);
  }, [zoom]);

  useEffect(() => {
    const container = containerRef.current;
    const scroller = container?.closest<HTMLElement>("[data-preview-scroll]");
    if (!container || !scroller) return;
    let cancelled = false;
    let observer: IntersectionObserver | undefined;
    let destroy: (() => void) | undefined;
    const pages: PdfPage[] = [];
    let drawing = false;
    let drawAgain = false;

    /** Draws each page whose resolution is off for its zoom and whether it's
     *  on screen — pages in view first. One page at a time; a request that
     *  comes in meanwhile starts a fresh pass once the current page is done. */
    async function redraw() {
      if (drawing) {
        drawAgain = true;
        return;
      }
      drawing = true;
      try {
        do {
          drawAgain = false;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const order = [...pages].sort((a, b) => Number(b.visible) - Number(a.visible));
          for (const p of order) {
            if (cancelled) return;
            const cap = p.visible ? MAX_PAGE_PIXELS : OFFSCREEN_PAGE_PIXELS;
            const want = Math.min(p.fit * zoomRef.current * ratio, Math.sqrt(cap / (p.baseWidth * p.baseHeight)));
            if (p.rendered && Math.abs(p.rendered - want) / want < 0.15) continue;

            const viewport = p.page.getViewport({ scale: want });
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.className = "block h-full w-full";
            await p.page.render({ canvas, viewport }).promise;
            if (cancelled) return;
            // Swap in the new drawing only once it's finished — no blank flash.
            const old = p.wrapper.querySelector("canvas");
            p.wrapper.replaceChildren(canvas);
            if (old) old.width = 0;
            p.rendered = want;
            if (drawAgain) break;
          }
        } while (drawAgain && !cancelled);
      } finally {
        drawing = false;
      }
    }
    redrawRef.current = () => void redraw().catch(() => {});

    (async () => {
      const pdfjs = await import("pdfjs-dist");
      if (!pdfjs.GlobalWorkerOptions.workerPort) {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
          { type: "module" },
        );
      }
      const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
      destroy = () => void task.destroy();
      const pdf = await task.promise;
      if (cancelled) return;
      setPageCount(pdf.numPages);

      container.replaceChildren();
      const available = Math.max(320, scroller.clientWidth - 32);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const p = pages.find((x) => x.wrapper === entry.target);
            if (p) p.visible = entry.isIntersecting;
          }
          redrawRef.current();
        },
        { root: scroller, rootMargin: "50% 0px" },
      );

      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const fit = Math.min(available / base.width, 1.6);
        const wrapper = document.createElement("div");
        wrapper.className = "mx-auto mb-4 bg-white shadow-md";
        wrapper.style.width = `calc(${base.width * fit}px * var(--pdf-zoom))`;
        wrapper.style.height = `calc(${base.height * fit}px * var(--pdf-zoom))`;
        wrapper.setAttribute("role", "img");
        wrapper.setAttribute("aria-label", `Page ${n} of ${pdf.numPages}`);
        container.appendChild(wrapper);
        pages.push({ page, wrapper, fit, baseWidth: base.width, baseHeight: base.height, rendered: 0, visible: n <= 2 });
        observer.observe(wrapper);
      }
      redrawRef.current();
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? `Couldn't show this PDF: ${err.message}` : "Couldn't show this PDF.");
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      redrawRef.current = () => {};
      destroy?.();
    };
  }, [blob]);

  if (error) return <RenderError message={error} />;
  return (
    // As wide as the widest page once zoomed past the window, so it scrolls
    // sideways instead of cutting the page off.
    <div className="w-max min-w-full px-4 py-4">
      {pageCount ? (
        <p className="mb-2 text-center text-xs font-semibold text-[var(--muted-foreground)]">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </p>
      ) : null}
      <div ref={containerRef} data-zoom-target className="mx-auto w-max" />
    </div>
  );
}

/** A Word document laid out as pages — at their real size, scaled down to
 *  fit the window (like the PDF), then by `zoom`. */
function DocxView({ blob, zoom }: { blob: Blob; zoom: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const outer = outerRef.current;
    if (!container || !outer) return;
    let cancelled = false;
    (async () => {
      const { renderAsync } = await import("docx-preview");
      if (cancelled) return;
      container.replaceChildren();
      await renderAsync(blob, container, container, {
        inWrapper: true,
        breakPages: true,
        useBase64URL: true,
        // Embedded HTML/other documents inside a .docx aren't shown — only
        // the document's own content.
        renderAltChunks: false,
      });
      // The widest page, at its natural size (undoing any zoom already on),
      // plus the 30px grey margin docx-preview puts either side.
      const pages = [...container.querySelectorAll<HTMLElement>("section")];
      const applied = Number(getComputedStyle(container.parentElement!).zoom) || 1;
      const widest = Math.max(1, ...pages.map((p) => p.getBoundingClientRect().width / applied));
      if (!cancelled) setFit(Math.min(1, (outer.clientWidth - 24) / (widest + 60)));
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? `Couldn't show this document: ${err.message}` : "Couldn't show this document.");
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (error) return <RenderError message={error} />;
  return (
    <div ref={outerRef} className="docx-preview-host">
      <div data-zoom-target className="mx-auto w-max text-black" style={{ zoom: fit * zoom }}>
        <div ref={containerRef} />
      </div>
    </div>
  );
}

/** Each sheet of a workbook as a plain table — values only, so nothing in
 *  the file is ever run or inserted as HTML. */
function SheetView({ blob, zoom }: { blob: Blob; zoom: number }) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array", cellDates: true });
      const parsed = workbook.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: true }),
      }));
      if (!cancelled) setSheets(parsed);
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? `Couldn't show this spreadsheet: ${err.message}` : "Couldn't show this spreadsheet.");
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (error) return <RenderError message={error} />;
  if (!sheets) return <Skeleton className="m-4 h-64" />;
  const sheet = sheets[active] ?? sheets[0];
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));

  return (
    <div className="flex min-h-full flex-col">
      {sheets.length > 1 ? (
        <div role="tablist" aria-label="Sheets" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 pt-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`shrink-0 cursor-pointer rounded-t-md px-3 py-1.5 text-[13px] font-semibold ${
                i === active
                  ? "bg-[var(--surface-sunken)] text-foreground"
                  : "text-[var(--muted-foreground)] hover:text-foreground"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="overflow-auto p-3">
        {sheet.rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">This sheet is empty.</p>
        ) : (
          <table data-zoom-target className="border-collapse bg-white text-[13px] text-black" style={{ zoom }}>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <th className="sticky left-0 border border-neutral-300 bg-neutral-100 px-2 py-1 text-right text-[11px] font-semibold text-neutral-500">
                    {r + 1}
                  </th>
                  {Array.from({ length: width }, (_, c) => (
                    <td key={c} className="whitespace-pre-wrap border border-neutral-300 px-2 py-1 align-top">
                      {row[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
