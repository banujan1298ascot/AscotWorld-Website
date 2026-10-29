/**
 * Where a batch's details go on a worksheet PDF. Worksheets are printed
 * forms: a label ("BATCH No.", "Date manufactured") with a blank beside it —
 * a run of underscores, or for dates the dots of "__ . __ . ____" on a
 * drawn line. Given the text on each page and where it sits, this works out
 * what to write and where; drawing it is ./generate.ts's job. Pure, so it's
 * unit-tested directly (fill.test.ts).
 *
 * Coordinates are PDF points from the page's bottom-left, as pdf.js reports
 * them and pdf-lib draws them; `y` is the text's baseline.
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Font size, near enough. */
  height: number;
}

export type FillField = "batchNumber" | "quantity" | "packSize" | "manufactureDate" | "expiryDate";

export interface FillValues {
  batchNumber: string;
  /** YYYY-MM-DD */
  manufactureDate: string | null;
  expiryDate: string | null;
  /** The batch quantity, as a number ("165"). */
  quantity: string | null;
  /** Count or volume per pack, as a number ("100"). */
  packSize: string | null;
}

export interface Draw {
  /** 0-based page index. */
  page: number;
  x: number;
  y: number;
  size: number;
  text: string;
}

export const FIELD_LABELS: Record<FillField, string> = {
  batchNumber: "batch number",
  quantity: "batch size",
  packSize: "pack size",
  manufactureDate: "manufacture date",
  expiryDate: "expiry date",
};

/** Each label, matched at the start of a piece of text. */
const LABELS: [FillField, RegExp][] = [
  ["batchNumber", /^\s*batch\s*(no\.?|number|#)\s*[:.]?\s*/i],
  ["quantity", /^\s*(batch\s*size|batch\s*quantity|quantity)\s*[:.]?\s*/i],
  ["packSize", /^\s*pack\s*size\s*[:.]?\s*/i],
  ["manufactureDate", /^\s*(date\s*(of\s*)?manufactur\w*|manufactur\w*\s*date|mfg\.?\s*date|date\s*made)\s*[:.]?\s*/i],
  ["expiryDate", /^\s*(expiry\s*date|exp\.?\s*date|use\s*by)\s*[:.]?\s*/i],
];

/** A blank to write in: two or more underscores. */
const BLANK_RUNS = /_{2,}/g;
const HAS_BLANK = /_{2,}/;
const isDot = (item: TextItem) => item.str.trim() === ".";

function dateParts(iso: string): [string, string, string] {
  const [year, month, day] = iso.split("-");
  return [day, month, year];
}

const ukDate = (iso: string) => dateParts(iso).join("/");

export function planFill(
  pages: TextItem[][],
  values: FillValues,
  measure: (text: string, size: number) => number,
): { draws: Draw[]; placed: Record<FillField, number> } {
  const draws: Draw[] = [];
  const placed: Record<FillField, number> = {
    batchNumber: 0,
    quantity: 0,
    packSize: 0,
    manufactureDate: 0,
    expiryDate: 0,
  };
  const textFor: Record<FillField, string | null> = {
    batchNumber: values.batchNumber,
    quantity: values.quantity,
    packSize: values.packSize,
    manufactureDate: values.manufactureDate ? ukDate(values.manufactureDate) : null,
    expiryDate: values.expiryDate ? ukDate(values.expiryDate) : null,
  };

  pages.forEach((items, page) => {
    const used = new Set<TextItem>();
    const sizeFor = (item: TextItem) => Math.min(11, Math.max(7, item.height * 0.8));

    /** Writes into the underscore blanks of `item` from character `from`:
     *  the first blank gets `texts[0]`, the next `texts[1]`, and so on —
     *  each centred on its blank, so it never touches the words either side. */
    function intoBlanks(item: TextItem, from: number, texts: (string | null)[], size = sizeFor(item)): number {
      const charWidth = item.width / Math.max(1, item.str.length);
      const runs = [...item.str.slice(from).matchAll(BLANK_RUNS)];
      let written = 0;
      texts.forEach((text, i) => {
        const run = runs[i];
        if (!run || text === null) return;
        const start = item.x + (from + run.index!) * charWidth;
        const room = run[0].length * charWidth;
        draws.push({
          page,
          x: start + Math.max(2, (room - measure(text, size)) / 2),
          y: item.y + 1.5,
          size,
          text,
        });
        written++;
      });
      used.add(item);
      return written;
    }

    for (const label of items) {
      for (const [field, pattern] of LABELS) {
        const match = label.str.match(pattern);
        if (!match) continue;
        const text = textFor[field];
        if (text === null) break;
        const labelEnd = label.x + label.width * (match[0].length / Math.max(1, label.str.length));

        // A blank in the label's own text: "Batch No: ________".
        // The batch number is the one thing everyone looks for, so it's
        // written a little larger than the rest.
        const size = field === "batchNumber" ? Math.min(12, Math.max(8, label.height * 0.55)) : undefined;

        if (HAS_BLANK.test(label.str.slice(match[0].length))) {
          placed[field] += intoBlanks(label, match[0].length, [text], size);
          break;
        }

        // What's to the right on the same line — a little above or below
        // counts, since a label is often centred against a two-line cell.
        const reach = Math.max(label.height, 8) * 0.9;
        const beside = items
          .filter(
            (other) =>
              other !== label &&
              !used.has(other) &&
              other.x >= labelEnd - 1 &&
              other.x - labelEnd < 360 &&
              Math.abs(other.y - label.y) <= reach,
          )
          .sort((a, b) => a.x - b.x || Math.abs(a.y - label.y) - Math.abs(b.y - label.y));

        const blank = beside.find((other) => HAS_BLANK.test(other.str));
        if (blank) {
          // "____ x ________ capsules": how many packs, times the pack size.
          if (field === "quantity" && /_+\s*[x×]\s*_+/i.test(blank.str)) {
            const written = intoBlanks(blank, 0, [values.quantity, values.packSize]);
            placed.quantity += Math.min(written, 1);
            if (written > 1) placed.packSize += 1;
          } else {
            placed[field] += intoBlanks(blank, 0, [text], size);
          }
          break;
        }

        const dots = beside.filter(isDot).slice(0, 3);
        if ((field === "manufactureDate" || field === "expiryDate") && dots.length >= 2) {
          // "__ . __ . ____ ." — day, month and year between the dots,
          // starting where the value column does.
          const columnStart = Math.min(
            ...items
              .filter((other) => other.x > labelEnd + 4 && other.x < dots[0].x && Math.abs(other.y - label.y) <= 60)
              .map((other) => other.x),
            dots[0].x - 40,
          );
          const edges = [columnStart, ...dots.map((d) => d.x)];
          if (edges.length === 3) edges.push(edges[2] + (edges[2] - edges[1]) * 1.5);
          const size = sizeFor(label);
          dateParts(field === "manufactureDate" ? values.manufactureDate! : values.expiryDate!).forEach((part, i) => {
            const width = measure(part, size);
            draws.push({ page, x: edges[i] + (edges[i + 1] - edges[i] - width) / 2, y: dots[0].y + 1, size, text: part });
          });
          dots.forEach((d) => used.add(d));
          placed[field] += 1;
          break;
        }

        // Nothing printed beside the batch number at all — the blank is a
        // drawn box — so write it just after the label.
        if (field === "batchNumber" && beside.length === 0) {
          draws.push({ page, x: labelEnd + 8, y: label.y, size: Math.min(14, Math.max(8, label.height * 0.7)), text });
          placed.batchNumber += 1;
        }
        break;
      }
    }
  });

  return { draws, placed };
}
