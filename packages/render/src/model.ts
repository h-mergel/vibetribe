import type { Badge, LimitLevel, SessionState } from "@vibetribe/core";

/**
 * Tile models of the Claude Design handoff (design-system/components/index.d.ts). Optional fields
 * may be left out, as in the reference samples; `fromCore` always fills them.
 */

/** Brief feedback on a pressed key (spec §9): a jump is under way, or there is nothing to jump to. */
export type KeyFlash = "jumping" | "no_target";

/**
 * Origin values of the handoff (`APP`, `WIN`, `WSL`, `REM`, `?`). Core produces only WIN, WSL and
 * REM; `APP` and `?` remain because the reference samples are fixed data.
 */
export type OriginBadge = Badge | "APP" | "?";

export interface SlotTile {
  kind: "slot";
  /** Desktop session name or folder; wrapped to 2 lines, emoji stripped, empty shows "–". */
  title: string;
  state: SessionState;
  badge: OriginBadge;
  /** Seconds waited ("42 s", "3 min", "1:05 h", "12 h"); shown for the four waiting states. */
  wait?: number | null;
  /** Tool, "Subagent", "Kompaktiert", error kind or job split; shown whole or not at all. */
  detail?: string | null;
  bgCount?: number | null;
  /** Job count unchanged for 30 min: badge and word show "?". */
  bgStale?: boolean;
  /**
   * thick = unseen and needs me / error / Done, thin = seen, normal = none. Absent: thick for
   * done_unseen (handoff v2), none otherwise.
   */
  frame?: "thick" | "thin" | "normal";
  /** Accent opacity for frame and tint: 0.35, 0.675, 1 (breathing steps). */
  level?: number;
  /** working only: which of the three dots is lit (0–2). */
  tick?: number;
  /** Press feedback in the footer ("Open…" / "No link"); absent = none. */
  flash?: KeyFlash;
}

export interface EmptyTile {
  kind: "empty";
}

export interface InboxTop {
  title: string;
  state: SessionState;
  /** seconds the top session has waited (comfortable shows it) */
  wait?: number | null;
}

export interface InboxTile {
  kind: "inbox";
  waiting: number;
  top: InboxTop | null;
  /** Running sessions without a visible slot, shown as "+N". */
  overflow?: number;
  /** While cycling (5 s window): 1-based position in the waiting list. */
  cycle?: { index: number; total: number } | null;
  /** Press feedback ("Open…" / "No link"); absent = none. */
  flash?: KeyFlash;
}

export interface LimitTile {
  kind: "limit";
  label: "5h" | "Week";
  usedPct: number | null;
  pacePct?: number | null;
  /** "42m", "2h 15m", "3d 4h" */
  resetIn?: string | null;
  level?: LimitLevel;
  ahead?: boolean;
  stale?: boolean;
  /** Replaces the reset line: "As of 14:32", "Sign in", "No data", "New window". */
  note?: string | null;
}

export interface ExtraTile {
  kind: "extra";
  /** Preformatted amount with currency sign, e.g. "€12.40"; null = no data. */
  used: string | null;
  limit: string | null;
  ratio: number | null;
  level?: LimitLevel;
  stale?: boolean;
  /** "As of 14:32", "Sign in", "No data", or why extra usage is inactive: "Disabled", "No credit",
   * "Limit hit", "Inactive" (the amount then shows "off"). */
  note?: string | null;
}

/** `off`: no source of this kind is configured (not an error); `missing`: a configured source is down. */
export type SourceHealth = "ok" | "stale" | "missing" | "off";

export interface StatusRow {
  /** "WIN", "WSL", "REM", "LIM" */
  source: string;
  health: SourceHealth;
}

export interface StatusTile {
  kind: "status";
  rows: StatusRow[];
  /** comfortable: all four sources (5 s after a tap) */
  expanded?: boolean;
  /** At most 11 characters, e.g. "Port in use", "No token"; adds a thick error frame. */
  alert?: string | null;
}

export type Tile = SlotTile | EmptyTile | InboxTile | LimitTile | ExtraTile | StatusTile;

/** comfortable (default): fewer elements, larger type; compact: every mandatory content of the brief. */
export type Variant = "comfortable" | "compact";

export const VARIANTS: readonly Variant[] = ["comfortable", "compact"];

export interface RenderOptions {
  variant?: Variant;
}
