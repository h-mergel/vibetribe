import { isWaitingState } from "@vibetribe/core";
import { glyph } from "./glyphs";
import { clampNum, clockParts, detailLabel, FLASH_TEXT, isInactiveNote } from "./labels";
import { cleanTitle, fit, textWidth, wrap } from "./metrics";
import type { ExtraTile, InboxTile, SlotTile, StatusTile } from "./model";
import {
  amountOf,
  amountSize,
  countSize,
  defaultFrame,
  drawAmount,
  type FrameKind,
  jobsWord,
  LEVEL_COLOR,
  limit,
  overflowPill,
  pillWidth,
  segments,
  frame as sharedFrame,
} from "./shared";
import { escapeXml, n, svgDoc, text } from "./svg";
import { C, HEALTH, S, SAFE, STATES, STROKE, TINT } from "./theme";

/** Variant "compact": every mandatory content of the brief, 10 px margin (reference renderer). */

export { limit };

const frame = (kind: FrameKind, color: string, level = 1): string =>
  sharedFrame(kind, color, STROKE.frameThick, level);

function tint(color: string, level: number): string {
  return `<rect id="vt-tint" x="9" y="9" width="126" height="126" rx="10" fill="${color}" fill-opacity="${n(TINT * level)}"/>`;
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

  /* header: glyph + state word (+ background badge) */
  out += glyph(st.glyph, col, { x: 10, y: 10, filled, tick: m.tick ?? 0 });
  const word = m.state === "background" ? jobsWord(m) : st.word;
  const wordX = 42;
  const wordMax = SAFE.max - wordX + 2; // 2 px: trailing side bearing of the last glyph
  const bgCount = m.bgCount ?? 0;
  let bgW = 0;
  let bgTxt = "";
  if (m.state !== "background" && (bgCount > 0 || m.bgStale)) {
    bgTxt = m.bgStale ? "?" : String(bgCount);
    bgW = 15 + 2 + textWidth(bgTxt, S.meta, 700);
  }
  let wsize: number = textWidth(word, S.word, 700) <= wordMax ? S.word : S.wordMin;
  if (bgW) {
    if (textWidth(word, S.word, 700) <= wordMax - bgW - 3) wsize = S.word;
    else if (textWidth(word, S.wordMin, 700) <= wordMax - bgW - 3) wsize = S.wordMin;
    else bgW = 0; // no room: the state word wins, the badge is omitted
  }
  out += text("vt-state-word", wordX, 31, fit(word, wordMax, wsize, 700), wsize, 700, col);
  if (bgW)
    out +=
      glyph("pie", C.muted, { id: "vt-bg-glyph", x: SAFE.max - bgW, y: 16.5, size: 15 }) +
      text("vt-bg-count", SAFE.max, 31, bgTxt, S.meta, 700, C.muted, "end");

  /* title: 2 lines, 20/400 */
  const tw = wrap(cleanTitle(m.title), 124, [S.title, S.min], 400);
  const titleCol = offline ? C.muted : C.ink;
  out += text("vt-title-1", 10, 64, tw.lines[0] ?? "", tw.size, 400, titleCol);

  /* footer: origin badge right, meta left */
  const { badge } = m;
  out += text("vt-badge", SAFE.max, 127, badge, S.meta, 700, C.muted, "end");
  const footMax = 124 - textWidth(badge, S.meta, 700) - 8;
  let detail = m.detail ? detailLabel(m.detail) : "";
  let footer = "";
  if (m.flash) footer = text("vt-jump", 10, 127, FLASH_TEXT[m.flash], S.meta, 400, C.ink);
  else if (isWaitingState(m.state) && m.wait != null) {
    const [num, unit] = clockParts(m.wait);
    footer =
      text("vt-clock", 10, 127, num, S.clock, 700, C.ink) +
      (unit
        ? text(
            "vt-clock-unit",
            10 + textWidth(num, S.clock, 700) + 4,
            127,
            unit,
            S.meta,
            400,
            C.muted,
          )
        : "");
  }

  const line2 = tw.lines[1];
  if (line2) out += text("vt-title-2", 10, 88, line2, tw.size, 400, titleCol);
  else if (detail && textWidth(detail, S.meta, 400) <= 124) {
    out += text("vt-detail", 10, 88, detail, S.meta, 400, C.muted);
    detail = "";
  }
  if (!footer && detail && textWidth(detail, S.meta, 400) <= footMax)
    footer = text("vt-detail", 10, 127, detail, S.meta, 400, C.muted);
  return svgDoc(out + footer);
}

