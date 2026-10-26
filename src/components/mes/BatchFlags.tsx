import type { CSSProperties } from "react";
import { GlobeHemisphereWest, Warning } from "@phosphor-icons/react/dist/ssr";
import { BATCH_DESTINATION_LABELS, type BatchRecord } from "@/lib/batchBook";

/*
 * Flags set at Batch Book entry that follow a batch through every MES
 * station. Urgent and the destination show as text badges only — the card
 * or row itself stays its normal colour. The one fill left is a failed
 * batch's solid red.
 */

type Flaggable = Pick<BatchRecord, "urgent" | "destination"> & Partial<Pick<BatchRecord, "status">>;

/** A failed batch's fill — solid red (#FF0F0F) wherever a failed batch is
 *  shown (the Batch Book, the reports' exceptions list). Failed batches
 *  leave the MES queues, but the MES uses the same rule via flaggedSurface. */
export const FAILED_SURFACE: { className: string; style: CSSProperties } = {
  className: "batch-flagged batch-flagged--failed",
  style: { background: "var(--failed-fill)" },
};

const isIreland = (batch: Flaggable) => batch.destination === "IRELAND";

/**
 * Class and style for a batch's card or table row: solid red if it failed,
 * plus `.batch-flagged` (globals.css), which re-points the theme colours
 * inside it so text and controls stay legible on the fill. Empty otherwise —
 * urgent and Ireland batches are marked by their badges alone.
 */
export function flaggedSurface(batch: Flaggable): { className: string; style?: CSSProperties } {
  if (batch.status === "FAILED") return FAILED_SURFACE;
  return { className: "" };
}

/**
 * The text badges: URGENT, and the destination. URGENT is a dark pill
 * lettered orange and IRELAND a solid green one; other markets are a quiet
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
            style={{ background: "var(--ireland)", color: "#ffffff" }}
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
