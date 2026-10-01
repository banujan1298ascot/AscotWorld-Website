import type { CSSProperties } from "react";
import { GlobeHemisphereWest, Warning } from "@phosphor-icons/react/dist/ssr";
import { BATCH_DESTINATION_LABELS, type BatchRecord } from "@/lib/batchBook";

/*
 * Flags set at Batch Book entry that follow a batch through every MES
 * station: an urgent batch's card or row is filled solid orange (#FF4D00),
 * stock for Ireland solid green (#008000) — gradients in the style of the
 * station banner. Urgent takes priority: an urgent batch for Ireland is
 * plain orange, with the green IRELAND badge saying where it's going.
 * Colour is never the only signal: every flagged batch also carries text
 * badges.
 */

type Flaggable = Pick<BatchRecord, "urgent" | "destination">;

const isIreland = (batch: Flaggable) => batch.destination === "IRELAND";

/** Does this batch get a highlight at all? */
export function isFlagged(batch: Flaggable): boolean {
  return batch.urgent || isIreland(batch);
}

function gradient(batch: Flaggable): string | null {
  // Urgent wins outright, whatever the destination.
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
  // Ireland-only gets white ink on its green; anything urgent keeps dark ink.
  const ink = batch.urgent ? "" : " batch-flagged--ireland";
  return { className: `batch-flagged${ink}`, style: { background: fill } };
}

/**
 * The text badges: URGENT, and the destination. URGENT is a dark
 * pill lettered orange and IRELAND a white-ringed green one, so both read on a flagged card's
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
          style={{ background: "#2a0b00", color: "#ff7a3d" }}
        >
          <Warning size={11} weight="fill" />
          Urgent
        </span>
      ) : null}
      {batch.destination ? (
        isIreland(batch) ? (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
            style={{ background: "var(--ireland)", color: "#ffffff", boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.7)" }}
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
