/**
 * Where a batch's calculated quantities go on its worksheet: each
 * ingredient's amount in the Quantity Required column, the bottles and
 * volume in "No. of bottles x volume", and the working in the Calculation
 * box. Like ./fill.ts this only plans — ./generate.ts draws.
 *
 * A worksheet with text is read: the "Quantity / Required" heading gives
 * the column, each ingredient's name in the left-hand column gives its row,
 * and a unit printed in the cell ("g", "ml") says exactly where the number
 * ends. A scanned worksheet has no text, so the places come from the
 * formula's ScanLayout, measured once for that file.
 *
 * Whatever can't be placed is reported, and generate.ts adds a calculation
 * page to the end instead, so nothing is ever silently left out.
 */
import { quantityText, type CalculatedLine, type Calculation, type ScanLayout } from "@/lib/formulaRules";
import type { Draw, TextItem } from "./fill";

export type Measure = (text: string, size: number, font: "bold" | "regular") => number;

export interface QuantityPlan {
  draws: Draw[];
  /** Ingredient ids whose amount was written in their row. */
  quantities: Set<string>;
  finalQuantity: boolean;
  calculation: boolean;
}

/** Size of the amounts written in the Quantity Required column. */
const NUMBER_SIZE = 9;
const NOTE_SIZE = 6;
const UNIT = /^(mcg|µg|mg|g|ml)$/i;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/* -------------------------------------------------------------------------- */
/* Drawing one of each                                                         */
/* -------------------------------------------------------------------------- */

/** An amount, ending at `right` on `baseline`. When the cell already has
 *  the unit (and "to" for made-up-to-volume) printed, only the number is
 *  written; otherwise the whole "to 160 ml". Optional ingredients get a
 *  small "(optional)" before the number. */
function amountDraws(
  line: CalculatedLine,
  page: number,
  right: number,
  baseline: number,
  printed: { unit: string | null; to: boolean },
  measure: Measure,
): Draw[] {
  const unitPrinted = printed.unit !== null && printed.unit.toLowerCase().replace("µg", "mcg") === line.unit;
  let text: string;
  if (!unitPrinted) text = quantityText(line);
  else text = line.basis === "TO_VOLUME" && !printed.to ? `to ${line.text}` : line.text;

  const width = measure(text, NUMBER_SIZE, "bold");
  const draws: Draw[] = [{ page, x: right - width, y: baseline, size: NUMBER_SIZE, text }];
  if (line.optional) {
    const note = "(optional)";
    draws.push({
      page,
      x: right - width - 3 - measure(note, NOTE_SIZE, "regular"),
      y: baseline,
      size: NOTE_SIZE,
      text: note,
      font: "regular",
    });
  }
  return draws;
}

function finalDraws(
  calc: Calculation,
  page: number,
  bottles: { x: number; y: number },
  packSize: { x: number; y: number },
  after: number | null,
  measure: Measure,
): Draw[] {
  const size = NUMBER_SIZE;
  const centred = (text: string, at: { x: number; y: number }): Draw => ({
    page,
    x: at.x - measure(text, size, "bold") / 2,
    y: at.y,
    size,
    text,
  });
  const draws = [centred(String(calc.packs), bottles), centred(String(calc.packSize), packSize)];
  if (after !== null) {
    draws.push({ page, x: after + 4, y: packSize.y, size: 8, text: `= ${calc.finalQuantity} ${calc.unit}` });
  }
  return draws;
}

/**
 * The working, fitted into a box: one column if it reads at a decent size,
 * otherwise two. Null when it won't fit legibly at all.
 */
function workingDraws(
  calc: Calculation,
  page: number,
  box: { x: number; top: number; bottom: number; right: number },
  measure: Measure,
): Draw[] | null {
  const lines = calc.working;
  const height = box.top - box.bottom;
  const width = box.right - box.x;
  if (height <= 0 || width <= 0) return null;

  let best: { columns: number; size: number } | null = null;
  for (const columns of [1, 2]) {
    const columnWidth = (width - (columns - 1) * 12) / columns;
    const rows = Math.ceil(lines.length / columns);
    const byHeight = height / (rows * 1.3);
    const byWidth = Math.min(...lines.map((l) => columnWidth / measure(l, 1, "regular")));
    const size = Math.min(8, byHeight, byWidth);
    if (!best || size > best.size + 0.5) best = { columns, size };
  }
  // Smaller than this can't be checked by eye on a printout.
  if (!best || best.size < 5.5) return null;

  const { columns, size } = best;
  const rows = Math.ceil(lines.length / columns);
  const columnWidth = (width - (columns - 1) * 12) / columns;
  return lines.map((text, i) => ({
    page,
    x: box.x + Math.floor(i / rows) * (columnWidth + 12),
    y: box.top - size - (i % rows) * size * 1.3,
    size,
    text,
    font: "regular" as const,
  }));
}

/* -------------------------------------------------------------------------- */
/* A worksheet with text                                                       */
/* -------------------------------------------------------------------------- */

