import type { SessionState } from "@vibetribe/core";
import type { SourceHealth } from "./model";

/** Design tokens of the Claude Design handoff (design-system/tokens.json, mirrored by the reference renderer). */
export const C = {
  ground: "#0E1116",
  track: "#262C35",
  line: "#3A424E",
  ink: "#F3F5F8",
  muted: "#A9B2BF",
  faint: "#7A8494",
  permission: "#FFB524",
  input: "#E879C4",
  error: "#FF5C33",
  done: "#30D6A4",
  throttled: "#B4C8E8",
  working: "#3D8EF5",
  idle: "#8D97A6",
  offline: "#7A8494",
  neutral: "#C3CDDA",
} as const;

export type ColorToken = keyof typeof C;

export const FONT = "DejaVu Sans, Segoe UI, Arial, sans-serif";

/** Text and meaning stay inside [min, max]; only frames and tint reach the edge. */
export const SAFE = { min: 10, max: 134 } as const;

/** Font sizes in px (at 144 px); 18 is the minimum. */
export const S = {
  word: 20,
  wordMin: 18,
  title: 20,
  meta: 18,
  clock: 20,
  count: 34,
  pct: 32,
  unit: 20,
  amount: [34, 30, 28, 24, 20, 18],
  min: 18,
} as const;

export const STROKE = {
  /** compact; 8 in the handoff, 7 since the frame inset (`frame`), so its inner edge stays at 9 px */
  frameThick: 7,
  frameThickCalm: 6,
  frameThin: 3,
  frameDash: 2,
  glyph: 3.4,
  ring: 10,
  pace: 3.5,
  paceGap: 9,
  bar: 12,
  badge: 2,
  /** `stroke-text`: comfortable outlines regular text in its own colour (handoff v2) */
  text: 0.7,
} as const;

/** Accent tint behind an urgent tile, multiplied by the breath level. */
export const TINT = 0.12;

export type GlyphName =
  | "diamond"
  | "bubble"
  | "octagon"
  | "check"
  | "hourglass"
  | "dots"
  | "pie"
  | "dash"
  | "unplugged"
  | "tray"
  | "hcheck"
  | "hclock"
  | "hcross"
  | "hdash"
  | "arrowUp";

export interface StateStyle {
  word: string;
  color: ColorToken;
  glyph: GlyphName;
}

/** State word, accent and glyph per session state (handoff README › Sprache, Symbole). */
export const STATES: Record<SessionState, StateStyle> = {
  needs_permission: { word: "Approve", color: "permission", glyph: "diamond" },
  needs_input: { word: "Input", color: "input", glyph: "bubble" },
  error: { word: "Error", color: "error", glyph: "octagon" },
  done_unseen: { word: "Done", color: "done", glyph: "check" },
  throttled: { word: "Limited", color: "throttled", glyph: "hourglass" },
  working: { word: "Working", color: "working", glyph: "dots" },
  background: { word: "jobs", color: "working", glyph: "pie" },
  idle: { word: "Idle", color: "idle", glyph: "dash" },
  no_signal: { word: "Offline", color: "offline", glyph: "unplugged" },
};

/** Short forms of details; anything else (tool names) is shown as it is. */
export const DETAIL: Readonly<Record<string, string>> = {
  server_error: "Server",
  billing_error: "Billing",
  rate_limit: "Rate limit",
  overloaded: "Overloaded",
  Subagent: "Subagent",
  Kompaktiert: "Compacting",
};

export interface HealthStyle {
  word: string;
  glyph: GlyphName;
  color: ColorToken;
  label: ColorToken;
}

export const HEALTH: Record<SourceHealth, HealthStyle> = {
  ok: { word: "ok", glyph: "hcheck", color: "done", label: "muted" },
  stale: { word: "stale", glyph: "hclock", color: "permission", label: "ink" },
  missing: { word: "down", glyph: "hcross", color: "error", label: "ink" },
  off: { word: "off", glyph: "hdash", color: "faint", label: "faint" },
};
