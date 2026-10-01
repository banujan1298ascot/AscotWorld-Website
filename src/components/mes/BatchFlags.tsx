import type { CSSProperties } from "react";
import { GlobeHemisphereWest, Warning } from "@phosphor-icons/react/dist/ssr";
import { BATCH_DESTINATION_LABELS, type BatchRecord } from "@/lib/batchBook";

/*
 * Flags set at Batch Book entry that follow a batch through every MES
 * station: Urgent shows amber, stock for Ireland shows neon green. Colour is
 * never the only signal — every flagged card or row also carries a text
 * badge — and a batch that's both gets both: an amber tint (urgency wins the
 * background) with a split amber/green edge stripe and both badges.
 */

type Flaggable = Pick<BatchRecord, "urgent" | "destination">;

const isIreland = (batch: Flaggable) => batch.destination === "IRELAND";

/** Does this batch get any highlight at all? */
export function isFlagged(batch: Flaggable): boolean {
  return batch.urgent || isIreland(batch);
}

/** The edge stripe as a background layer — a layer rather than a border so
 *  it follows the card's rounded corners and can be split two ways. */
function stripeLayer(batch: Flaggable, width: number): string | null {
  const urgent = batch.urgent;
  const ireland = isIreland(batch);
  if (!urgent && !ireland) return null;
  const colours =
    urgent && ireland
      ? "var(--urgent) 0 50%, var(--ireland) 50% 100%"
      : urgent
        ? "var(--urgent), var(--urgent)"
        : "var(--ireland), var(--ireland)";
  return `linear-gradient(to bottom, ${colours}) left top / ${width}px 100% no-repeat`;
}

function tint(batch: Flaggable): string {
  return batch.urgent ? "var(--urgent-bg)" : "var(--ireland-bg)";
}

/** Style for an MES board card: tinted, coloured border, edge stripe. */
export function flaggedCardStyle(batch: Flaggable): CSSProperties | undefined {
  const stripe = stripeLayer(batch, 5);
  if (!stripe) return undefined;
  return {
    background: `${stripe}, ${tint(batch)}`,
    borderColor: batch.urgent ? "var(--urgent)" : "var(--ireland)",
  };
}

/** Style for a table row: the tint across the whole row. */
export function flaggedRowStyle(batch: Flaggable): CSSProperties | undefined {
  return isFlagged(batch) ? { background: tint(batch) } : undefined;
}

/** Style for a row's first cell, which carries the edge stripe. */
export function flaggedFirstCellStyle(batch: Flaggable): CSSProperties | undefined {
  const stripe = stripeLayer(batch, 5);
  return stripe ? { background: stripe } : undefined;
}

/**
 * The text badges: URGENT, and the destination. Ireland is filled neon
 * green; the other markets are a plain outlined tag so the market is always
 * readable without competing with the two highlights.
 */
export function BatchFlags({ batch, className = "" }: { batch: Flaggable; className?: string }) {
  if (!batch.urgent && !batch.destination) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {batch.urgent ? (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
          style={{ background: "var(--urgent)", color: "var(--urgent-ink)" }}
        >
          <Warning size={11} weight="fill" />
          Urgent
        </span>
      ) : null}
      {batch.destination ? (
        isIreland(batch) ? (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
            style={{ background: "var(--ireland)", color: "var(--ireland-ink)" }}
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
