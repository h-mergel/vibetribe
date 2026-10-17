import { glyph } from "./glyphs";
import { clampNum, splitEuro } from "./labels";
import { fit, textWidth } from "./metrics";
import type { ExtraTile, LimitTile, SlotTile } from "./model";
import { n, svgDoc, text } from "./svg";
import { C, S, STROKE } from "./theme";

/** Pieces both variants share (reference renderer): empty slot, limit gauge, amounts, counts. */

export const LEVEL_COLOR = { neutral: C.neutral, amber: C.permission, red: C.error } as const;

export function empty(): string {
  return svgDoc(
    `<rect id="vt-empty" x="50" y="50" width="44" height="44" rx="12" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="5 6"/>`,
  );
}

/* ---------- limit gauge: 250° ring, open at the bottom ---------- */
const GAUGE = { cx: 72, cy: 72, r: 54, sweep: 250, start: 235 } as const;
const ARC_LEN = (GAUGE.r * GAUGE.sweep * Math.PI) / 180;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [GAUGE.cx + r * Math.cos(a), GAUGE.cy + r * Math.sin(a)];
}

function arcPath(r: number): string {
  const a = polar(r, GAUGE.start);
  const b = polar(r, GAUGE.start + GAUGE.sweep);
  return `M${n(a[0])} ${n(a[1])} A${r} ${r} 0 1 1 ${n(b[0])} ${n(b[1])}`;
}

/** The gauge is already calm: both variants draw the same limit tile (comfortable with `stroke-text`). */
export function limit(m: LimitTile, strokeText = 0): string {
  let out = "";
  const used = m.usedPct;
  const has = used != null;
  const note = m.note ?? "";
  const dim = m.stale || note === "Sign in";
  const lc = dim ? C.faint : LEVEL_COLOR[m.level ?? "neutral"];
  out += `<path id="vt-ring-track" d="${arcPath(GAUGE.r)}" fill="none" stroke="${C.track}" stroke-width="${STROKE.ring}"/>`;
  if (has && used > 0) {
    const len = (ARC_LEN * Math.min(100, used)) / 100;
    out += `<path id="vt-ring" d="${arcPath(GAUGE.r)}" fill="none" stroke="${lc}" stroke-width="${STROKE.ring}" stroke-dasharray="${n(len)} 400"/>`;
  }
  if (m.pacePct != null && has && !dim) {
    const ang = GAUGE.start + (GAUGE.sweep * Math.min(100, m.pacePct)) / 100;
    const p1 = polar(45, ang);
    const p2 = polar(62, ang);
    const xy = `x1="${n(p1[0])}" y1="${n(p1[1])}" x2="${n(p2[0])}" y2="${n(p2[1])}"`;
    out +=
      `<g id="vt-pace" data-angle="${n(ang)}">` +
      `<line ${xy} stroke="${C.ground}" stroke-width="${STROKE.paceGap}"/>` +
      `<line ${xy} stroke="${C.ink}" stroke-width="${STROKE.pace}"/></g>`;
  }
  out += text("vt-label", 72, 58, m.label, S.meta, 700, C.muted, "middle");
  const num = has ? String(Math.round(used)) : "–";
  const nw = textWidth(num, S.pct, 700);
  const uw = has ? textWidth("%", S.unit, 700) + 2 : 0;
  const aw = m.ahead && has && !dim ? 22 : 0;
  const x0 = 72 - (nw + uw + aw) / 2;
  out += text("vt-pct", x0, 92, num, S.pct, 700, dim ? C.muted : C.ink);
  if (has) out += text("vt-pct-unit", x0 + nw + 2, 92, "%", S.unit, 700, C.muted);
  if (aw) out += glyph("arrowUp", lc, { id: "vt-ahead", x: x0 + nw + uw + 6, y: 74, size: 18 });
  const strong = note === "Sign in";
  const weight = strong ? 700 : 400;
  const foot = m.note ? note : (m.resetIn ?? "");
  out += text(
    m.note ? "vt-note" : "vt-reset",
    72,
    130,
    fit(foot, 124, S.meta, weight),
    S.meta,
    weight,
    strong ? C.ink : C.muted,
    "middle",
    strokeText,
  );
  return svgDoc(out);
}

/* ---------- counts and pills ---------- */

/** Count (+ "/total") shrinks 34 → 28 → 24 → 20 to fit between x0 and the right limit. */
export function countSize(big: string, of: string, x0: number, right: number): number {
  for (const size of [S.count, 28, 24, 20]) {
    if (x0 + textWidth(big, size, 700) + (of ? 4 + textWidth(of, S.unit, 700) : 0) <= right)
      return size;
  }
  return 20;
}

export function pillWidth(count: number): number {
  return textWidth(`+${clampNum(count)}`, S.meta, 700) + 14;
}

/** "+N" pill, right-aligned at `right`, top at `y`. */
export function overflowPill(count: number, right: number, y: number): string {
  const o = `+${clampNum(count)}`;
  const ow = pillWidth(count);
  return (
    `<rect id="vt-overflow-pill" x="${n(right - 1 - ow)}" y="${y + 1}" width="${n(ow)}" height="24" rx="12" fill="none" stroke="${C.line}" stroke-width="2"/>` +
    text("vt-overflow", right - 1 - ow / 2, y + 19, o, S.meta, 700, C.muted, "middle")
  );
}

