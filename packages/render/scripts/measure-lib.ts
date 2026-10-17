import type { Box } from "../src/png";
import { S, SAFE } from "../src/theme";

/**
 * Layout check of a rendered tile, ported from the handoff's tools/review.mjs and build.mjs:
 * every text and symbol inside the safe area (SAFE), no text below the minimum size (S.min), no
 * two elements overlapping. Boxes come from resvg (`boxOf`), so results depend on the installed
 * DejaVu Sans.
 */

/** Half a pixel on the safe area: anti-aliasing (the handoff measured the same way). */
const TOLERANCE = 0.5;
/** Boxes may touch by up to 2 px (side bearings, kerning), as in review.mjs. */
const GAP = 2;

export interface TileElement {
  id: string;
  /** the element alone, to be measured in isolation */
  fragment: string;
  /** font size of a `<text>`, null for symbols and shapes */
  size: number | null;
}

export interface PlacedElement extends TileElement {
  box: Box;
}

const TEXT = /<text [^>]*>[^<]*<\/text>/g;
const GROUP = /<g id="(vt-[a-z-]*glyph[^"]*|vt-ahead|vt-calm|vt-top-glyph|vt-bg-glyph)"/g;
const PILL = /<rect id="vt-overflow-pill"[^>]*\/>/g;

const attr = (el: string, name: string): string =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(el)?.[1] ?? "";

/** Texts, symbol groups (nested groups included) and the overflow pill of one tile. */
export function extractElements(svg: string): TileElement[] {
  const out: TileElement[] = [];
  for (const m of svg.matchAll(TEXT))
    out.push({ id: attr(m[0], "id"), fragment: m[0], size: Number(attr(m[0], "font-size")) });
  for (const m of svg.matchAll(GROUP)) {
    const tags = /<g[ >]|<\/g>/g;
    tags.lastIndex = m.index;
    let depth = 0;
    for (let t = tags.exec(svg); t; t = tags.exec(svg)) {
      depth += t[0] === "</g>" ? -1 : 1;
      if (depth === 0) {
        out.push({ id: m[1] ?? "", fragment: svg.slice(m.index, t.index + 4), size: null });
        break;
      }
    }
  }
  for (const m of svg.matchAll(PILL))
    out.push({ id: "vt-overflow-pill", fragment: m[0], size: null });
  return out;
}

/** Elements with their measured boxes; elements that draw nothing are dropped. */
export function place(svg: string, measure: (fragment: string) => Box | null): PlacedElement[] {
  return extractElements(svg).flatMap((e) => {
    const box = measure(e.fragment);
    return box ? [{ ...e, box }] : [];
  });
}

const f = (v: number): string => v.toFixed(1);

/** Human-readable findings; empty when the tile is fine. */
export function layoutIssues(elements: PlacedElement[]): string[] {
  const issues: string[] = [];
  for (const e of elements) {
    const { x, y, width, height } = e.box;
    const lo = SAFE.min - TOLERANCE;
    const hi = SAFE.max + TOLERANCE;
    if (x < lo || y < lo || x + width > hi || y + height > hi)
      issues.push(
        `${e.id} outside [${SAFE.min}, ${SAFE.max}]: x=${f(x)} y=${f(y)} r=${f(x + width)} b=${f(y + height)}`,
      );
    if (e.size !== null && e.size < S.min) issues.push(`${e.id} below ${S.min} px`);
  }
  for (let i = 0; i < elements.length; i++)
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      if (!a || !b) continue;
      const pill = new Set([a.id, b.id]);
      if (pill.has("vt-overflow") && pill.has("vt-overflow-pill")) continue; // the count sits in its pill
      const A = a.box;
      const B = b.box;
      if (
        A.x < B.x + B.width - GAP &&
        B.x < A.x + A.width - GAP &&
        A.y < B.y + B.height - GAP &&
        B.y < A.y + A.height - GAP
      )
        issues.push(`${a.id} overlaps ${b.id}`);
    }
  return issues;
}