export function inbox(m: InboxTile): string {
  const top = m.waiting > 0 ? m.top : null;
  let out = glyph("tray", top ? C.ink : C.faint, { x: 10, y: 10 });
  const cycle = m.cycle && m.cycle.total > 1 ? m.cycle : null;
  const big = cycle ? clampNum(cycle.index) : clampNum(m.waiting);
  const of = cycle ? `/${clampNum(cycle.total)}` : "";
  const overflow = m.overflow ?? 0;
  const pillRight = SAFE.max - 1 - pillWidth(overflow) - 6;
  const pillOn = overflow > 0 && !cycle && 46 + textWidth(big, 20, 700) <= pillRight;
  const cs = countSize(big, of, 46, pillOn ? pillRight : SAFE.max);
  out += text("vt-count", 46, 36, big, cs, 700, top ? C.ink : C.faint);
  if (cycle)
    out += text("vt-count-of", 46 + textWidth(big, cs, 700) + 4, 36, of, S.unit, 700, C.muted);
  if (pillOn) out += overflowPill(overflow, SAFE.max, 11); // hidden while cycling or when the count needs the room
  /* divider; while cycling it becomes a segmented position indicator */
  if (cycle) out += segments(cycle, 10, 124, 47);
  else out += `<rect id="vt-divider" x="10" y="48" width="124" height="2" fill="${C.track}"/>`;
  if (top) {
    const st = STATES[top.state];
    const col = C[st.color];
    out += glyph(st.glyph, col, { x: 10, y: 61, size: 20, filled: true, id: "vt-top-glyph" });
    out += m.flash
      ? text("vt-jump", 38, 78, FLASH_TEXT[m.flash], S.meta, 400, C.ink)
      : text("vt-top-word", 38, 78, fit(st.word, 96, S.meta, 700), S.meta, 700, col);
    const lw = wrap(cleanTitle(top.title), 124, [S.title, S.min], 400);
    out += text("vt-top-title-1", 10, 104, lw.lines[0] ?? "", lw.size, 400, C.ink);
    const l2 = lw.lines[1];
    if (l2) out += text("vt-top-title-2", 10, 127, l2, lw.size, 400, C.ink);
  } else {
    out += glyph("check", C.done, { x: 58, y: 64, filled: false, id: "vt-calm" });
    out += text("vt-calm-text", 72, 124, "All clear", S.meta, 400, C.muted, "middle");
  }
  return svgDoc(out);
}

export function extra(m: ExtraTile): string {
  const note = m.note ?? "";
  const off = isInactiveNote(note);
  const dim = m.stale || note === "Sign in" || off;
  const lc = dim ? C.faint : LEVEL_COLOR[m.level ?? "neutral"];
  let out = text("vt-label", 10, 28, "Extra", S.meta, 700, C.muted);
  if (m.ratio != null && !off)
    out += text(
      "vt-pct",
      SAFE.max,
      28,
      `${Math.round(m.ratio * 100)} %`,
      S.meta,
      700,
      dim ? C.muted : C.ink,
      "end",
    );
  const { size, amount } = amountSize(amountOf(m, off), 122);
  out += drawAmount(10, 76, amount, size, off ? C.faint : dim ? C.muted : C.ink);
  let sub = m.note ? note : "No limit";
  if (!m.note && m.limit) {
    const opts = [
      `of ${m.limit}`,
      `of ${String(m.limit).replace(/[.,]00(?=\s*[€$£]|$)/, "")}`,
      String(m.limit),
    ];
    sub = opts.find((o) => textWidth(o, S.meta, 400) <= 124) ?? String(m.limit);
  }
  const strong = note === "Sign in";
  const weight = strong ? 700 : 400;
  out += text(
    m.note ? "vt-note" : "vt-limit",
    10,
    102,
    fit(sub, 124, S.meta, weight),
    S.meta,
    weight,
    strong ? C.ink : off ? C.faint : C.muted,
  );
  if (m.limit || off) {
    out += `<rect id="vt-bar-track" x="10" y="114" width="124" height="${STROKE.bar}" rx="6" fill="${C.track}"/>`;
    if (m.ratio != null && m.ratio > 0 && !off)
      out += `<rect id="vt-bar" x="10" y="114" width="${n(Math.max(12, 124 * Math.min(1, m.ratio)))}" height="${STROKE.bar}" rx="6" fill="${lc}"/>`;
  }
  return svgDoc(out);
}

export function status(m: StatusTile): string {
  let out = "";
  if (m.alert) out += frame("thick", C.error, 1);
  const ys = m.alert ? [30, 54, 78, 102] : [33, 60, 87, 114];
  m.rows.slice(0, 4).forEach((r, i) => {
    const h = HEALTH[r.health];
    const y = ys[i] ?? 0;
    const src = escapeXml(r.source);
    const wordFill = r.health === "off" ? C.faint : r.health === "ok" ? C.muted : C.ink;
    out +=
      `<g id="vt-status-${src}" data-health="${escapeXml(r.health)}">` +
      glyph(h.glyph, C[h.color], { id: `vt-status-glyph-${src}`, x: 10, y: y - 16, size: 20 }) +
      text(`vt-status-label-${src}`, 38, y, r.source, S.meta, 700, C[h.label]) +
      text(
        `vt-status-word-${src}`,
        SAFE.max,
        y,
        h.word,
        S.meta,
        r.health === "missing" ? 700 : 400,
        wordFill,
        "end",
      ) +
      "</g>";
  });
  if (m.alert)
    out += text(
      "vt-alert",
      72,
      127,
      fit(m.alert, 116, S.meta, 700),
      S.meta,
      700,
      C.error,
      "middle",
    );
  return svgDoc(out);
}
