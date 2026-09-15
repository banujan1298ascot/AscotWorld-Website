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
