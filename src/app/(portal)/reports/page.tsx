"use client";

import { useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import { Button, Card, EmptyState, FilterSelect, PageHeader, PermissionNotice, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useDepartments } from "@/lib/batchBook";
import { downloadBatchesCsv, useDashboard, type OperatorStageDuration, type StageReworkRate } from "@/lib/dashboard";

const DAY_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

/** One decimal place, or an em dash when there's no sample — a zero-sample
 *  stage should read as "no data", not a misleadingly confident 0%. */
function ratePct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  const abs = Math.abs(seconds);
  if (abs < 60) return `${Math.round(abs)}s`;
  const minutes = abs / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = hours / 24;
  return `${Math.round(days * 10) / 10}d`;
}

export default function ReportsPage() {
  const { user, can } = useAuth();
  const { departments, ready: departmentsReady, error: departmentsError } = useDepartments();
  // Bespoke is the only seeded department so far — same simplification as
  // the MES pipeline page.
  const departmentId = departments[0]?.id;

  const [days, setDays] = useState(14);
  // useDashboard never resolves without a departmentId, which
  // departmentsError can leave permanently unset — same fix as the MES
  // pipeline page's loading state.
  const { data, ready: dashboardReady, error: dashboardError } = useDashboard(departmentId, days);
  const ready = departmentsReady && (!departmentId || dashboardReady);
  const error = departmentsError ?? dashboardError;

  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (!user) return null;
  if (!can("dashboard.view")) {
    return (
      <>
        <PageHeader title="Production reports" />
        <PermissionNotice message="Your role doesn't have access to production reports." />
      </>
    );
  }

  const maxStageCount = data ? Math.max(1, ...data.stageOccupancy.map((s) => s.count)) : 1;
  const maxThroughput = data
    ? Math.max(1, ...data.throughput.map((d) => d.confirmed + d.completed + d.failed))
    : 1;
  const maxStageSeconds = data ? Math.max(1, ...data.stageDurations.map((s) => s.avgSeconds ?? 0)) : 1;

  return (
    <>
      <PageHeader
        title="Production reports"
        description="Where batches are, how long each stage takes, and how often work gets sent back — spotted for bottlenecks, not blame."
        actions={
          <>
            <FilterSelect label="Range" value={String(days)} onChange={(v) => setDays(Number(v))} options={DAY_OPTIONS} />
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
          </>
        }
      />

      {exportError ? (
        <Card className="mb-4 border-[var(--danger)]">
          <p className="text-sm font-semibold text-[var(--danger)]">{exportError}</p>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-4 border-[var(--danger)]">
          <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
        </Card>
      ) : null}

      {!ready ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : !data ? null : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Batches confirmed" value={String(data.throughput.reduce((n, d) => n + d.confirmed, 0))} />
            <StatCard
              label="Avg. cycle time"
              value={formatDuration(data.cycleTime.avgSeconds)}
              hint={data.cycleTime.sampleSize > 0 ? `${data.cycleTime.sampleSize} completed batches` : "No completions yet"}
            />
            <StatCard
              label="In progress right now"
              value={String(data.stageOccupancy.reduce((n, s) => n + s.count, 0))}
            />
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-extrabold">Where batches are right now</h2>
            {data.stageOccupancy.every((s) => s.count === 0) ? (
              <EmptyState title="Nothing in progress" description="No batches are currently sitting at any stage." />
            ) : (
              <div className="grid gap-2">
                {data.stageOccupancy.map((stage) => (
                  <BarRow
                    key={stage.stageId}
                    label={`${stage.sequenceNumber}. ${stage.stageName}`}
                    value={stage.count}
                    max={maxStageCount}
                    valueLabel={String(stage.count)}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-extrabold">Throughput — last {data.days} days</h2>
            <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 140 }}>
              {data.throughput.map((day) => {
                const total = day.confirmed + day.completed + day.failed;
                return (
                  <div key={day.date} className="flex min-w-[18px] flex-1 flex-col items-center justify-end gap-0.5" title={day.date}>
                    {day.failed > 0 ? (
                      <div
                        className="w-full rounded-t-sm bg-[var(--danger)]"
                        style={{ height: `${Math.max(2, (day.failed / maxThroughput) * 120)}px` }}
                      />
                    ) : null}
                    {day.completed > 0 ? (
                      <div
                        className="w-full bg-[var(--status-released)]"
                        style={{ height: `${Math.max(2, (day.completed / maxThroughput) * 120)}px` }}
                      />
                    ) : null}
                    {day.confirmed > 0 ? (
                      <div
                        className="w-full bg-[var(--brand-400)]"
                        style={{ height: `${Math.max(2, (day.confirmed / maxThroughput) * 120)}px` }}
                      />
                    ) : null}
                    {total === 0 ? <div className="h-0.5 w-full bg-[var(--border)]" /> : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted-foreground)]">
              <Legend swatch="var(--brand-400)" label="Confirmed" />
              <Legend swatch="var(--status-released)" label="Completed" />
              <Legend swatch="var(--danger)" label="Failed" />
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-extrabold">Average time per stage</h2>
            {data.stageDurations.every((s) => s.sampleSize === 0) ? (
              <EmptyState title="No completed stage visits yet" description="This fills in as batches move through the pipeline." />
            ) : (
              <div className="grid gap-2">
                {data.stageDurations.map((stage) => (
                  <BarRow
                    key={stage.stageId}
                    label={`${stage.sequenceNumber}. ${stage.stageName}`}
                    value={stage.avgSeconds ?? 0}
                    max={maxStageSeconds}
                    valueLabel={stage.sampleSize > 0 ? `${formatDuration(stage.avgSeconds)} · ${stage.sampleSize}` : "No data"}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <h2 className="px-4 pt-4 text-sm font-extrabold">Rework and rejection rate per stage</h2>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="px-4 py-2">Stage</th>
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
            <Card padded={false} className="overflow-hidden">
              <div className="px-4 pt-4">
                <h2 className="text-sm font-extrabold">Average time per stage, per operator</h2>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  For spotting training needs or bottlenecks — not for individual performance review.
                </p>
              </div>
              {data.operatorStageDurations.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState title="No data yet" description="This fills in once operators start closing out stage work." />
                </div>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                        <th className="px-4 py-2">Stage</th>
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
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{hint}</p> : null}
    </Card>
  );
}

function BarRow({ label, value, max, valueLabel }: { label: string; value: number; max: number; valueLabel: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-[var(--muted-foreground)]">{valueLabel}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        <div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: swatch }} />
      {label}
    </span>
  );
}
