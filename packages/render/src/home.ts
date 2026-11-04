import { clampNum } from "./labels";
import type { HomeTile } from "./model";
import { countSize, frame } from "./shared";
import { n, svgDoc, text } from "./svg";
import { C, HEALTH, STATES, STROKE } from "./theme";

/**
 * The logo as a live key: six dots on a circle (top first, then clockwise) as in
 * imgs/plugin/marketplace.svg, moved down so that all of it stays inside the safe area.
 */
const DOWN = 2;
const DOTS: readonly { cx: number; cy: number; r: number }[] = [
  { cx: 72, cy: 26, r: 18 },
  { cx: 111.8, cy: 49, r: 13 },
  { cx: 111.8, cy: 95, r: 13 },
  { cx: 72, cy: 118, r: 13 },
  { cx: 32.2, cy: 95, r: 13 },
  { cx: 32.2, cy: 49, r: 13 },
];

/** The count sits between the left and the right dots. */
const COUNT_LEFT = 47;
const COUNT_RIGHT = 97;
const CAP_HEIGHT = 0.73;

function dot(i: number, color: string | null, level = 1): string {
  const d = DOTS[i] ?? { cx: 0, cy: 0, r: 0 };
  const at = `cx="${d.cx}" cy="${d.cy + DOWN}"`;
  const circle =
    color === null
      ? `<circle ${at} r="${n(d.r - STROKE.frameThin / 2)}" fill="none" stroke="${C.line}" stroke-width="${STROKE.frameThin}"/>`
      : `<circle ${at} r="${d.r}" fill="${color}"${level < 1 ? ` fill-opacity="${n(level)}"` : ""}/>`;
  return `<g id="vt-home-glyph-${i}">${circle}</g>`;
}

/** Same tokens in both variants; `thickFrame` is the variant's thick frame width. */
export function home(m: HomeTile, thickFrame: number): string {
  let out = "";
  if (m.health === "missing") out += frame("thick", C[HEALTH.missing.color], thickFrame);
  else if (m.health === "stale") out += frame("thin", C[HEALTH.stale.color], thickFrame);
  out += m.top ? dot(0, C[STATES[m.top.state].color], m.top.level) : dot(0, null);
  for (let i = 1; i < DOTS.length; i++) {
    const state = m.others[i - 1];
    out += dot(i, state ? C[STATES[state].color] : null);
  }
  if (m.waiting > 0) {
    const count = clampNum(m.waiting);
    const size = countSize(count, "", COUNT_LEFT, COUNT_RIGHT);
    const y = 72 + DOWN + (size * CAP_HEIGHT) / 2;
    out += text("vt-count", 72, y, count, size, 700, C.ink, "middle");
  }
  return svgDoc(out);
}

/** The key inside the bundled profile that leads back to the previous one: an arrow, nothing else. */
export function back(): string {
  return svgDoc(
    `<g id="vt-back-glyph"><path d="M92 72H52M68 54L50 72L68 90" fill="none" stroke="${C.ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  );
}