interface Column {
  page: number;
  left: number;
  right: number;
  /** Below the column headings. */
  top: number;
  /** Above whatever follows the table. */
  bottom: number;
}

/** The Quantity Required column: "Quantity" with "Required" under it (or
 *  both in one piece), bounded by the headings either side. */
function findColumn(pages: TextItem[][]): Column | null {
  for (const [page, items] of pages.entries()) {
    for (const head of items) {
      let headingBottom: number;
      if (/^\s*quantity\s+required\s*$/i.test(head.str)) headingBottom = head.y;
      else if (/^\s*quantity\s*$/i.test(head.str)) {
        const under = items.find(
          (o) => /^\s*required\s*$/i.test(o.str) && head.y - o.y > 4 && head.y - o.y < 16 && Math.abs(o.x - head.x) < 10,
        );
        if (!under) continue;
        headingBottom = under.y;
      } else continue;

      // The headings row: anything level with "Quantity" or a few lines under it.
      const headings = items.filter((o) => o.y <= head.y + 3 && o.y >= head.y - 36);
      const nextRight = headings.filter((o) => o.x > head.x + head.width).map((o) => o.x);
      const prevLeft = headings.filter((o) => o.x + o.width < head.x).map((o) => o.x + o.width);
      const lowestHeading = Math.min(headingBottom, ...headings.filter((o) => o.y < head.y).map((o) => o.y));
      const end = items
        .filter((o) => o.y < lowestHeading && /^\s*(final product quantity|calculations?)\s*$/i.test(o.str))
        .map((o) => o.y);
      return {
        page,
        left: Math.max(head.x - 25, prevLeft.length ? Math.max(...prevLeft) + 1 : -Infinity),
        right: nextRight.length ? Math.min(...nextRight) - 4 : head.x + 75,
        top: lowestHeading - 2,
        bottom: end.length ? Math.max(...end) + 2 : 0,
      };
    }
  }
  return null;
}

/** Each ingredient's name in the left-hand column — matched on how many of
 *  its words appear in the few lines starting there ("PROPYLENE" / "GLYCOL
 *  BP" for Propylene glycol BP), best matches first. */
