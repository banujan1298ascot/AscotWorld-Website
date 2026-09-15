/**
 * AscotWorld wordmark.
 *
 * Derived from the official Ascot Laboratories logo: lowercase wordmark with
 * the "o" replaced by the molecular node cluster, and the descriptor line set
 * in brand blue beneath. Rebuilt as vector so it stays sharp at any size and
 * re-tones correctly in dark mode — the raster original is kept in
 * /public/brand/ for print and external use.
 */

interface LogoProps {
  /** Height of the wordmark in pixels. */
  size?: number;
  /** Descriptor beneath the wordmark. Pass null to show the wordmark alone. */
  descriptor?: string | null;
  className?: string;
}

export function Logo({ size = 32, descriptor = "WORLD", className }: LogoProps) {
  return (
    <span
      className={`inline-flex flex-col items-start leading-none ${className ?? ""}`}
      aria-hidden="true"
    >
      <span
        className="inline-flex items-baseline font-extrabold tracking-[-0.04em] text-foreground"
        style={{ fontSize: size, lineHeight: 1 }}
      >
        asc
        <Molecule size={size} />
        <span style={{ marginLeft: size * 0.02 }}>t</span>
      </span>
      {descriptor ? (
        <span
          className="font-extrabold text-[var(--brand-500)]"
          style={{
            fontSize: size * 0.36,
            letterSpacing: size * 0.055,
            marginTop: size * 0.06,
          }}
        >
          {descriptor}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The molecular cluster that stands in for the "o". The large node deliberately
 * breaks above the cap height, as it does in the original mark.
 */
function Molecule({ size }: { size: number }) {
  const box = size * 0.72;
  return (
    <svg
      viewBox="0 0 100 100"
      width={box}
      height={box}
      style={{
        overflow: "visible",
        marginInline: size * 0.015,
        // Sit the node cluster on the baseline with the surrounding letters.
        transform: `translateY(${size * 0.045}px)`,
      }}
      fill="var(--brand-500)"
    >
      {/* bonds, drawn under the nodes */}
      <path d="M44 22 L58 62 L94 52" stroke="var(--brand-500)" strokeWidth="13" fill="none" />
      <path d="M58 62 L40 96" stroke="var(--brand-500)" strokeWidth="10" fill="none" />
      {/* nodes */}
      <circle cx="44" cy="16" r="32" />
      <circle cx="58" cy="62" r="24" />
      <circle cx="97" cy="50" r="17" />
      <circle cx="38" cy="98" r="12" />
    </svg>
  );
}

/** Compact mark for tight spaces — the molecule alone. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="-10 -20 130 140" width={size} height={size} fill="var(--brand-500)">
        <path d="M44 22 L58 62 L94 52" stroke="var(--brand-500)" strokeWidth="13" fill="none" />
        <path d="M58 62 L40 96" stroke="var(--brand-500)" strokeWidth="10" fill="none" />
        <circle cx="44" cy="16" r="32" />
        <circle cx="58" cy="62" r="24" />
        <circle cx="97" cy="50" r="17" />
        <circle cx="38" cy="98" r="12" />
      </svg>
    </span>
  );
}
