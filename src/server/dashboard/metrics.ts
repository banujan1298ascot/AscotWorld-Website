/**
 * Pure computation for the production dashboard (spec 4.2) — filling gap
 * days in a throughput series, rate percentages, and CSV formatting for the
 * export. Kept separate from service.ts (which does the actual SQL) so this
 * arithmetic is unit-testable without a database.
 */

export interface DailyCount {
  /** 'YYYY-MM-DD' */
  day: string;
  count: number;
}

export interface ThroughputDay {
  date: string;
  confirmed: number;
  completed: number;
  failed: number;
}

/**
 * Merges three sparse per-day count queries (confirmed/completed/failed —
 * a day with no batches simply has no row) into one dense series covering
 * exactly the last `days` days including today, with explicit zeros for
 * days that had no activity — what a trend chart actually needs to render.
 */
export function buildThroughputSeries(
  days: number,
  confirmed: DailyCount[],
  completed: DailyCount[],
  failed: DailyCount[],
  today: Date = new Date(),
): ThroughputDay[] {
  const confirmedByDay = new Map(confirmed.map((r) => [r.day, r.count]));
  const completedByDay = new Map(completed.map((r) => [r.day, r.count]));
  const failedByDay = new Map(failed.map((r) => [r.day, r.count]));

  const series: ThroughputDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({
      date: key,
      confirmed: confirmedByDay.get(key) ?? 0,
      completed: completedByDay.get(key) ?? 0,
      failed: failedByDay.get(key) ?? 0,
    });
  }
  return series;
}

/** Percentage to one decimal place, or null when there's no sample to rate
 *  (an empty denominator is "no data", not "0%" — a chart should show a
 *  dash, not a misleadingly confident zero). */
export function computeRatePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export interface BatchExportRow {
  batchNumber: string | null;
  batchType: string;
  departmentName: string;
  productName: string | null;
  quantity: string | null;
  unit: string | null;
  status: string;
  currentStageName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  createdByName: string;
  confirmedByName: string | null;
}

const CSV_HEADERS = [
  "Batch number",
  "Type",
  "Department",
  "Product",
  "Quantity",
  "Unit",
  "Status",
  "Current stage",
  "Created at",
  "Confirmed at",
  "Created by",
  "Confirmed by",
];

/** Quotes a field only when it needs it (contains a comma, quote, or
 *  newline) — RFC 4180. */
function csvField(value: string | null): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CRLF row endings per RFC 4180 — the format Excel and most compliance
 *  tooling expect for CSV import. */
export function formatBatchesCsv(rows: BatchExportRow[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.batchNumber,
        r.batchType,
        r.departmentName,
        r.productName,
        r.quantity,
        r.unit,
        r.status,
        r.currentStageName,
        r.createdAt,
        r.confirmedAt,
        r.createdByName,
        r.confirmedByName,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/* ============================================================================
 * Production report page — batches-made chart and product timing search
 * ========================================================================= */

export type OutputRange = "week" | "month" | "year";

export const OUTPUT_RANGES: readonly OutputRange[] = ["week", "month", "year"];

export function isOutputRange(value: unknown): value is OutputRange {
  return typeof value === "string" && (OUTPUT_RANGES as readonly string[]).includes(value);
}

export interface OutputWindow {
  /** Whether each point on the chart is a day ('YYYY-MM-DD') or a month
   *  ('YYYY-MM'). */
  bucket: "day" | "month";
  /** Every bucket in the window, oldest first — including empty ones. */
  keys: string[];
  /** Inclusive UTC start of the window. */
  start: Date;
  /** Inclusive UTC start of the equally long window just before it, for the
   *  "vs last period" comparison. */
  previousStart: Date;
}

function utcDay(date: Date, offsetDays = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsetDays));
}

function utcMonth(date: Date, offsetMonths = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
}

/**
 * The span one chart range covers, ending today: the last 7 days or 30 days
 * a day at a time, or the last 12 calendar months a month at a time. Rolling
 * windows rather than "this calendar week/month" so the line never starts
 * the period nearly empty on the 1st.
 */
export function outputWindow(range: OutputRange, today: Date = new Date()): OutputWindow {
  if (range === "year") {
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) keys.push(utcMonth(today, -i).toISOString().slice(0, 7));
    return { bucket: "month", keys, start: utcMonth(today, -11), previousStart: utcMonth(today, -23) };
  }
  const days = range === "week" ? 7 : 30;
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(utcDay(today, -i).toISOString().slice(0, 10));
  return { bucket: "day", keys, start: utcDay(today, -(days - 1)), previousStart: utcDay(today, -(2 * days - 1)) };
}

export interface BucketCount {
  /** 'YYYY-MM-DD' or 'YYYY-MM', matching the window's bucket. */
  bucket: string;
  count: number;
}

export interface OutputPoint {
  key: string;
  /** Batches forwarded out of the last stage — actually finished. */
  made: number;
  /** Batches confirmed in the Batch Book — work started. */
  started: number;
}

/** Lays sparse per-bucket counts onto every bucket in the window, with
 *  explicit zeros — a line chart needs a point for quiet days too. */
export function buildOutputSeries(keys: string[], made: BucketCount[], started: BucketCount[]): OutputPoint[] {
  const madeBy = new Map(made.map((r) => [r.bucket, r.count]));
  const startedBy = new Map(started.map((r) => [r.bucket, r.count]));
  return keys.map((key) => ({ key, made: madeBy.get(key) ?? 0, started: startedBy.get(key) ?? 0 }));
}

/** Percentage change from the previous period, or null when there's nothing
 *  to compare against (a rise from zero isn't a meaningful percentage). */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Turns a free-text search like "amox 500" into ILIKE patterns — every word
 * must appear somewhere in the product name, in any order, so "500mg
 * paracetamol" still finds "Paracetamol 500mg Tablets". LIKE's own wildcards
 * are escaped so a typed "%" or "_" matches literally.
 */
export function productSearchPatterns(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  return [...new Set(words)].slice(0, 6).map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

export type TimingConfidence = "none" | "early" | "building" | "reliable";

/**
 * How much to trust an average built from `sampleSize` finished batches. The
 * report starts empty and fills in as staff use the MES, so the page says
 * plainly when a figure rests on one or two batches rather than presenting
 * it with the same weight as one built on dozens.
 */
export function timingConfidence(sampleSize: number): TimingConfidence {
  if (sampleSize <= 0) return "none";
  if (sampleSize < 3) return "early";
  if (sampleSize < 10) return "building";
  return "reliable";
}