function findRows(items: TextItem[], column: Column, lines: CalculatedLine[]): Map<string, TextItem> {
  const names = items.filter((o) => o.x + o.width / 2 < column.left && o.y < column.top && o.y > column.bottom);
  const candidates: { id: string; anchor: TextItem; score: number }[] = [];
  for (const line of lines) {
    // Reference codes in brackets — "(QC REF 066)" — aren't part of the name.
    const wanted = words(line.name.replace(/\([^)]*\)/g, " "));
    if (wanted.length === 0) continue;
    for (const anchor of names) {
      if (words(anchor.str)[0] !== wanted[0]) continue;
      const block = names
        .filter((o) => Math.abs(o.x - anchor.x) < 12 && anchor.y - o.y >= 0 && anchor.y - o.y <= 48)
        .flatMap((o) => words(o.str));
      const score = wanted.filter((w) => block.includes(w)).length / wanted.length;
      if (score >= 0.5) candidates.push({ id: line.ingredientId, anchor, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.anchor.y - a.anchor.y);
  const rows = new Map<string, TextItem>();
  const taken = new Set<TextItem>();
  for (const c of candidates) {
    if (rows.has(c.id) || taken.has(c.anchor)) continue;
    rows.set(c.id, c.anchor);
    taken.add(c.anchor);
  }
  return rows;
}

function planFromText(pages: TextItem[][], calc: Calculation, measure: Measure, plan: QuantityPlan): void {
  const column = findColumn(pages);
  if (column) {
    const items = pages[column.page];
    const rows = findRows(items, column, calc.lines);
    const anchors = [...rows.values()].map((a) => a.y).sort((a, b) => b - a);
    const inColumn = items.filter((o) => o.x >= column.left && o.x + o.width / 2 <= column.right);

    for (const line of calc.lines) {
      const anchor = rows.get(line.ingredientId);
      if (!anchor) continue;
      // The row runs from a little above its name (names sit centred in
      // tall cells) down to the next ingredient's name.
      const above = anchors.filter((y) => y > anchor.y + 2);
      const below = anchors.filter((y) => y < anchor.y - 2);
      const top = Math.min(anchor.y + 16, above.length ? Math.min(...above) - 2 : Infinity, column.top);
      const bottom = Math.max(anchor.y - 60, below.length ? Math.max(...below) + 2 : -Infinity, column.bottom);
      const cell = inColumn.filter((o) => o.y <= top && o.y > bottom);
      const unit = cell
        .filter((o) => UNIT.test(o.str.trim()))
        .sort((a, b) => Math.abs(a.y - anchor.y) - Math.abs(b.y - anchor.y))[0];
      const to = cell.some((o) => /^\s*to\s*$/i.test(o.str));

      if (unit) {
        plan.draws.push(...amountDraws(line, column.page, unit.x - 3, unit.y, { unit: unit.str.trim(), to }, measure));
      } else {
        const text = quantityText(line);
        const middle = (column.left + column.right) / 2 + measure(text, NUMBER_SIZE, "bold") / 2;
        plan.draws.push(...amountDraws(line, column.page, middle, anchor.y, { unit: null, to: false }, measure));
      }
      plan.quantities.add(line.ingredientId);
    }
  }

  // "No. of bottles x volume:  ______ x ________ml" under FINAL PRODUCT QUANTITY.
  for (const [page, items] of pages.entries()) {
    const heading = items.find((o) => /final product quantity/i.test(o.str));
    if (!heading) continue;
    // The first one: top line, left-hand side.
    const blanks = items.filter((o) => /_{2,}\s*[x×]\s*_{2,}/i.test(o.str) && o.y < heading.y && heading.y - o.y < 40);
    const topLine = Math.max(...blanks.map((o) => o.y));
    const blank = blanks.filter((o) => topLine - o.y < 3).sort((a, b) => a.x - b.x)[0];
    if (!blank) continue;
    const charWidth = blank.width / Math.max(1, blank.str.length);
    const runs = [...blank.str.matchAll(/_{2,}/g)];
    if (runs.length < 2) continue;
    const centre = (run: RegExpMatchArray) => ({
      x: blank.x + (run.index! + run[0].length / 2) * charWidth,
      y: blank.y + 1.5,
    });
    plan.draws.push(...finalDraws(calc, page, centre(runs[0]), centre(runs[1]), blank.x + blank.width, measure));
    plan.finalQuantity = true;
    break;
  }

  // The CALCULATION box: below its heading and anything already printed
  // in it, down to the next section heading (or the page footer).
  const boxes = pages.flatMap((items, page) =>
    items.filter((o) => /^\s*calculations?\s*$/i.test(o.str)).map((heading) => ({ heading, page })),
  );
  const box = boxes.find((b) => b.page === column?.page) ?? boxes[0];
  if (box) {
    const items = pages[box.page];
    const { heading } = box;
    const nextSection = items
      .filter(
        (o) =>
          o.y < heading.y - 2 &&
          Math.abs(o.x - heading.x) < 8 &&
          /^[A-Z][A-Z0-9 &()/.,'-]{3,}$/.test(o.str.trim()),
      )
      // Clear of the box's bottom edge, which is drawn just above it.
      .map((o) => o.y + o.height + 7);
    const bottom = Math.max(36, ...nextSection);
    const printed = items.filter((o) => o.y < heading.y - 1 && o.y > bottom).map((o) => o.y);
    const top = (printed.length ? Math.min(...printed) : heading.y) - 4;
    const right = Math.max(...items.map((o) => o.x + o.width), heading.x + 300);
    const draws = workingDraws(calc, box.page, { x: heading.x, top, bottom, right }, measure);
    if (draws) {
      plan.draws.push(...draws);
      plan.calculation = true;
    } else if (top - bottom >= 8) {
      plan.draws.push({
        page: box.page,
        x: heading.x,
        y: top - 7,
        size: 7,
        text: "Calculation: see the batch calculation page added at the end of this worksheet.",
        font: "regular",
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* A scanned worksheet                                                         */
/* -------------------------------------------------------------------------- */

function planFromLayout(layout: ScanLayout, calc: Calculation, measure: Measure, plan: QuantityPlan): void {
  const page = layout.page - 1;
  for (const line of calc.lines) {
    const at = layout.quantities[line.ingredientId];
    if (!at) continue;
    // Scanned forms have the unit, and "to" for the diluent, printed.
    plan.draws.push(...amountDraws(line, page, at.x, at.y, { unit: line.unit, to: true }, measure));
    plan.quantities.add(line.ingredientId);
  }
  if (layout.finalQuantity) {
    plan.draws.push(...finalDraws(calc, page, layout.finalQuantity.bottles, layout.finalQuantity.packSize, null, measure));
    plan.finalQuantity = true;
  }
  if (layout.calculation) {
    const { x, y, width, height } = layout.calculation;
    const draws = workingDraws(calc, page, { x, top: y + height, bottom: y, right: x + width }, measure);
    if (draws) {
      plan.draws.push(...draws);
      plan.calculation = true;
    }
  }
}

/**
 * Plans the quantities onto a worksheet: from its text when it has any,
 * otherwise from `layout` when that was measured for this worksheet.
 */
export function planQuantities(
  pages: TextItem[][],
  calc: Calculation,
  measure: Measure,
  layout: ScanLayout | null,
  worksheetId: string,
): QuantityPlan {
  const plan: QuantityPlan = { draws: [], quantities: new Set(), finalQuantity: false, calculation: false };
  const hasText = pages.some((items) => items.length > 0);
  if (hasText) planFromText(pages, calc, measure, plan);
  else if (layout && layout.worksheetId === worksheetId) planFromLayout(layout, calc, measure, plan);
  return plan;
}
