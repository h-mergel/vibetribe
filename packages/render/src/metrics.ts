import ADV from "./adv.json" with { type: "json" };

/**
 * Text measurement and title layout of the Claude Design reference renderer
 * (docs/design/handoff-2026-10-13/tools/tiles.src.js), ported 1:1: the reference SVGs are
 * byte-identical only while every rule and every comparison here stays as it is.
 */

export type Weight = 400 | 700;

/** DejaVu Sans advance widths in em, regular (r) and bold (b), from the handoff's adv.json. */
const WIDTHS: { r: Readonly<Record<string, number>>; b: Readonly<Record<string, number>> } = ADV;

/** Advance of a character that is not in the table, in em. */
const FALLBACK_EM = 0.62;

/** True when the width table knows this character (one UTF-16 code unit). */
export function isMeasured(ch: string): boolean {
  return WIDTHS.r[ch] !== undefined;
}

/**
 * Width in px from advance widths, without kerning (resvg differs by at most 2 px).
 * Iterates UTF-16 code units like the reference; a surrogate pair counts as two unknown halves.
 */
export function textWidth(s: string, size: number, weight: Weight): number {
  const table = weight >= 700 ? WIDTHS.b : WIDTHS.r;
  let em = 0;
  for (let i = 0; i < s.length; i++) em += table[s.charAt(i)] ?? FALLBACK_EM;
  return em * size;
}

/** `s` itself when it fits, else the longest prefix plus "…" (trailing spaces dropped); "" if none fits. */
export function fit(s: string, maxW: number, size: number, weight: Weight): string {
  if (textWidth(s, size, weight) <= maxW) return s;
  let out = s;
  while (out.length > 0 && textWidth(`${out}…`, size, weight) > maxW) out = out.slice(0, -1);
  out = out.replace(/\s+$/, "");
  return out.length ? `${out}…` : "";
}

const PICTOGRAPHS = /\p{Extended_Pictographic}|\u200D|\uFE0F/gu;

/** Emoji, joiners and variation selectors removed, whitespace collapsed; "–" when nothing is left. */
export function cleanTitle(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .replace(PICTOGRAPHS, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length ? s : "–";
}

export interface TitleLayout {
  lines: string[];
  size: number;
  /** a single word was broken with a hyphen */
  hard: boolean;
  /** something was elided with "…" */
  cut: boolean;
}

interface Piece {
  t: string;
  /** joins the next piece without a space (soft break inside a word) */
  glue: boolean;
}

function packLines(pieces: Piece[], maxW: number, size: number, weight: Weight): string[] {
  const lines: string[] = [];
  let cur = "";
  let prevGlue = false;
  for (const pc of pieces) {
    const cand = cur ? cur + (prevGlue ? "" : " ") + pc.t : pc.t;
    if (!cur || textWidth(cand, size, weight) <= maxW) cur = cand;
    else {
      lines.push(cur);
      cur = pc.t;
    }
    prevGlue = pc.glue;
  }
  if (cur) lines.push(cur);
  return lines;
}

function softPieces(w: string, maxW: number, size: number, weight: Weight): Piece[] {
  if (textWidth(w, size, weight) <= maxW) return [{ t: w, glue: false }];
  const out: string[] = [];
  let p = "";
  for (const sg of w.split(/(?<=[-_/.])/)) {
    if (p && textWidth(p + sg, size, weight) > maxW) {
      out.push(p);
      p = "";
    }
    p += sg;
  }
  if (p) out.push(p);
  return out.map((t, i) => ({ t, glue: i < out.length - 1 }));
}

function hardBreak(w: string, maxW: number, size: number, weight: Weight): [string, string] {
  let i = 1;
  while (i < w.length && textWidth(`${w.slice(0, i + 1)}-`, size, weight) <= maxW) i++;
  if (w.length - i < 3) i = Math.max(1, w.length - 3);
  const head = w.slice(0, i);
  const tail = w.slice(i);
  return [/[-_/.]$/.test(head) ? head : `${head}-`, tail];
}

/**
 * Two-line title layout. Rules, in order:
 * 1. Break at spaces, then after - _ / . inside long words.
 * 2. Too long for 2 lines and several words: keep head and tail ("Mobile Entw…" / "Northwind").
 * 3. One word longer than a line: hard break with a hyphen, never fewer than 3 letters left.
 * 4. Anything still left over is elided with "…" at the end of line 2.
 */
export function layoutTitle(s: string, maxW: number, size: number, weight: Weight): TitleLayout {
  const words = s.split(" ");
  const pieces = words.flatMap((w) => softPieces(w, maxW, size, weight));
  const lines = packLines(pieces, maxW, size, weight);
  const tooWide = lines.some((l) => textWidth(l, size, weight) > maxW);
  if (lines.length <= 2 && !tooWide) return { lines, size, hard: false, cut: false };
  if (words.length === 1 && lines.length === 1) {
    const [head, tail] = hardBreak(lines[0] ?? "", maxW, size, weight);
    return {
      lines: [head, fit(tail, maxW, size, weight)],
      size,
      hard: true,
      cut: textWidth(tail, size, weight) > maxW,
    };
  }
  if (words.length > 1) {
    let tail: string[] = [];
    let k = words.length - 1;
    while (k > 0 && textWidth(words.slice(k).join(" "), size, weight) <= maxW) {
      tail = words.slice(k);
      k--;
    }
    if (tail.length) {
      const head = words.slice(0, words.length - tail.length).join(" ");
      if (textWidth(head, size, weight) <= maxW)
        return { lines: [head, tail.join(" ")], size, hard: false, cut: false };
      const h = fit(head, maxW, size, weight);
      if (h.replace("…", "").length >= 3)
        return { lines: [h, tail.join(" ")], size, hard: false, cut: true };
    }
  }
  const l1 = fit(lines[0] ?? "", maxW, size, weight);
  const rest = lines.slice(1).join(" ");
  return { lines: [l1, fit(rest, maxW, size, weight)], size, hard: false, cut: true };
}

/** Penalty of a layout: 1 for a hard break, 2 per elided line. */
export function cost(r: TitleLayout): number {
  return (r.hard ? 1 : 0) + 2 * r.lines.filter((l) => l.slice(-1) === "…").length;
}

/**
 * Layout at the first size; while the layout has a cut or a hard break, each next (smaller) size
 * is tried and kept only if it costs less.
 */
export function wrap(
  s: string,
  maxW: number,
  [first, ...smaller]: readonly [number, ...number[]],
  weight: Weight,
): TitleLayout {
  let best = layoutTitle(s, maxW, first, weight);
  for (const size of smaller) {
    if (!best.hard && !best.cut) break;
    const next = layoutTitle(s, maxW, size, weight);
    if (cost(next) < cost(best)) best = next;
  }
  return best;
}
