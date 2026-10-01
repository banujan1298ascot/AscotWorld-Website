import type { CSSProperties } from "react";
import { GlobeHemisphereWest, Warning } from "@phosphor-icons/react/dist/ssr";
import { BATCH_DESTINATION_LABELS, type BatchRecord } from "@/lib/batchBook";

/*
 * Flags set at Batch Book entry that follow a batch through every MES
 * station: an urgent batch's card or row is filled solid amber, stock for
 * Ireland solid neon green — gradients in the style of the station banner.
 * A batch that's both runs amber into green. Colour is never the only
 * signal: every flagged batch also carries text badges.
 */

type Flaggable = Pick<BatchRecord, "urgent" | "destination">;

const isIreland = (batch: Flaggable) => batch.destination === "IRELAND";

/** Does this batch get a highlight at all? */
export function isFlagged(batch: Flaggable): boolean {
  return batch.urgent || isIreland(batch);
}

function gradient(batch: Flaggable): string | null {
  if (batch.urgent && isIreland(batch)) return "var(--urgent-ireland-gradient)";
  if (batch.urgent) return "var(--urgent-gradient)";
  if (isIreland(batch)) return "var(--ireland-gradient)";
  return null;
}

/**
 * Class and style for a flagged card or table row: the solid gradient, plus
 * `.batch-flagged` (globals.css), which re-points the theme colours inside
 * it so text and controls stay legible on the fill. Empty for an ordinary
 * batch.
 */
export function flaggedSurface(batch: Flaggable): { className: string; style?: CSSProperties } {
  const fill = gradient(batch);
  if (!fill) return { className: "" };
  // Ireland-only gets green-tinted ink; anything urgent keeps the amber ink.
  const ink = batch.urgent ? "" : " batch-flagged--ireland";
  return { className: `batch-flagged${ink}`, style: { background: fill } };
}

/**
 * The text badges: URGENT, and the destination. The two highlights are dark
 * pills lettered in their flag colour, so they read on a flagged card's
 * bright fill and on a plain card or row alike; other markets are a quiet
 * outlined tag.
 */
export function BatchFlags({ batch, className = "" }: { batch: Flaggable; className?: string }) {
  if (!batch.urgent && !batch.destination) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {batch.urgent ? (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
          style={{ background: "#2b1b00", color: "#fcd34d" }}
        >
          <Warning size={11} weight="fill" />
          Urgent
        </span>
      ) : null}
      {batch.destination ? (
        isIreland(batch) ? (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
            style={{ background: "#062b00", color: "#39ff14" }}
          >
            <GlobeHemisphereWest size={11} weight="fill" />
            Ireland
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 rounded border border-[var(--border-strong)] px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
            <GlobeHemisphereWest size={11} weight="bold" />
            {BATCH_DESTINATION_LABELS[batch.destination]}
          </span>
        )
      ) : null}
    </span>
  );
}

/** Urgent batches first, then the rest in their existing order — for lists
 *  where waiting work is picked from the top. Stable, so ties keep order. */
export function urgentFirst<T>(items: T[], batchOf: (item: T) => Flaggable): T[] {
  return [...items].sort((a, b) => Number(batchOf(b).urgent) - Number(batchOf(a).urgent));
}
