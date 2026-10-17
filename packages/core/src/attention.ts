import { isAlarm } from "./ranking";
import type { SessionState, SessionView } from "./types";

/** A fresh episode breathes this long. */
const BREATHE_MS = 30_000;
/** After the breathing phase, the oldest unseen episode pulses again at this interval … */
const REMINDER_EVERY_MS = 60_000;
/** … for this many periods. */
const REMINDER_CYCLES = 3;
const PERIOD_MS = 1_200;
const MAX_ANIMATED = 2;

const breathes = (state: SessionState): boolean =>
  state === "needs_permission" || state === "needs_input";

function reminds(v: SessionView, now: number): boolean {
  const sinceCalm = now - (v.episodeSince ?? 0) - BREATHE_MS;
  return (
    sinceCalm >= REMINDER_EVERY_MS && sinceCalm % REMINDER_EVERY_MS < REMINDER_CYCLES * PERIOD_MS
  );
}

/**
 * Which unseen `needs_*` episodes breathe now (handoff §4.1): at most MAX_ANIMATED, the newest
 * episodes in their breathing phase first (a fresh request always breathes, even while older ones
 * wait), then, if a place is left, the reminder pulse of the oldest unseen episode. An unseen
 * done_unseen never breathes: it stands still with a thick frame.
 */
export function animatedIds(views: SessionView[], now: number): Set<string> {
  const since = (v: SessionView): number => v.episodeSince ?? 0;
  const unseen = views.filter(
    (v) => breathes(v.state) && !v.episodeSeen && v.episodeSince !== null,
  );
  // an episode dated in the future (clock set back, skew between hosts) counts as fresh only
  // within one breathing phase, so it cannot hold a breathing place for hours
  const fresh = (v: SessionView): boolean => Math.abs(now - since(v)) < BREATHE_MS;
  const out = unseen
    .filter(fresh)
    .sort((a, b) => since(b) - since(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_ANIMATED)
    .map((v) => v.id);
  const oldest = [...unseen].sort((a, b) => since(a) - since(b) || a.id.localeCompare(b.id))[0];
  if (oldest && out.length < MAX_ANIMATED && !out.includes(oldest.id) && reminds(oldest, now))
    out.push(oldest.id);
  return new Set(out);
}

/** Accent opacity per breath step (handoff Breathing): 4 steps per 1.2 s period. */
export const BREATH_LEVELS = [0.35, 0.675, 1, 0.675] as const;

const STEP_MS = PERIOD_MS / BREATH_LEVELS.length;

/** Breath step 0–3 of an episode; step 0 starts with the episode. */
export function breathStep(now: number, since: number): number {
  const phase = (((now - since) % PERIOD_MS) + PERIOD_MS) % PERIOD_MS;
  return Math.floor(phase / STEP_MS) % BREATH_LEVELS.length;
}

export function breathLevel(now: number, since: number): number {
  return BREATH_LEVELS[breathStep(now, since)] ?? 1;
}

/**
 * Start of the current breath step: a breathing key computes its clock at this moment, so the
 * clock only moves with a breath frame and never costs an extra image.
 */
export function breathStepStart(now: number, since: number): number {
  return since + Math.floor((now - since) / STEP_MS) * STEP_MS;
}

export type FrameWeight = "thick" | "thin" | "normal";

/**
 * Unseen alarms and an unseen done_unseen are thick; a seen alarm is thin; a seen Done is calm
 * again. done_unseen's thick frame is static: it never breathes.
 */
export function frameWeight(v: SessionView): FrameWeight {
  if (isAlarm(v.state)) return v.episodeSeen ? "thin" : "thick";
  if (v.state === "done_unseen" && !v.episodeSeen) return "thick";
  return "normal";
}
