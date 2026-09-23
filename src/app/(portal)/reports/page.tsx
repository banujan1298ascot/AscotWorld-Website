"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUDownLeft,
  ArrowsClockwise,
  CheckCircle,
  Cube,
  DownloadSimple,
  Factory,
  Timer,
  TrendUp,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { Button, Card, EmptyState, ErrorNotice, PageHeader, PermissionNotice, Skeleton } from "@/components/ui";
import { OutputChart } from "@/components/reports/OutputChart";
import { ProductTimingSearch } from "@/components/reports/ProductTimingSearch";
import { useAuth } from "@/lib/auth";
import { useDepartments } from "@/lib/batchBook";
import { downloadBatchesCsv, useDashboard, type OperatorStageDuration, type StageReworkRate } from "@/lib/dashboard";
import { FLOOR_ROOMS, roomLoads } from "@/lib/floorPlan";
import {
  formatDuration,
  STATION_POLL_MS,
  useOutputReport,
  useRecentExceptions,
  useStationLoads,
  type OutputRange,
} from "@/lib/productionReport";

// three.js is heavy and needs the browser — load it only here, only client-side.
const FloorModel = dynamic(() => import("@/components/reports/FloorModel"), {
  ssr: false,
  loading: () => <FloorLoading />,
});

/** Dashboard-endpoint window for the stage timing and cycle time tiles. */
const SUMMARY_DAYS = 30;

function ratePct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

const stagger = (ms: number) => ({ "--stagger": `${ms}ms` }) as React.CSSProperties;

