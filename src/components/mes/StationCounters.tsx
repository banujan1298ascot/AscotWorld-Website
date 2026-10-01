"use client";

import { WATCHED_STATIONS } from "@/lib/mes";
import { useStationCounters } from "@/lib/productionReport";

/**
 * Live counters for the stations around this one (WATCHED_STATIONS): how
 * many batches each holds right now — incoming (including any sent back
 * for rework) plus in progress. Polls every few seconds, so a station sees
 * work building up before it arrives. Renders nothing for a station that
 * watches no others.
 */
export function StationCounters({
  departmentId,
  sequenceNumber,
}: {
  departmentId: string | undefined;
  sequenceNumber: number | undefined;
}) {
  const watched = sequenceNumber != null ? WATCHED_STATIONS[sequenceNumber] ?? [] : [];
  // No request at all for a station that watches nothing.
  const { data, error } = useStationCounters(watched.length > 0 ? departmentId : undefined);

  if (watched.length === 0) return null;

  const stations = watched.map((seq) => ({ seq, load: data?.stations.find((s) => s.sequenceNumber === seq) }));

  return (
    <section aria-label="Other stations right now" className="mb-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {error ? null : (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-60" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${error ? "bg-[var(--subtle-foreground)]" : "bg-[var(--success)]"}`}
          />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          {error ? "Other stations — reconnecting…" : "Other stations · live"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {stations.map(({ seq, load }) => {
          const incoming = load ? load.incoming + load.returned : null;
          const inProgress = load ? load.inProgress : null;
          const total = incoming != null && inProgress != null ? incoming + inProgress : null;
          return (
            <div
              key={seq}
              className="flex min-w-[220px] flex-1 basis-0 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[13px] font-extrabold text-[var(--brand-700)]">
                {seq}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-foreground">
                  {load?.stageName ?? `Station ${seq}`}
                </p>
                <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                  {incoming != null ? `${incoming} incoming · ${inProgress} in progress` : "Loading…"}
                </p>
              </div>
              <p
                className="shrink-0 text-2xl font-extrabold tabular-nums text-foreground"
                aria-live="polite"
                aria-label={total != null ? `${total} batches at station ${seq}` : undefined}
              >
                {total ?? "–"}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