/* ---------- amounts ---------- */

/** [number, currency sign, sign first] as from `splitEuro`. */
export type Amount = [string, string, boolean];

function amountFits(a: Amount, size: number, maxW: number): boolean {
  return textWidth(a[0], size, 700) + (a[1] ? 6 + textWidth("€", S.unit, 700) : 0) <= maxW;
}

/**
 * Largest amount size step that fits; falls back to a compact number ("1.2M", "12k") when even
 * 18 px does not fit, and to 18 px when that does not fit either.
 */
export function amountSize(amt: Amount, maxW: number): { size: number; amount: Amount } {
  for (const size of S.amount) if (amountFits(amt, size, maxW)) return { size, amount: amt };
  const raw = amt[0];
  const dec = /[.,](\d{2})$/.exec(raw);
  const v = Number.parseFloat(
    raw.slice(0, dec ? -3 : undefined).replace(/[.,\s]/g, "") + (dec ? `.${dec[1]}` : ""),
  );
  const compact: Amount = [...amt];
  if (!Number.isNaN(v))
    compact[0] =
      v >= 1e9
        ? `${(v / 1e9).toFixed(1)}B`
        : v >= 1e6
          ? `${(v / 1e6).toFixed(1)}M`
          : `${Math.round(v / 1e3)}k`;
  for (const size of S.amount)
    if (amountFits(compact, size, maxW)) return { size, amount: compact };
  return { size: S.min, amount: compact };
}

export function drawAmount(x: number, y: number, amt: Amount, size: number, color: string): string {
  if (!amt[1]) return text("vt-amount", x, y, amt[0], size, 700, color);
  const uw = textWidth(amt[1], S.unit, 700);
  if (amt[2])
    return (
      text("vt-amount-unit", x, y, amt[1], S.unit, 700, C.muted) +
      text("vt-amount", x + uw + 3, y, amt[0], size, 700, color)
    );
  return (
    text("vt-amount", x, y, amt[0], size, 700, color) +
    text("vt-amount-unit", x + textWidth(amt[0], size, 700) + 5, y, amt[1], S.unit, 700, C.muted)
  );
}

/* ---------- small shared pieces ---------- */

/** "3 jobs", "? jobs" (stale count), "Jobs" (no count) for the background state. */
export function jobsWord(m: SlotTile): string {
  if (m.bgStale) return "? jobs";
  return (m.bgCount ?? 0) > 0 ? `${m.bgCount} jobs` : "Jobs";
}

/** Position indicator while cycling: at most 12 segments, the current one in `ink`. */
export function segments(
  cycle: { index: number; total: number },
  x: number,
  width: number,
  y: number,
): string {
  const segs = Math.min(cycle.total, 12);
  const gap = segs > 6 ? 2 : 4;
  const w = (width - gap * (segs - 1)) / segs;
  let s = "";
  for (let i = 0; i < segs; i++)
    s += `<rect x="${n(x + i * (w + gap))}" y="${y}" width="${n(w)}" height="4" rx="2" fill="${i + 1 === Math.min(cycle.index, segs) ? C.ink : C.line}"/>`;
  return `<g id="vt-cycle">${s}</g>`;
}

/** Amount of an extra tile: "off" when disabled, "–" without data. */
export function amountOf(m: ExtraTile, off: boolean): Amount {
  if (off) return ["off", "", false];
  return m.used != null ? splitEuro(m.used) : ["–", "", false];
}

/** Frame of a slot whose model names none: done_unseen is framed thick (handoff v2), others not. */
export const defaultFrame = (m: SlotTile): "thick" | "normal" =>
  m.state === "done_unseen" ? "thick" : "normal";

/* ---------- frame ---------- */

/**
 * A deliberate deviation from the handoff: the hardware bezel hides the
 * outer pixels of a key, so every frame's outer edge sits 2 px inside the tile (the handoff draws
 * it at 0–1 px). The outer corner radius stays as in the handoff.
 */
const FRAME_INSET = 2;
const FRAME_OUTER_RADIUS = { thick: 18, thin: 17.5, dashed: 17 } as const;

export type FrameKind = keyof typeof FRAME_OUTER_RADIUS;

/**
 * `vt-frame`: thick (accent, breathing opacity; stroke width per variant), thin (accent) or dashed
 * (offline).
 */
export function frame(kind: FrameKind, color: string, thickWidth: number, level = 1): string {
  const strokeWidth =
    kind === "thick" ? thickWidth : kind === "thin" ? STROKE.frameThin : STROKE.frameDash;
  const half = strokeWidth / 2;
  const xy = n(FRAME_INSET + half);
  const size = n(144 - 2 * (FRAME_INSET + half));
  const rx = n(FRAME_OUTER_RADIUS[kind] - half);
  const rect = `<rect id="vt-frame" x="${xy}" y="${xy}" width="${size}" height="${size}" rx="${rx}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"`;
  if (kind === "thick") return `${rect} stroke-opacity="${n(level)}"/>`;
  if (kind === "thin") return `${rect}/>`;
  return `${rect} stroke-dasharray="6 6"/>`;
}
