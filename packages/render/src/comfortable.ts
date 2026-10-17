import { isWaitingState } from "@vibetribe/core";
import { glyph } from "./glyphs";
import { clampNum, clockParts, detailLabel, FLASH_TEXT, isInactiveNote } from "./labels";
import { cleanTitle, fit, textWidth, wrap } from "./metrics";
import type { ExtraTile, InboxTile, LimitTile, SlotTile, StatusRow, StatusTile } from "./model";
import {
  amountOf,
  amountSize,
  countSize,
  defaultFrame,
  drawAmount,
  type FrameKind,
  jobsWord,
  LEVEL_COLOR,
  overflowPill,
  pillWidth,
  segments,
  frame as sharedFrame,
  limit as sharedLimit,
} from "./shared";
import { type Anchor, escapeXml, n, svgDoc, text as svgText } from "./svg";
import { C, HEALTH, S, STATES, STROKE, TINT } from "./theme";

/**
 * Variant "comfortable" (calm, the default): fewer elements, larger type, 14 px margin. Same tokens,
 * glyphs, states and ids as "compact"; only layout and what is shown differ (reference renderer).
 * Handoff v2: title 22 px (→ 20 → 18), state word 20 px (→ 18), regular texts with `stroke-text`.
 */
const CALM = { m: 14, max: 130, w: 116, title: 22, titleStep: 20, word: 20 } as const;

function text(
  id: string,
  x: number,
  y: number,
  s: string,
  size: number,
  weight: 400 | 700,
  fill: string,
  anchor: Anchor = "start",
): string {
  return svgText(id, x, y, s, size, weight, fill, anchor, STROKE.text);
}

/** The gauge is shared; comfortable adds the text outline. */
export const limit = (m: LimitTile): string => sharedLimit(m, STROKE.text);

const frame = (kind: FrameKind, color: string, level = 1): string =>
  sharedFrame(kind, color, STROKE.frameThickCalm, level);

function tint(color: string, level: number): string {
  return `<rect id="vt-tint" x="6" y="6" width="132" height="132" rx="12" fill="${color}" fill-opacity="${n(TINT * level)}"/>`;
}

function clockText(id: string, x: number, y: number, wait: number, size: number): string {
  const [num, unit] = clockParts(wait);
  return (
    text(id, x, y, num, size, 700, C.ink) +
    (unit
      ? text(`${id}-unit`, x + textWidth(num, size, 700) + 4, y, unit, S.meta, 400, C.muted)
      : "")
  );
}

export function slot(m: SlotTile): string {
  const st = STATES[m.state];
  const col = C[st.color];
  const frameKind = m.frame ?? defaultFrame(m);
  const level = m.level ?? 1;
  const filled = frameKind === "thick" || m.state === "done_unseen";
  const offline = m.state === "no_signal";
  let out = "";
  if (frameKind === "thick") out += tint(col, level) + frame("thick", col, level);
  else if (frameKind === "thin") out += frame("thin", col);
  else if (offline) out += frame("dashed", C.faint);

  /* header: glyph 22 + state word 20/700, 18 when it does not fit (+ background badge when the
     footer holds a clock) */
  out += glyph(st.glyph, col, { x: CALM.m, y: 16, size: 22, filled, tick: m.tick ?? 0 });
  const word = m.state === "background" ? jobsWord(m) : st.word;
  const hasClock = !m.flash && isWaitingState(m.state) && m.wait != null;
  const bgCount = m.bgCount ?? 0;
  let bgOn = m.state !== "background" && (bgCount > 0 || m.bgStale === true);
  const bt = bgOn ? (m.bgStale ? "?" : clampNum(bgCount)) : "";
  const bgW = bgOn ? 15 + 2 + textWidth(bt, S.meta, 700) : 0;
  const bgBadge = (x: number, base: number): string =>
    glyph("pie", C.muted, { id: "vt-bg-glyph", x, y: base - 14.5, size: 15 }) +
    text("vt-bg-count", x + 17, base, bt, S.meta, 700, C.muted);
  const wordRoom = CALM.max - 42 + 2;
  let headerBg = false;
  if (bgOn && hasClock) {
    // in the header, or omitted when the word needs the room (Approve)
    if (textWidth(word, S.wordMin, 700) <= wordRoom - bgW - 6) {
      headerBg = true;
      out += bgBadge(CALM.max - bgW, 34);
    }
    bgOn = false;
  }
  const ws =
    textWidth(word, CALM.word, 700) <= wordRoom - (headerBg ? bgW + 6 : 0) ? CALM.word : S.wordMin;
  out += text("vt-state-word", 42, 34, fit(word, wordRoom, ws, 700), ws, 700, col);

  /* title: 22 px, 2 lines */
  const tw = wrap(cleanTitle(m.title), CALM.w, [CALM.title, CALM.titleStep, S.min], 400);
  const titleCol = offline ? C.muted : C.ink;
  out += text("vt-title-1", CALM.m, 72, tw.lines[0] ?? "", tw.size, 400, titleCol);
  const line2 = tw.lines[1];
  if (line2) out += text("vt-title-2", CALM.m, 99, line2, tw.size, 400, titleCol);
  else if (m.state === "error" && m.detail) {
    // error kind only, and only when the title leaves room
    const d = detailLabel(m.detail);
    if (textWidth(d, S.meta, 400) <= CALM.w)
      out += text("vt-detail", CALM.m, 99, d, S.meta, 400, C.muted);
  }

  /* footer: origin always right; left: clock, press feedback, or the background badge */
  const { badge } = m;
  out += text("vt-badge", CALM.max, 126, badge, S.meta, 700, C.muted, "end");
  if (m.flash) out += text("vt-jump", CALM.m, 126, FLASH_TEXT[m.flash], S.meta, 400, C.ink);
  else if (hasClock && m.wait != null) {
    const [num, unit] = clockParts(m.wait);
    const room = CALM.w - textWidth(badge, S.meta, 700) - 8;
    const size = textWidth(num, 22, 700) + 4 + textWidth(unit, S.meta, 400) <= room ? 22 : S.clock;
    out += clockText("vt-clock", CALM.m, 126, m.wait, size);
  } else if (bgOn) out += bgBadge(CALM.m, 126);
  return svgDoc(out);
}

