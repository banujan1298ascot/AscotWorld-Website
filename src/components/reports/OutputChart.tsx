"use client";

import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Skeleton } from "@/components/ui";
import { useOutputReport, type OutputRange } from "@/lib/productionReport";

const RANGES: { value: OutputRange; label: string; caption: string }[] = [
  { value: "week", label: "Week", caption: "Last 7 days" },
  { value: "month", label: "Month", caption: "Last 30 days" },
  { value: "year", label: "Year", caption: "Last 12 months" },
];

function tickLabel(key: string, range: OutputRange): string {
  if (range === "year") return format(parseISO(`${key}-01`), "MMM");
  const day = parseISO(key);
  return range === "week" ? format(day, "EEE") : format(day, "d MMM");
}

function tooltipLabel(key: string, range: OutputRange): string {
  return range === "year" ? format(parseISO(`${key}-01`), "MMMM yyyy") : format(parseISO(key), "EEE d MMM yyyy");
}

export function SegmentedRange({ value, onChange }: { value: OutputRange; onChange: (range: OutputRange) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Chart range"
      className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] p-0.5"
    >
      {RANGES.map((range) => {
        const active = range.value === value;
        return (
          <button
            key={range.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(range.value)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-colors duration-150 ${
              active
                ? "bg-[var(--foreground)] text-[var(--background)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}

/** Batches made — forwarded out of Warehouse — over a week, month or year,
 *  with batches started (confirmed) alongside for context. */
export function OutputChart({
  departmentId,
  range,
  onRangeChange,
  className = "",
  style,
}: {
  departmentId: string | undefined;
  range: OutputRange;
  onRangeChange: (range: OutputRange) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { data, error, ready, loading } = useOutputReport(departmentId, range);
  const caption = RANGES.find((r) => r.value === range)?.caption;
  const points = data?.points.map((p) => ({ ...p, label: tickLabel(p.key, data.range) })) ?? [];

  return (
    <Card interactive className={`flex flex-col ${className}`} style={style}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold">Batches made</h2>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{caption} · finished out of Warehouse</p>
        </div>
        <SegmentedRange value={range} onChange={onRangeChange} />
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tabular-nums">{data ? data.totalMade : "—"}</span>
          <span className="text-xs font-semibold text-[var(--muted-foreground)]">made</span>
          {data && data.changePct !== null ? (
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                data.changePct >= 0
                  ? "bg-[var(--status-released-bg)] text-[var(--status-released)]"
                  : "bg-[var(--danger-bg)] text-[var(--danger)]"
              }`}
            >
              {data.changePct >= 0 ? <ArrowUpRight size={11} weight="bold" /> : <ArrowDownRight size={11} weight="bold" />}
              {Math.abs(data.changePct)}% vs previous
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-semibold text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-4 rounded-full bg-[var(--primary)]" />
            Made
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-[var(--muted-foreground)]" />
            Started
          </span>
        </div>
      </div>

      <div className={`mt-2 min-h-[220px] flex-1 transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
        {error && !data ? (
          <p className="py-10 text-center text-sm font-semibold text-[var(--danger)]">{error}</p>
        ) : !ready ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={points} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={14}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={40}
                domain={[0, (max: number) => Math.max(max, 4)]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  boxShadow: "var(--shadow-raised)",
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--muted-foreground)", fontWeight: 600, marginBottom: 2 }}
                itemStyle={{ color: "var(--foreground)", fontWeight: 700 }}
                labelFormatter={(_, payload) => {
                  const key = payload?.[0]?.payload?.key as string | undefined;
                  return key && data ? tooltipLabel(key, data.range) : "";
                }}
                formatter={(value, name) => [`${value} batch${value === 1 ? "" : "es"}`, name === "made" ? "Made" : "Started"]}
              />
              <Line
                type="monotone"
                dataKey="started"
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: "var(--muted-foreground)" }}
                animationDuration={700}
              />
              <Line
                type="monotone"
                dataKey="made"
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={range === "year" || range === "week" ? { r: 3, fill: "var(--primary)", strokeWidth: 0 } : false}
                activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
                animationDuration={900}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
