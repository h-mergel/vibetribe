import type { SessionView } from "@vibetribe/core";
import {
  type HubConfig,
  ingressError,
  type JumpRecord,
  type PollNowResult,
  type RunningHub,
  startHub,
} from "@vibetribe/hub";
import { DEFAULT_VARIANT, VARIANTS, type Variant } from "@vibetribe/render";
import { DEFAULT_MAX_FRAMES, Deck } from "./deck/deck";
import type { KeyPlacement } from "./deck/keys";
import type { DeckCommand, PressKind } from "./deck/press";
import { InboxOpens } from "./jump/inbox-opens";
import type { JumpOpener, JumpResult } from "./jump/opener";
import { openWebPage, USAGE_SETTINGS_URL } from "./web";

/**
 * Port to the deck hardware (spec §3.1 `DeckSurface`); the SDK adapter and the memory surface implement it.
 * `setImage` answers synchronously whether the image was handed over: the SDK only tells us whether
 * the key is visible (its promise resolves on send, not on display), so there is nothing to await.
 * Neither method throws: the adapter logs its failures.
 */
export interface DeckSurface {
  setImage(keyId: string, image: string): boolean;
  openUrl(url: string): void;
}

/** What the SDK actions call; everything behind it is pure and clocked by the composition. */
export interface DeckController {
  keyAppeared(p: KeyPlacement): void;
  keyDisappeared(id: string): void;
  press(id: string, kind: PressKind): void;
}

export interface VibeTribeOptions {
  surface: DeckSurface;
  hub: HubConfig;
  log: (line: string) => void;
  /** Opens jump links (spec §9). Absent: every jump is logged and fails, nothing is ever opened. */
  opener?: JumpOpener;
  now?: () => number;
  /** deck tick: breathing needs 4 frames per second (spec §5) */
  tickMs?: number;
  maxFramesPerSecond?: number;
  timeZone?: string;
  /** tile layout (VIBETRIBE_VARIANT); default comfortable */
  variant?: Variant;
}

export interface RunningVibeTribe extends DeckController {
  deck: Deck;
  hub: RunningHub;
  /** the hub's port; null while none could be bound */
  readonly port: number | null;
  /**
   * "Prefer pinned sessions": off, and until the first call, slots are assigned as if Claude
   * Desktop pinned nothing.
   */
  setPreferPinned(on: boolean): void;
  stop(): Promise<void>;
}

export const TICK_MS = 250;

/**
 * Time-derived state (stale windows, no-signal, source health, resets) changes without a hub event,
 * so the tick re-reads the hub state at least this often.
 */
export const REFRESH_MS = 1_000;

/** Jumps kept for the mirror on /debug/keys. */
export const JUMP_LOG_SIZE = 10;

/** Sessions whose last jump is remembered for an inbox landing; also caps the inbox jumps kept for the focus. */
export const LAST_JUMP_CAP = 100;

/** VIBETRIBE_MAX_FRAMES: images per second for the whole plugin (probe H), 1–100. */
export function parseMaxFrames(raw: string | undefined): number {
  const n = raw !== undefined && /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_MAX_FRAMES;
}

/**
 * VIBETRIBE_VARIANT: the tile layout, "compact" or "comfortable" (default). Read once at start like
 * VIBETRIBE_MAX_FRAMES; anything else falls back to comfortable.
 */
export function parseVariant(raw: string | undefined): Variant {
  const wanted = raw?.trim().toLowerCase();
  return VARIANTS.find((v) => v === wanted) ?? DEFAULT_VARIANT;
}

/** The log line for one refresh_usage press: every press shows whether it polled, and why not. */
export function pollNowLine(r: PollNowResult): string {
  if (r.started) return "refresh_usage: polling";
  if (r.reason === "recent") {
    return `refresh_usage: ignored (last poll ${Math.round((r.sinceLastMs ?? 0) / 1000)} s ago)`;
  }
  return `refresh_usage: ignored (${r.reason})`;
}