export default function ReportsPage() {
  const { user, can } = useAuth();
  const { departments, ready: departmentsReady, error: departmentsError } = useDepartments();
  // Bespoke is the only seeded department so far — same simplification as
  // the MES pipeline page.
  const department = departments[0];
  const departmentId = department?.id;

  const [range, setRange] = useState<OutputRange>("month");
  const dashboard = useDashboard(departmentId, SUMMARY_DAYS);
  const monthOutput = useOutputReport(departmentId, "month");
  const stations = useStationLoads(departmentId);
  const exceptions = useRecentExceptions(departmentId);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const loads = useMemo(() => roomLoads(stations.data?.stations ?? []), [stations.data]);

  if (!user) return null;
  if (!can("dashboard.view")) {
    return (
      <>
        <PageHeader title="Production reports" />
        <PermissionNotice message="Your role doesn't have access to production reports." />
      </>
    );
  }

  const error = departmentsError ?? dashboard.error;
  const data = dashboard.data;
  const stationList = stations.data?.stations ?? [];
  const waitingTotal = stationList.reduce((n, s) => n + s.incoming + s.returned, 0);
  const inProgressTotal = stationList.reduce((n, s) => n + s.inProgress, 0);
  const busiest = [...FLOOR_ROOMS].sort((a, b) => (loads[b.id]?.waiting ?? 0) - (loads[a.id]?.waiting ?? 0))[0];
  const busiestWaiting = busiest ? (loads[busiest.id]?.waiting ?? 0) : 0;

  const closed = data?.stageReworkRates.reduce((n, s) => n + s.totalClosed, 0) ?? 0;
  const reworked = data?.stageReworkRates.reduce((n, s) => n + s.sentBack + s.failed, 0) ?? 0;
  const maxStageSeconds = data ? Math.max(1, ...data.stageDurations.map((s) => s.avgSeconds ?? 0)) : 1;

  return (
    <>
      <PageHeader
        title="Production reports"
        description="What's waiting where right now, how much is being made, and how long each product takes."
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={!departmentId || exporting}
            onClick={async () => {
              if (!departmentId) return;
              setExporting(true);
              setExportError(null);
              try {
                await downloadBatchesCsv(departmentId, user.id);
              } catch (err) {
                setExportError(err instanceof Error ? err.message : "Export failed.");
              } finally {
                setExporting(false);
              }
            }}
          >
            <DownloadSimple size={15} weight="bold" />
            Export CSV
          </Button>
        }
      />

      {exportError ? (
        <div className="mb-4">
          <ErrorNotice message={exportError} />
        </div>
      ) : null}
      {error ? (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ---- live floor model ------------------------------------------ */}
        {/* Always light, whatever the app theme — it mirrors the site's
            floor-plan render, which is a bright white model. */}
        <div
          className="card-interactive relative overflow-hidden rounded-lg border border-[#dfe5ee] text-[#0f172a] shadow-[var(--shadow-card)] animate-fade-in-up xl:col-span-8"
          style={{ background: "radial-gradient(120% 90% at 50% 40%, #ffffff 0%, #f1f4f9 55%, #e4e9f1 100%)", ...stagger(0) }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-start justify-between gap-2 p-4">
            <div>
              <p className="flex items-center gap-2 text-base font-extrabold">
                <Factory size={18} weight="bold" className="text-[#2563eb]" />
                {department?.name ?? "Production"} floor
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#5b6b82]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10b981] opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10b981]" />
                </span>
                Live · refreshes every {STATION_POLL_MS / 1000}s
              </p>
            </div>
            <p className="hidden items-center gap-1.5 rounded-full border border-[#dfe5ee] bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-[#5b6b82] backdrop-blur sm:flex">
              <Cube size={13} weight="bold" />
              Drag to rotate · pinch or Ctrl + scroll to zoom
            </p>
          </div>

          <div className="h-[420px] w-full sm:h-[500px] xl:h-[620px]">
            {stations.error && !stations.data ? (
              <div className="grid h-full place-items-center p-6">
                <ErrorNotice message={stations.error} />
              </div>
            ) : (
              <FloorModel loads={loads} />
            )}
          </div>

          {/* Pipeline-now panel, like the reference's strategy card. */}
          <div className="relative z-30 border-t border-[#dfe5ee] bg-white/70 p-3 sm:absolute sm:bottom-4 sm:left-4 sm:w-60 sm:rounded-2xl sm:border sm:bg-white/85 sm:p-4 sm:shadow-[0_10px_30px_rgb(15_23_42/0.12)] sm:backdrop-blur">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#7c8aa0]">Pipeline now</p>
            {!stations.ready ? (
              <div className="mt-2 h-16 w-full animate-pulse rounded-lg bg-[#e8edf4]" />
            ) : (
              <>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-2xl font-extrabold tabular-nums">{waitingTotal}</p>
                    <p className="text-[11px] font-semibold text-[#5b6b82]">waiting to start</p>
                  </div>
                  <div>
                    <p className="text-2xl font-extrabold tabular-nums">{inProgressTotal}</p>
                    <p className="text-[11px] font-semibold text-[#5b6b82]">being worked on</p>
                  </div>
                </div>
                {busiest && busiestWaiting > 0 ? (
                  <div className="mt-3 rounded-xl bg-[#eef2f7] px-3 py-2 text-xs">
                    <p className="font-bold">Most waiting: {busiest.name}</p>
                    <p className="mt-0.5 text-[#5b6b82]">
                      {busiestWaiting} batch{busiestWaiting === 1 ? "" : "es"} queued at{" "}
                      {loads[busiest.id]?.stationNames.join(" and ")}.
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[#5b6b82]">Every station&apos;s queue is clear.</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- headline tiles + stage timing ------------------------------ */}
        <div className="grid content-start gap-4 xl:col-span-4">
          <div className="grid grid-cols-2 gap-3">
            <HighlightTile
              icon={<TrendUp size={18} weight="bold" />}
              label="Made · 30 days"
              value={monthOutput.data ? String(monthOutput.data.totalMade) : "—"}
              ready={monthOutput.ready}
              foot={
                monthOutput.data?.changePct != null
                  ? `${monthOutput.data.changePct >= 0 ? "+" : ""}${monthOutput.data.changePct}% vs previous 30`
                  : "No earlier period to compare"
              }
              style={stagger(60)}
            />
            <HighlightTile
              icon={<Timer size={18} weight="bold" />}
              label="Avg. start to finish"
              value={formatDuration(data?.cycleTime.avgSeconds)}
              ready={dashboard.ready}
              foot={
                data && data.cycleTime.sampleSize > 0
                  ? `Over ${data.cycleTime.sampleSize} batches`
                  : "No batches finished yet"
              }
              style={stagger(120)}
            />
            <PlainTile
              icon={<ArrowsClockwise size={17} weight="bold" />}
              label="Started · 30 days"
              value={monthOutput.data ? String(monthOutput.data.totalStarted) : "—"}
              ready={monthOutput.ready}
              style={stagger(180)}
            />
            <PlainTile
              icon={<CheckCircle size={17} weight="bold" />}
              label="Right first time"
              value={closed > 0 ? ratePct(closed - reworked, closed) : "—"}
              ready={dashboard.ready}
              style={stagger(240)}
            />
          </div>

          <Card interactive className="animate-fade-in-up" style={stagger(300)}>
            <h2 className="text-sm font-extrabold">Average time per station</h2>
            <p className="mb-3 mt-0.5 text-xs text-[var(--muted-foreground)]">Hands-on, all products, all time</p>
            {!data ? (
              <Skeleton className="h-40 w-full" />
            ) : data.stageDurations.every((s) => s.sampleSize === 0) ? (
              <EmptyState title="No finished stage visits yet" description="Fills in as batches move through the MES." />
            ) : (
              <div className="grid gap-2.5">
                {data.stageDurations.map((stage) => (
                  <div key={stage.stageId}>
                    <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate font-semibold">
                        <span className="text-[var(--muted-foreground)]">{stage.sequenceNumber}.</span> {stage.stageName}
                      </span>
                      <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">
                        {stage.sampleSize > 0 ? formatDuration(stage.avgSeconds) : "—"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${stage.avgSeconds ? Math.max(3, (stage.avgSeconds / maxStageSeconds) * 100) : 0}%`,
                          background: "var(--brand-gradient)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ---- batches made ----------------------------------------------- */}
        <OutputChart
          departmentId={departmentId}
          range={range}
          onRangeChange={setRange}
          className="animate-fade-in-up xl:col-span-7"
          style={stagger(360)}
        />

        {/* ---- exceptions ------------------------------------------------- */}
        <Card interactive className="animate-fade-in-up xl:col-span-5" style={stagger(420)}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold">Sent back &amp; failed</h2>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Latest across every station</p>
            </div>
          </div>
          <div className="mt-3">
            {!exceptions.ready ? (
              <Skeleton className="h-48 w-full" />
            ) : exceptions.error && !exceptions.data ? (
              <ErrorNotice message={exceptions.error} />
            ) : (exceptions.data?.exceptions.length ?? 0) === 0 ? (
              <EmptyState title="Nothing sent back" description="No batch has been sent back or failed yet." />
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {exceptions.data!.exceptions.map((item) => {
                  const failed = item.outcome === "FAILED";
                  return (
                    <li
                      key={item.id}
                      className="flex min-w-0 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5"
                    >
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                        style={{
                          color: failed ? "var(--danger)" : "var(--warning)",
                          background: failed ? "var(--danger-bg)" : "var(--status-qa-bg)",
                        }}
                      >
                        {failed ? <Warning size={16} weight="fill" /> : <ArrowUDownLeft size={16} weight="bold" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold">
                          {item.batchNumber ?? "Batch"} {failed ? "failed" : "sent back"} at station {item.sequenceNumber}
                          <span className="ml-1.5 text-[11px] font-semibold text-[var(--subtle-foreground)]">
                            {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                          </span>
                        </p>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {item.productName} · {item.stageName} · {item.operatorName}
                        </p>
                        {item.notes ? <p className="mt-0.5 line-clamp-2 text-xs">{item.notes}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* ---- product timing search -------------------------------------- */}
        <ProductTimingSearch
          departmentId={departmentId}
          className="animate-fade-in-up xl:col-span-12"
          style={stagger(480)}
        />

        {/* ---- detail tables ---------------------------------------------- */}
        {data ? (
          <>
            <Card padded={false} className="overflow-hidden xl:col-span-6">
              <h2 className="px-4 pt-4 text-sm font-extrabold">Rework and rejection rate per station</h2>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                      <th className="px-4 py-2">Station</th>
                      <th className="px-4 py-2">Closed</th>
                      <th className="px-4 py-2">Sent back</th>
                      <th className="px-4 py-2">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stageReworkRates.map((stage: StageReworkRate) => (
                      <tr key={stage.stageId} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2 font-semibold">
                          {stage.sequenceNumber}. {stage.stageName}
                        </td>
                        <td className="px-4 py-2 text-[var(--muted-foreground)]">{stage.totalClosed}</td>
                        <td className="px-4 py-2">{ratePct(stage.sentBack, stage.totalClosed)}</td>
                        <td className="px-4 py-2">{ratePct(stage.failed, stage.totalClosed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {data.operatorStageDurations ? (
              <Card padded={false} className="overflow-hidden xl:col-span-6">
                <div className="px-4 pt-4">
                  <h2 className="text-sm font-extrabold">Average time per station, per operator</h2>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    All products. For spotting training needs or bottlenecks — not for individual performance review.
                  </p>
                </div>
                {data.operatorStageDurations.length === 0 ? (
                  <div className="px-4 pb-4">
                    <EmptyState title="No data yet" description="This fills in once operators start closing out stage work." />
                  </div>
                ) : (
                  <div className="mt-2 max-h-[340px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--surface)]">
                        <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                          <th className="px-4 py-2">Station</th>
                          <th className="px-4 py-2">Operator</th>
                          <th className="px-4 py-2">Avg. time</th>
                          <th className="px-4 py-2">Sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.operatorStageDurations.map((row: OperatorStageDuration) => (
                          <tr key={`${row.stageId}-${row.operatorId}`} className="border-b border-[var(--border)] last:border-0">
                            <td className="px-4 py-2 font-semibold">
                              {row.sequenceNumber}. {row.stageName}
                            </td>
                            <td className="px-4 py-2">{row.operatorName}</td>
                            <td className="px-4 py-2">{formatDuration(row.avgSeconds)}</td>
                            <td className="px-4 py-2 text-[var(--muted-foreground)]">{row.sampleSize}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ) : null}
          </>
        ) : !departmentsReady || !dashboard.ready ? (
          <Skeleton className="h-40 w-full xl:col-span-12" />
        ) : null}
      </div>
    </>
  );
}

function FloorLoading() {
  return (
    <div className="grid h-full w-full place-items-center">
      <div className="flex flex-col items-center gap-2 text-xs font-semibold text-[#5b6b82]">
        <Cube size={28} weight="duotone" className="animate-pulse text-[#2563eb]" />
        Building the floor model…
      </div>
    </div>
  );
}

/** Gradient headline card — the reference's "PV saving" tiles. */
function HighlightTile({
  icon,
  label,
  value,
  foot,
  ready,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  foot: string;
  ready: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="card-interactive animate-fade-in-up relative overflow-hidden rounded-2xl p-4 text-white shadow-[var(--shadow-glow)]"
      style={{ background: "var(--brand-gradient)", ...style }}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15 blur-xl" />
      <p className="flex items-center gap-1.5 text-xs font-bold text-white/85">
        {icon}
        {label}
      </p>
      {ready ? (
        <p className="mt-3 text-3xl font-extrabold tabular-nums">{value}</p>
      ) : (
        <div className="mt-3 h-9 w-20 animate-pulse rounded-lg bg-white/20" />
      )}
      <p className="mt-1 text-[11px] font-semibold text-white/80">{foot}</p>
    </div>
  );
}

function PlainTile({
  icon,
  label,
  value,
  ready,
  style,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ready: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <Card interactive className="animate-fade-in-up" style={style}>
      <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--muted-foreground)]">
        <span className="text-[var(--primary)]">{icon}</span>
        {label}
      </p>
      {ready ? (
        <p className="mt-2 text-2xl font-extrabold tabular-nums">{value}</p>
      ) : (
        <Skeleton className="mt-2 h-8 w-16" />
      )}
    </Card>
  );
}
