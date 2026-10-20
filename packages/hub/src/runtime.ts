import { DEFAULT_PORT, parsePortNumber } from "@vibetribe/protocol";
import { type BackgroundPorts, keepBackgrounds } from "./background/keeper";
import { type DesktopPorts, pollDesktop } from "./desktop-poll";
import type { CheckResult } from "./doctor/check";
import { watchDrift } from "./doctor/watch";
import type { DeckMirror } from "./http/keys";
import { createListener } from "./http/listener";
import { Hub } from "./hub";
import { REMOTE_SOURCE } from "./remote/names";
import { REMOTE_POLL_MS, RemotePoller, type RemotePorts } from "./remote/poller";
import { isInactive, type SessionSource } from "./sessions/sources";
import { POLL_MS, UsagePoller, type UsagePorts } from "./usage/poller";
import type { TokenRefresher } from "./usage/refresh";

export interface HubConfig {
  port: number;
  /** Tried in order when `port` cannot be bound; absent = `port` only. */
  fallbackPorts?: readonly number[];
  /** Records the port the ingress listens on, for the reporters; absent or null = not recorded. */
  savePort?: ((port: number) => Promise<void>) | null;
  token: string;
  /** true when setup never ran: `token` is a throwaway and the ingress accepts nothing */
  tokenMissing?: boolean;
  sources: SessionSource[];
  usage: { ports: UsagePorts; refresher: TokenRefresher } | null;
  /** The account's session list (spec §4, probe J2); absent or null = no REM source. */
  remote?: { ports: RemotePorts } | null;
  /** Saved background jobs; absent or null = kept in memory only. */
  background?: BackgroundPorts | null;
  /** Claude Desktop's pins and the focus of its sessions; absent or null = not read. */
  pins?: DesktopPorts["pins"];
  focus?: DesktopPorts["focus"];
  /** The hourly self-check, given the bound port (null while none); absent or null = none. */
  drift?: ((port: number | null) => Promise<CheckResult[]>) | null;
  now?: () => number;
  log?: (line: string) => void;
  /** Deck mirror for /debug and /debug/keys; the plugin supplies it, the standalone hub has none. */
  mirror?: () => DeckMirror | null;
}

/** Minimum spacing between two poll attempts when pollNow asks for one (the endpoint answers 429 sooner). */
export const POLL_NOW_SPACING_MS = 120_000;

export type PollSkipReason = "stopped" | "no usage" | "in flight" | "backoff" | "recent";

/** Why pollNow did or did not start a poll; `sinceLastMs` is the time since the last attempt started. */
export type PollNowResult =
  | { started: true }
  | { started: false; reason: PollSkipReason; sinceLastMs: number | null };

export interface RunningHub {
  hub: Hub;
  /** The port the ingress listens on; null while none could be bound. */
  readonly port: number | null;
  /**
   * Usage poll on request (limit keys):
   * a no-op while a poll is in flight, during a 429 backoff, or less than POLL_NOW_SPACING_MS after
   * the last attempt started; otherwise polls now and reschedules the regular poll from now.
   */
  pollNow(): PollNowResult;
  /** Starts scanning one more source, e.g. WSL once its distribution is known; not after stop. */
  addSource(src: SessionSource): void;
  stop(): Promise<void>;
}

/** The ingress health error, e.g. "Port 43710 in use …" or a missing token; null when all is well. */
export function ingressError(running: RunningHub, now: number): string | null {
  return running.hub.state(now).sources.ingress?.error ?? null;
}

const SCAN_MS = 5_000;
const ACTIVE_SCAN_MS = 1_500;
const TICK_MS = 1_000;
const USAGE_RETRY_MS = 300_000;

/** VIBETRIBE_PORT: an integer in 1..65535, else the default plus a warning to log. */
export function parsePort(raw: string | undefined): { port: number; warning: string | null } {
  if (raw === undefined) return { port: DEFAULT_PORT, warning: null };
  const port = parsePortNumber(raw);
  if (port !== null) return { port, warning: null };
  return {
    port: DEFAULT_PORT,
    warning: `ignoring invalid VIBETRIBE_PORT, using ${DEFAULT_PORT}`,
  };
}