/** Composition root shared by the plugin and the headless mode: hub + deck + loops, no SDK. */
export async function startVibeTribe(o: VibeTribeOptions): Promise<RunningVibeTribe> {
  const now = o.now ?? Date.now;
  const log = o.log;
  const deck = new Deck({
    send: (id, image) => o.surface.setImage(id, image),
    maxFramesPerSecond: o.maxFramesPerSecond,
    timeZone: o.timeZone,
    log,
    ...(o.variant ? { variant: o.variant } : {}),
  });
  const jumps: JumpRecord[] = [];
  /** last jump result per session id, so an inbox landing never counts a failed jump as seen */
  const lastJump = new Map<string, JumpResult | "pending" | "no_target">();
  const inboxOpens = new InboxOpens(LAST_JUMP_CAP);
  const record = (session: SessionView, url: string | null, result: JumpRecord["result"]) => {
    jumps.push({ at: now(), session: session.id, title: session.title, url, result });
    if (jumps.length > JUMP_LOG_SIZE) jumps.splice(0, jumps.length - JUMP_LOG_SIZE);
  };
  const opener: JumpOpener = o.opener ?? {
    open: async (url) => {
      log(`jump not opened (no opener): ${url}`);
      return "failed";
    },
  };
  const running = await startHub({
    ...o.hub,
    now: o.hub.now ?? now,
    focus: inboxOpens.filter(o.hub.focus),
    log,
    mirror: () => ({ ...deck.mirror(now()), jumps: [...jumps] }),
  });
  const { hub } = running;

  // Hub.drainRemovals contract: the consumer drains on every change, before syncing slots.
  let stopped = false;
  let refreshedAt = Number.NEGATIVE_INFINITY;
  /** null until the saved setting is known: the pins wait for it */
  let preferPinned: boolean | null = null;
  const refresh = (): void => {
    refreshedAt = now();
    try {
      const state = hub.state(now());
      const pins = preferPinned === true ? state.pins : [];
      deck.update({ ...state, pins }, hub.drainRemovals(), now());
    } catch (err) {
      log(`deck update failed: ${String(err)}`);
    }
  };
  const off = hub.onChange(refresh);
  refresh();

  // bounded: only the latest sessions matter for a landing 5 s later
  const setLastJump = (id: string, result: JumpResult | "pending" | "no_target"): void => {
    lastJump.delete(id);
    lastJump.set(id, result);
    if (lastJump.size > LAST_JUMP_CAP) lastJump.delete(lastJump.keys().next().value ?? "");
  };

  /** Spec §9, §4.4 (a): open the link; a jump that did not fail marks a slot's session seen. */
  const jump = async (session: SessionView, url: string, markSeen: boolean): Promise<void> => {
    let result: JumpResult = "failed";
    setLastJump(session.id, "pending");
    if (!markSeen && session.hostSessionId !== null) inboxOpens.note(session.hostSessionId, now());
    try {
      result = await opener.open(url);
    } catch (err) {
      log(`jump failed: ${String(err)}`);
    }
    log(`jump to ${session.id} (${session.title}): ${url} (${result})`);
    record(session, url, result);
    setLastJump(session.id, result);
    if (stopped || result === "failed" || !markSeen) return;
    try {
      hub.markSeen(session, now());
    } catch (err) {
      log(`seen after jump failed: ${String(err)}`);
    }
  };

  const execute = (cmd: DeckCommand): void => {
    switch (cmd.type) {
      case "seen":
        hub.markSeen(cmd.session, now());
        break;
      case "open_debug":
        if (running.port === null) log(`open_debug skipped: ${ingressError(running, now())}`);
        else o.surface.openUrl(`http://127.0.0.1:${running.port}/debug`);
        break;
      case "refresh_usage":
        log(pollNowLine(running.pollNow()));
        break;
      case "open_usage":
        // same path as /debug: the Stream Deck app opens the page; headless only records it
        if (openWebPage(o.surface, USAGE_SETTINGS_URL, log))
          log(`open_usage: ${USAGE_SETTINGS_URL}`);
        break;
      case "jump":
        void jump(cmd.session, cmd.url, cmd.markSeen);
        break;
      case "no_target":
        log(`jump: ${cmd.session.id} (${cmd.session.badge}) has no jump target`);
        record(cmd.session, null, "no_target");
        setLastJump(cmd.session.id, "no_target");
        break;
      case "landed": {
        // spec §6.2: seen only after a jump that opened or was logged; pending, failed and no_target never mark
        const last = lastJump.get(cmd.session.id);
        if (last === "opened" || last === "logged") hub.markSeen(cmd.session, now());
        else log(`inbox landed on ${cmd.session.id}; not seen, the jump ${last ?? "did not run"}`);
        break;
      }
    }
  };
  const run = (cmds: DeckCommand[]): void => {
    for (const cmd of cmds) {
      try {
        execute(cmd);
      } catch (err) {
        log(`${cmd.type} failed: ${String(err)}`);
      }
    }
  };
  // every entry from the SDK or the timer is guarded: nothing may end the plugin
  const guarded = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      log(`${what} failed: ${String(err)}`);
    }
  };
  const timer = setInterval(
    () =>
      guarded("deck tick", () => {
        if (now() - refreshedAt >= REFRESH_MS) refresh();
        run(deck.tick(now()));
      }),
    o.tickMs ?? TICK_MS,
  );
  let stopping: Promise<void> | null = null;

  return {
    deck,
    hub: running,
    get port() {
      return running.port;
    },
    keyAppeared: (p) =>
      guarded(`keyAppeared ${p.id}`, () => {
        if (!stopped) deck.keyAppeared(p, now());
      }),
    keyDisappeared: (id) =>
      guarded(`keyDisappeared ${id}`, () => {
        if (!stopped) deck.keyDisappeared(id, now());
      }),
    press: (id, kind) =>
      guarded(`press ${id}`, () => {
        if (!stopped) run(deck.press(id, kind, now()));
      }),
    setPreferPinned: (on) =>
      guarded("setPreferPinned", () => {
        if (stopped || on === preferPinned) return;
        preferPinned = on;
        log(`prefer pinned sessions: ${on ? "on" : "off"}`);
        refresh();
      }),
    stop: () => {
      stopping ??= (async () => {
        stopped = true;
        clearInterval(timer);
        off();
        await running.stop();
      })();
      return stopping;
    },
  };
}

/** Surface without hardware: remembers the last image per key (headless mode, tests). */
export class MemorySurface implements DeckSurface {
  readonly images = new Map<string, string>();
  readonly urls: string[] = [];

  setImage(keyId: string, image: string): boolean {
    this.images.set(keyId, image);
    return true;
  }

  openUrl(url: string): void {
    this.urls.push(url);
  }
}
