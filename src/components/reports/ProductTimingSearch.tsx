"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock, Hourglass, MagnifyingGlass, Timer, UsersThree, X } from "@phosphor-icons/react/dist/ssr";
import { Card, EmptyState, Skeleton } from "@/components/ui";
import {
  formatDuration,
  useProductSearch,
  useProductTiming,
  type ProductOperatorTiming,
  type ProductTiming,
  type TimingConfidence,
} from "@/lib/productionReport";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const CONFIDENCE: Record<TimingConfidence, { label: string; tone: string; bg: string }> = {
  none: { label: "No finished batches yet", tone: "var(--muted-foreground)", bg: "var(--surface-sunken)" },
  early: { label: "Early estimate", tone: "var(--warning)", bg: "var(--status-qa-bg)" },
  building: { label: "Building up", tone: "var(--status-production)", bg: "var(--status-production-bg)" },
  reliable: { label: "Reliable", tone: "var(--status-released)", bg: "var(--status-released-bg)" },
};

/**
 * Type a product and strength, pick it, and see how long it takes to make:
 * start to finish, hands-on, per stage and per operator. Starts empty on a
 * real site and firms up as finished batches accumulate — the confidence
 * badge says how much history each figure rests on.
 */
export function ProductTimingSearch({
  departmentId,
  className = "",
  style,
}: {
  departmentId: string | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debouncedQuery = useDebounced(query, 250);
  const listId = useId();

  const searching = open && query.trim().length > 0 && query !== selected;
  const search = useProductSearch(departmentId, searching ? debouncedQuery : "");
  const matches = searching ? (search.data?.products ?? []) : [];
  const settled = debouncedQuery === query && !search.loading;

  const timing = useProductTiming(departmentId, selected);

  function choose(productName: string) {
    setSelected(productName);
    setQuery(productName);
    setOpen(false);
  }

  function clear() {
    setSelected(null);
    setQuery("");
    setOpen(false);
  }

  return (
    <Card className={className} style={style}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold">Product timing</h2>
          <p className="mt-0.5 max-w-xl text-xs text-[var(--muted-foreground)]">
            How long a product takes to make, on average, and how that splits across stations and operators.
            Figures firm up as more batches are finished.
          </p>
        </div>
      </div>

      <div className="relative mt-3">
        <MagnifyingGlass
          size={17}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
        />
        <input
          type="search"
          role="combobox"
          aria-expanded={searching && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Product name and strength"
          placeholder="Product and strength, e.g. Amoxicillin 500mg"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!matches.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(matches[Math.min(highlight, matches.length - 1)].productName);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] pl-10 pr-10 text-sm
            font-semibold outline-none transition-[border-color,box-shadow] placeholder:font-normal
            placeholder:text-[var(--subtle-foreground)] focus:border-[var(--ring)] focus:shadow-[0_0_0_3px_rgb(0_117_255/0.18)]
            [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--surface)]"
          >
            <X size={14} weight="bold" />
          </button>
        ) : null}

        {searching && settled ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-overlay)]"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-3 text-sm text-[var(--muted-foreground)]">
                No product matching “{query.trim()}” has been made yet.
              </li>
            ) : (
              matches.map((match, i) => (
                <li
                  key={match.productName}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(match.productName)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                    i === highlight ? "bg-[var(--surface-sunken)]" : ""
                  }`}
                >
                  <span className="font-semibold">{match.productName}</span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {match.completed} made{match.batches > match.completed ? ` · ${match.batches - match.completed} not finished` : ""}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <div className="mt-4">
        {!selected ? (
          <EmptyState
            title="Search for a product"
            description="Type the product name and strength. On a new site this starts empty — after a month or two of staff using the MES, the averages become dependable."
          />
        ) : timing.error && !timing.data ? (
          <p className="text-sm font-semibold text-[var(--danger)]">{timing.error}</p>
        ) : !timing.data || timing.loading ? (
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <TimingDetail timing={timing.data} />
        )}
      </div>
    </Card>
  );
}

function TimingDetail({ timing }: { timing: ProductTiming }) {
  const confidence = CONFIDENCE[timing.confidence];
  const maxStage = Math.max(1, ...timing.stages.map((s) => s.avgSeconds ?? 0));
  const stageAverage = useMemo(
    () => new Map(timing.stages.map((s) => [s.sequenceNumber, s.avgSeconds])),
    [timing.stages],
  );

  return (
    <div className="animate-fade-in-up">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-extrabold">{timing.productName}</h3>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ color: confidence.tone, background: confidence.bg }}
        >
          {confidence.label}
          {timing.sampleSize > 0 ? ` · ${timing.sampleSize} finished batch${timing.sampleSize === 1 ? "" : "es"}` : ""}
        </span>
      </div>

      {timing.sampleSize === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          None of this product has been finished through the MES yet, so there&apos;s no start-to-finish time to
          average. Any stage times recorded so far are shown below.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Figure
          icon={<Timer size={16} weight="bold" />}
          label="Start to finish"
          value={formatDuration(timing.avgLeadSeconds)}
          hint="Confirmed → out of Warehouse"
        />
        <Figure
          icon={<Hourglass size={16} weight="bold" />}
          label="Hands-on time"
          value={formatDuration(timing.avgHandsOnSeconds)}
          hint="Time actually being worked on"
        />
        <Figure
          icon={<Clock size={16} weight="bold" />}
          label="Quickest · slowest"
          value={
            timing.minLeadSeconds !== null
              ? `${formatDuration(timing.minLeadSeconds)} · ${formatDuration(timing.maxLeadSeconds)}`
              : "—"
          }
          hint="Start to finish"
        />
        <Figure
          icon={<Clock size={16} weight="bold" />}
          label="Last made"
          value={timing.lastFinishedAt ? formatDistanceToNow(new Date(timing.lastFinishedAt), { addSuffix: true }) : "—"}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section>
          <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--subtle-foreground)]">
            Average time at each station
          </h4>
          <div className="grid gap-2">
            {timing.stages.map((stage) => {
              const pct = stage.avgSeconds ? Math.max(3, (stage.avgSeconds / maxStage) * 100) : 0;
              return (
                <div key={stage.stageId}>
                  <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-semibold">
                      <span className="text-[var(--muted-foreground)]">{stage.sequenceNumber}.</span> {stage.stageName}
                    </span>
                    <span className="tabular-nums text-[var(--muted-foreground)]">
                      {stage.sampleSize > 0 ? `${formatDuration(stage.avgSeconds)} · ${stage.sampleSize}×` : "No data"}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: `${pct}%`, background: "var(--brand-gradient)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[var(--subtle-foreground)]">
            <UsersThree size={13} weight="bold" />
            Average time per operator
          </h4>
          {timing.operators === undefined ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Per-operator figures are visible to admin and QA roles only.
            </p>
          ) : timing.operators.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No operator has finished a stage of this product yet.</p>
          ) : (
            <OperatorTable operators={timing.operators} stageAverage={stageAverage} />
          )}
          <p className="mt-2 text-[11px] text-[var(--subtle-foreground)]">
            For spotting training needs and bottlenecks — not for individual performance review.
          </p>
        </section>
      </div>
    </div>
  );
}

function Figure({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-extrabold tabular-nums">{value}</p>
      {hint ? <p className="text-[11px] text-[var(--subtle-foreground)]">{hint}</p> : null}
    </div>
  );
}

function OperatorTable({
  operators,
  stageAverage,
}: {
  operators: ProductOperatorTiming[];
  stageAverage: Map<number, number | null>;
}) {
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr className="border-b border-[var(--border)] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
            <th className="px-3 py-2">Operator</th>
            <th className="px-3 py-2">Station</th>
            <th className="px-3 py-2 text-right">Avg.</th>
            <th className="px-3 py-2 text-right">vs station</th>
          </tr>
        </thead>
        <tbody>
          {operators.map((row) => {
            const avg = stageAverage.get(row.sequenceNumber) ?? null;
            const diff = avg && row.avgSeconds ? Math.round(((row.avgSeconds - avg) / avg) * 100) : null;
            return (
              <tr key={`${row.operatorId}-${row.sequenceNumber}`} className="border-b border-[var(--border)] last:border-0">
                <td className="px-3 py-2 font-semibold">{row.operatorName}</td>
                <td className="px-3 py-2 text-[var(--muted-foreground)]">
                  {row.sequenceNumber}. {row.stageName}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDuration(row.avgSeconds)}
                  <span className="ml-1 text-[11px] text-[var(--subtle-foreground)]">{row.sampleSize}×</span>
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums">
                  {diff === null || Math.abs(diff) < 3 ? (
                    <span className="text-[var(--muted-foreground)]">typical</span>
                  ) : diff < 0 ? (
                    <span className="text-[var(--status-released)]">{Math.abs(diff)}% quicker</span>
                  ) : (
                    <span className="text-[var(--warning)]">{diff}% longer</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