export function inbox(m: InboxTile): string {
  const top = m.waiting > 0 ? m.top : null;
  const cycle = m.cycle && m.cycle.total > 1 ? m.cycle : null;
  let out = glyph("tray", top ? C.ink : C.faint, { x: CALM.m, y: 15, size: 24 });
  const big = cycle ? clampNum(cycle.index) : clampNum(m.waiting);
  const of = cycle ? `/${clampNum(cycle.total)}` : "";
  const overflow = m.overflow ?? 0;
  const pillRight = CALM.max - pillWidth(overflow) - 6;
  const pillOn = overflow > 0 && !cycle && 46 + textWidth(big, 20, 700) <= pillRight;
  const cs = countSize(big, of, 46, pillOn ? pillRight : CALM.max);
  out += text("vt-count", 46, 39, big, cs, 700, top ? C.ink : C.faint);
  if (cycle)
    out += text("vt-count-of", 46 + textWidth(big, cs, 700) + 4, 39, of, S.unit, 700, C.muted);
  else if (pillOn) out += overflowPill(overflow, CALM.max + 1, 14);
  if (cycle) out += segments(cycle, CALM.m, CALM.w, 53);
  else
    out += `<rect id="vt-divider" x="${CALM.m}" y="54" width="${CALM.w}" height="2" fill="${C.track}"/>`;
  if (top) {
    // "Next" key: what is up next, never the title (that is on the slot)
    const st = STATES[top.state];
    const col = C[st.color];
    out += glyph(st.glyph, col, { x: CALM.m, y: 72, size: 24, filled: true, id: "vt-top-glyph" });
    const room = CALM.max - 46 + 2;
    const ws = textWidth(st.word, CALM.word, 700) <= room ? CALM.word : S.wordMin;
    out += text("vt-top-word", 46, 92, fit(st.word, room, ws, 700), ws, 700, col);
    // press feedback takes the clock's place for its 1–2 s, as on a slot
    if (m.flash) out += text("vt-jump", CALM.m, 126, FLASH_TEXT[m.flash], S.meta, 400, C.ink);
    else if (top.wait != null) out += clockText("vt-top-clock", CALM.m, 126, top.wait, S.clock);
    out += text("vt-next", CALM.max, 126, "next", S.meta, 400, C.muted, "end");
  } else {
    out += glyph("check", C.done, { x: 58, y: 70, filled: false, id: "vt-calm" });
    out += text("vt-calm-text", 72, 124, "All clear", S.meta, 400, C.muted, "middle");
  }
  return svgDoc(out);
}

