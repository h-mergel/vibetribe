import { type InboxSummary, needsAttention, waitingInOrder } from "@vibetribe/core";
import {
  type Health,
  type HubState,
  INGRESS_PORT_PREFIX,
  INGRESS_TOKEN_MESSAGE,
  REMOTE_SOURCE,
} from "@vibetribe/hub";
import {
  extraTile,
  inboxTile,
  type KeyFlash,
  limitTile,
  type SourceHealth,
  type StatusTile,
  slotTile,
  type Tile,
} from "@vibetribe/render";
import type { KeyPlacement } from "./keys";

/** What the inbox key shows (`inboxView`). */
export interface InboxView {
  summary: InboxSummary;
  /** 1-based position among the waiting sessions while cycling */
  cycle: { index: number; total: number } | null;
}

export interface TileContext {
  now: number;
  /** session ids that breathe this frame (core `animatedIds`) */
  animated: Set<string>;
  /** session id per visible slot index, null = empty slot */
  slotIds: (string | null)[];
  inbox: InboxView;
  timeZone?: string;
  /** press feedback by key id (Deck flashes); absent = none */
  flash?: ReadonlyMap<string, KeyFlash>;
  /** lit working dot, 0–2 (Deck motion); default 0 */
  tick?: number;
  /** step of clocks under one minute (budget guard); default 1 */
  clockStepS?: 1 | 2;
  /** status keys that show all sources (5 s after a tap) */
  expanded?: ReadonlySet<string>;
}

const STATUS_SOURCES: { source: string; matches: (name: string) => boolean }[] = [
  { source: "WIN", matches: (n) => n === "sessions:win" },
  { source: "WSL", matches: (n) => n.startsWith("sessions:wsl:") },
  { source: "REM", matches: (n) => n === REMOTE_SOURCE },
  { source: "LIM", matches: (n) => n === "usage" },
];

const HEALTH_RANK: Record<Health, number> = { ok: 0, stale: 1, missing: 2 };

/**
 * Worst health among the sources of one kind. A kind without any configured source is `off`
 * (not configured, not an error); a configured source that is down stays `missing`.
 */
function healthOf(state: HubState, matches: (name: string) => boolean): SourceHealth {
  let worst: Health | null = null;
  for (const [name, h] of Object.entries(state.sources)) {
    if (!matches(name)) continue;
    if (worst === null || HEALTH_RANK[h.health] > HEALTH_RANK[worst]) worst = h.health;
  }
  return worst ?? "off";
}

/** Short English alert for the status key (≤ 11 chars, handoff); null when the ingress is fine. */
export function statusAlert(state: HubState): string | null {
  const error = state.sources.ingress?.error;
  if (!error) return null;
  if (error.startsWith(INGRESS_PORT_PREFIX)) return "Port in use";
  if (error.includes(INGRESS_TOKEN_MESSAGE)) return "No token";
  return "Error";
}

/** `expanded`: the comfortable tile lists all four sources instead of only the faulty ones. */
export function statusTile(state: HubState, expanded = false): StatusTile {
  return {
    kind: "status",
    rows: STATUS_SOURCES.map((s) => ({ source: s.source, health: healthOf(state, s.matches) })),
    alert: statusAlert(state),
    ...(expanded ? { expanded: true } : {}),
  };
}

/**
 * What the inbox shows: normally the most urgent waiting session; while cycling (5 s after a
 * press) the session that press jumped to (`cycleId`, core `InboxCycler.current`), with its
 * position among the sessions waiting now. A session that stopped waiting ends the cycle display.
 * "+N" (spec §6.3) counts the sessions that need attention and are not on a visible key
 * (`onKeys`); calm sessions without a key are no reason to look at the inbox.
 */
export function inboxView(
  state: HubState,
  onKeys: ReadonlySet<string | null>,
  cycleId: string | null = null,
): InboxView {
  const waiting = waitingInOrder(state.sessions);
  const i = cycleId === null ? -1 : waiting.findIndex((v) => v.id === cycleId);
  const cycled = waiting[i];
  const summary = {
    top: cycled ?? waiting[0] ?? null,
    waitingCount: waiting.length,
    overflowCount: state.sessions.filter((v) => needsAttention(v) && !onKeys.has(v.id)).length,
  };
  return { summary, cycle: cycled ? { index: i + 1, total: waiting.length } : null };
}

/**
 * The tile one key shows for the given hub state. `slotIndex` is the key's position among the
 * slot keys (ignored for other roles). Pure; the deck decides when to render.
 */
export function tileFor(
  key: KeyPlacement,
  slotIndex: number,
  state: HubState,
  ctx: TileContext,
): Tile {
  const { limits } = state;
  switch (key.role) {
    case "slot": {
      const id = ctx.slotIds[slotIndex] ?? null;
      const view = id === null ? undefined : state.sessions.find((v) => v.id === id);
      if (!view) return { kind: "empty" };
      return slotTile(view, {
        now: ctx.now,
        animated: ctx.animated.has(view.id),
        flash: ctx.flash?.get(key.id) ?? null,
        tick: ctx.tick ?? 0,
        clockStepS: ctx.clockStepS ?? 1,
      });
    }
    case "inbox":
      return inboxTile(ctx.inbox.summary, {
        now: ctx.now,
        flash: ctx.flash?.get(key.id) ?? null,
        cycle: ctx.inbox.cycle,
        clockStepS: ctx.clockStepS ?? 1,
      });
    case "limit5h":
      return limitTile("5h", limits.fiveHour, limits.auth, ctx.now, ctx.timeZone);
    case "limitWeek":
      return limitTile("Week", limits.sevenDay, limits.auth, ctx.now, ctx.timeZone);
    case "extra":
      return extraTile(limits.extra, limits.auth, ctx.timeZone);
    case "status":
      return statusTile(state, ctx.expanded?.has(key.id) ?? false);
  }
}