/** Composition root: wires adapters to the Hub and runs the loops. Errors become source health + log, never crashes. */
export async function startHub(c: HubConfig): Promise<RunningHub> {
  const now = c.now ?? Date.now;
  const sink = c.log ?? (() => {});
  // a throwing logger must not kill a loop
  const log = (line: string): void => {
    try {
      sink(line);
    } catch {
      // nothing left to report to
    }
  };
  const hub = new Hub({ onListenerError: (err) => log(`listener error: ${String(err)}`) });
  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;
  const later = (ms: number, fn: () => void): NodeJS.Timeout | null => {
    if (stopped) return null;
    const t = setTimeout(() => {
      timers.delete(t);
      if (!stopped) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const listener = createListener({
    hub,
    ports: [c.port, ...(c.fallbackPorts ?? [])],
    token: c.token,
    tokenMissing: c.tokenMissing ?? false,
    savePort: c.savePort ?? null,
    mirror: c.mirror,
    now,
    log,
    later,
  });
  // saved jobs first: before hooks can arrive (a live Stop replaces them) and before the first scans.
  // Only a hub with a bound port writes background.json: one that lost the port (the plugin and
  // hub.mjs at once) must not overwrite the file of the one that runs
  if (c.background)
    await keepBackgrounds({
      hub,
      ports: c.background,
      now,
      log,
      canSave: () => listener.port !== null && !stopped,
    });
  await listener.listen();

  const busy = (host: string): boolean =>
    hub
      .state(now())
      .sessions.some(
        (s) => s.key.host === host && (s.state === "working" || s.state.startsWith("needs_")),
      );

  /** last logged inactive reason per source, so a steady state logs once */
  const inactiveLogged = new Map<string, string>();

  // Every loop is "work in try/catch, always reschedule": nothing may end a loop.
  const scanLoop = async (src: SessionSource): Promise<void> => {
    try {
      const snap = await src.scan(now());
      if (stopped) return;
      if (isInactive(snap)) {
        hub.markInactive(src.name, snap.inactive);
        if (inactiveLogged.get(src.name) !== snap.inactive) {
          inactiveLogged.set(src.name, snap.inactive);
          log(`${src.name} inactive: ${snap.inactive}`);
        }
      } else {
        inactiveLogged.delete(src.name);
        hub.ingestSnapshot(snap);
      }
    } catch (err) {
      log(`${src.name} scan failed: ${String(err)}`);
      try {
        hub.markError(src.name, String(err));
      } catch (inner) {
        log(`markError failed: ${String(inner)}`);
      }
    }
    let delay = SCAN_MS;
    try {
      if (busy(src.host)) delay = ACTIVE_SCAN_MS;
    } catch (err) {
      log(`${src.name} state failed: ${String(err)}`);
    }
    later(delay, () => void scanLoop(src));
  };
  for (const src of c.sources) void scanLoop(src);

  const skipped = (reason: PollSkipReason, sinceLastMs: number | null = null): PollNowResult => ({
    started: false,
    reason,
    sinceLastMs,
  });
  let pollNow = (): PollNowResult => skipped("no usage");
  if (c.usage) {
    const poller = new UsagePoller({
      hub,
      ports: c.usage.ports,
      refresher: c.usage.refresher,
      log,
    });
    try {
      await poller.start();
    } catch (err) {
      log(`usage cache unreadable: ${String(err)}`);
      hub.markError("usage", `cache: ${String(err)}`);
    }
    let usageTimer: NodeJS.Timeout | null = null;
    let inFlight = false;
    // a delay above the regular interval is a 429 backoff (UsagePoller doubles it); pollNow respects it
    let backoffUntil = 0;
    // when the last poll attempt (scheduled or requested) started; pollNow keeps its spacing from it
    let lastStartedAt: number | null = null;
    const usageLoop = async (): Promise<void> => {
      usageTimer = null;
      inFlight = true;
      lastStartedAt = now();
      let delay = USAGE_RETRY_MS;
      try {
        delay = await poller.poll(now());
      } catch (err) {
        log(`usage poll failed: ${String(err)}`);
        try {
          hub.markError("usage", String(err));
        } catch {
          // keep the retry
        }
      } finally {
        inFlight = false;
      }
      backoffUntil = delay > POLL_MS ? now() + delay : 0;
      usageTimer = later(delay, () => void usageLoop());
    };
    // the first usage and remote polls wait one turn: a caller that stops at once (main.ts after
    // a lost port) never reads credentials, sends a request or starts a token refresh
    usageTimer = later(0, () => void usageLoop());
    pollNow = (): PollNowResult => {
      if (stopped) return skipped("stopped");
      if (inFlight) return skipped("in flight");
      if (now() < backoffUntil) return skipped("backoff");
      // a negative span means the wall clock went back: that must not block polling for the size of the jump
      const since = lastStartedAt === null ? null : now() - lastStartedAt;
      if (since !== null && since >= 0 && since < POLL_NOW_SPACING_MS) {
        return skipped("recent", since);
      }
      if (usageTimer) {
        clearTimeout(usageTimer);
        timers.delete(usageTimer);
        usageTimer = null;
      }
      void usageLoop();
      return { started: true };
    };
  }

  if (c.remote) {
    const remote = new RemotePoller({ hub, ports: c.remote.ports, log });
    const remoteLoop = async (): Promise<void> => {
      let delay = REMOTE_POLL_MS;
      try {
        delay = await remote.poll(now());
      } catch (err) {
        // a failing port (e.g. an unreadable credentials file) must not end the loop
        log(`remote poll failed: ${String(err)}`);
        try {
          hub.markError(REMOTE_SOURCE, "poll failed");
        } catch {
          // keep the retry
        }
      }
      later(delay, () => void remoteLoop());
    };
    later(0, () => void remoteLoop());
  }

  if (c.pins || c.focus)
    pollDesktop({ hub, ports: { pins: c.pins ?? null, focus: c.focus ?? null }, now, log, later });
  const drift = c.drift;
  if (drift) watchDrift({ check: () => drift(listener.port), log, later });

  const tickLoop = (): void => {
    try {
      hub.tick(now());
    } catch (err) {
      log(`tick failed: ${String(err)}`);
    }
    later(TICK_MS, tickLoop);
  };
  tickLoop();

  return {
    hub,
    get port() {
      return listener.port;
    },
    pollNow: () => pollNow(),
    addSource: (src) => {
      if (!stopped) void scanLoop(src);
    },
    stop: async () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await listener.close();
    },
  };
}
