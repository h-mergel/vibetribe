import {
  type AuthState,
  type BackgroundKind,
  breathLevel,
  breathStepStart,
  type ExtraInactive,
  type ExtraView,
  frameWeight,
  type InboxSummary,
  isWaitingState,
  levelOf,
  type SessionView,
  type WindowView,
} from "@vibetribe/core";
import { formatClock, formatDuration, formatMoney } from "./format";
import type { ExtraTile, InboxTile, KeyFlash, LimitTile, SlotTile } from "./model";
import { tileTitle } from "./title";

export interface ClockContext {
  now: number;
  /**
   * Step of clocks under one minute: 1 s, or 2 s when the budget guard (core `planFrames`) asks
   * for it. Default 1.
   */
  clockStepS?: 1 | 2;
}

export interface SlotContext extends ClockContext {
  /** the key breathes this frame (core `animatedIds`) */
  animated: boolean;
  flash?: KeyFlash | null;
  /** lit working dot, 0–2 (the deck advances it every 2 s); default 0 */
  tick?: number;
}

/**
 * Seconds waited since `since`, as the clock shows them: below one minute in steps of
 * `clockStepS`; never negative (clock jumps).
 */
export function waitSeconds(since: number, at: number, clockStepS: 1 | 2 = 1): number {
  const s = Math.max(0, Math.floor((at - since) / 1000));
  return s < 60 ? s - (s % clockStepS) : s;
}

const KIND_WORD: Record<BackgroundKind, string> = {
  shell: "shell",
  agent: "agent",
  monitor: "monitor",
  other: "job",
};

const KIND_SHORT: Record<BackgroundKind, string> = {
  shell: "sh",
  agent: "ag",
  monitor: "mon",
  other: "job",
};

/** One kind: "2 shell"; several: the short form "2 sh · 1 ag" that fits a footer line. */
function backgroundSplit(kinds: Record<BackgroundKind, number>): string | null {
  const present = (Object.keys(KIND_WORD) as BackgroundKind[]).filter((k) => kinds[k] > 0);
  const only = present.length === 1 ? present[0] : undefined;
  if (only) return `${kinds[only]} ${KIND_WORD[only]}`;
  return present.length ? present.map((k) => `${kinds[k]} ${KIND_SHORT[k]}`).join(" · ") : null;
}

function detailOf(v: SessionView): string | null {
  switch (v.state) {
    case "background":
      return backgroundSplit(v.background.kinds);
    case "working":
      return v.detail;
    case "error":
    case "throttled":
      return v.errorType;
    default:
      return null;
  }
}

export function slotTile(v: SessionView, ctx: SlotContext): SlotTile {
  const since = v.episodeSince;
  const animated = ctx.animated && since !== null;
  // a breathing key's clock moves only with its breath frames (handoff §4.2)
  const clockAt = animated ? breathStepStart(ctx.now, since) : ctx.now;
  return {
    kind: "slot",
    title: tileTitle(v.title, v.cwd),
    state: v.state,
    badge: v.badge,
    wait:
      isWaitingState(v.state) && since !== null
        ? waitSeconds(since, clockAt, ctx.clockStepS)
        : null,
    detail: detailOf(v),
    bgCount: v.background.count,
    bgStale: v.background.stale,
    frame: frameWeight(v),
    level: animated ? breathLevel(ctx.now, since) : 1,
    tick: v.state === "working" ? (ctx.tick ?? 0) : 0,
    ...(ctx.flash ? { flash: ctx.flash } : {}),
  };
}

export interface InboxContext extends ClockContext {
  flash?: KeyFlash | null;
  /** 1-based position in the waiting list while cycling */
  cycle?: { index: number; total: number } | null;
}

export function inboxTile(s: InboxSummary, ctx: InboxContext): InboxTile {
  const top = s.top;
  return {
    kind: "inbox",
    waiting: s.waitingCount,
    top: top
      ? {
          title: tileTitle(top.title, top.cwd),
          state: top.state,
          wait:
            top.episodeSince === null
              ? null
              : waitSeconds(top.episodeSince, ctx.now, ctx.clockStepS),
        }
      : null,
    overflow: s.overflowCount,
    cycle: ctx.cycle ?? null,
    ...(ctx.flash ? { flash: ctx.flash } : {}),
  };
}

export function limitTile(
  label: "5h" | "Week",
  w: WindowView | null,
  auth: AuthState,
  now: number,
  timeZone?: string,
): LimitTile {
  if (!w) {
    return {
      kind: "limit",
      label,
      usedPct: null,
      pacePct: null,
      resetIn: null,
      level: "neutral",
      ahead: false,
      stale: true,
      note: auth === "expired" ? "Sign in" : "No data",
    };
  }
  let note: string | null = null;
  if (auth === "expired") note = "Sign in";
  else if (w.stale) note = `As of ${formatClock(w.receivedAt, timeZone)}`;
  else if (w.rolledOver) note = "New window";
  return {
    kind: "limit",
    label,
    usedPct: w.usedPct,
    pacePct: w.pacePct,
    resetIn: w.resetsAt === null ? null : formatDuration(w.resetsAt - now),
    level: w.level,
    ahead: w.aheadOfPlan,
    stale: w.stale || auth === "expired",
    note,
  };
}

/** Why extra usage is inactive, as the tile note. */
const INACTIVE_NOTE: Record<ExtraInactive, string> = {
  no_credit: "No credit",
  limit_reached: "Limit hit",
  disabled: "Disabled",
  other: "Inactive",
};

export function extraTile(e: ExtraView | null, auth: AuthState, timeZone?: string): ExtraTile {
  if (!e) {
    return {
      kind: "extra",
      used: null,
      limit: null,
      ratio: null,
      level: "neutral",
      stale: true,
      note: auth === "expired" ? "Sign in" : "No data",
    };
  }
  if (!e.enabled)
    return {
      kind: "extra",
      used: null,
      limit: null,
      ratio: null,
      level: "neutral",
      stale: false,
      note: INACTIVE_NOTE[e.inactive ?? "disabled"],
    };
  const ratio = e.monthlyLimit ? e.usedCredits / e.monthlyLimit : null;
  let note: string | null = null;
  if (auth === "expired") note = "Sign in";
  else if (e.stale) note = `As of ${formatClock(e.receivedAt, timeZone)}`;
  return {
    kind: "extra",
    used: formatMoney(e.usedCredits, e.currency),
    limit: e.monthlyLimit === null ? null : formatMoney(e.monthlyLimit, e.currency),
    ratio,
    level: ratio === null ? "neutral" : levelOf(ratio * 100),
    stale: e.stale || auth === "expired",
    note,
  };
}