export function extra(m: ExtraTile): string {
  const note = m.note ?? "";
  const off = isInactiveNote(note);
  const dim = m.stale || note === "Sign in" || off;
  const lc = dim ? C.faint : LEVEL_COLOR[m.level ?? "neutral"];
  let out = text("vt-label", CALM.m, 34, "Extra", S.meta, 700, C.muted);
  if (m.ratio != null && !off)
    out += text(
      "vt-pct",
      CALM.max,
      34,
      `${Math.round(m.ratio * 100)} %`,
      S.meta,
      700,
      dim ? C.muted : C.ink,
      "end",
    );
  const { size, amount } = amountSize(amountOf(m, off), CALM.w - 2);
  out += drawAmount(CALM.m, 82, amount, size, off ? C.faint : dim ? C.muted : C.ink);
  if (m.note) {
    const strong = note === "Sign in";
    const weight = strong ? 700 : 400;
    out += text(
      "vt-note",
      CALM.m,
      124,
      fit(note, CALM.w, S.meta, weight),
      S.meta,
      weight,
      strong ? C.ink : off ? C.faint : C.muted,
    );
  } else if (m.limit) {
    out += `<rect id="vt-bar-track" x="${CALM.m}" y="110" width="${CALM.w}" height="${STROKE.bar}" rx="6" fill="${C.track}"/>`;
    if (m.ratio != null && m.ratio > 0)
      out += `<rect id="vt-bar" x="${CALM.m}" y="110" width="${n(Math.max(12, CALM.w * Math.min(1, m.ratio)))}" height="${STROKE.bar}" rx="6" fill="${lc}"/>`;
  } else out += text("vt-limit", CALM.m, 124, "No limit", S.meta, 400, C.muted);
  return svgDoc(out);
}

function row(
  r: StatusRow,
  y: number,
  labelFill: string,
  wordX: number,
  anchor: "start" | "end",
): string {
  const h = HEALTH[r.health];
  const src = escapeXml(r.source);
  const wordFill =
    anchor === "start"
      ? C.muted
      : r.health === "off"
        ? C.faint
        : r.health === "ok"
          ? C.muted
          : C.ink;
  return (
    `<g id="vt-status-${src}" data-health="${r.health}">` +
    glyph(h.glyph, C[h.color], { id: `vt-status-glyph-${src}`, x: CALM.m, y: y - 15, size: 18 }) +
    text(`vt-status-label-${src}`, 36, y, r.source, S.meta, 700, labelFill) +
    text(`vt-status-word-${src}`, wordX, y, h.word, S.meta, 400, wordFill, anchor) +
    "</g>"
  );
}

export function status(m: StatusTile): string {
  const bad = m.rows.filter((r) => r.health === "stale" || r.health === "missing");
  const okCount = m.rows.filter((r) => r.health === "ok").length;
  let out = m.alert ? frame("thick", C.error, 1) : "";
  if (m.expanded) {
    // tap: all sources for 5 s
    const ey = m.alert ? [32, 56, 80, 104] : [36, 64, 92, 120];
    m.rows.slice(0, 4).forEach((r, i) => {
      out += row(r, ey[i] ?? 0, C[HEALTH[r.health].label], CALM.max, "end");
    });
    if (m.alert)
      out += text(
        "vt-alert",
        72,
        127,
        fit(m.alert, CALM.w, S.meta, 700),
        S.meta,
        700,
        C.error,
        "middle",
      );
    return svgDoc(out);
  }
  if (m.alert && !bad.length) {
    out += glyph("octagon", C.error, {
      x: 54,
      y: 24,
      size: 36,
      filled: true,
      id: "vt-alert-glyph",
    });
    out += text(
      "vt-alert",
      72,
      96,
      fit(m.alert, CALM.w, S.meta, 700),
      S.meta,
      700,
      C.ink,
      "middle",
    );
    out += text("vt-status-count", 72, 122, "Sources ok", S.meta, 400, C.muted, "middle");
    return svgDoc(out);
  }
  if (!bad.length) {
    out += glyph("check", C.done, { x: 52, y: 24, size: 40, id: "vt-status-all-ok" });
    out += text("vt-status-summary", 72, 96, "Sources ok", S.meta, 700, C.ink, "middle");
    out += text("vt-status-count", 72, 122, `${okCount} active`, S.meta, 400, C.muted, "middle");
    return svgDoc(out);
  }
  const ys = m.alert ? [36, 68] : [38, 70, 102];
  bad.slice(0, ys.length).forEach((r, i) => {
    out += row(r, ys[i] ?? 0, C.ink, 36 + textWidth(r.source, S.meta, 700) + 5, "start");
  });
  if (m.alert)
    out += text(
      "vt-alert",
      72,
      122,
      fit(m.alert, CALM.w, S.meta, 700),
      S.meta,
      700,
      C.error,
      "middle",
    );
  else if (okCount) out += text("vt-status-rest", CALM.m, 126, "Others ok", S.meta, 400, C.muted);
  return svgDoc(out);
}
