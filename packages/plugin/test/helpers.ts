import { createServer } from "node:net";
import type { SessionView } from "@vibetribe/core";
import type { HubState } from "@vibetribe/hub";
import type { Variant } from "@vibetribe/render";
import { Deck } from "../src/deck/deck";
import { defaultMk2Layout, type KeyPlacement } from "../src/deck/keys";

export function view(over: Partial<SessionView> = {}): SessionView {
  const sessionId = over.key?.sessionId ?? "s1";
  const host = over.key?.host ?? "wsl:Ubuntu";
  return {
    id: `${host}/${sessionId}`,
    key: { host, sessionId },
    hostKind: "wsl",
    badge: "WSL",
    title: sessionId,
    cwd: `/home/h/${sessionId}`,
    state: "idle",
    detail: null,
    errorType: null,
    episodeSince: null,
    episodeSeen: true,
    background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
    pid: null,
    entrypoint: "claude-desktop",
    hostSessionId: null,
    bridgeSessionId: null,
    ...over,
  };
}

export function hubState(over: Partial<HubState> = {}): HubState {
  return {
    now: 0,
    sessions: [],
    pins: [],
    limits: { fiveHour: null, sevenDay: null, extra: null, auth: "ok" },
    sources: {},
    recent: [],
    invalidEnvelopes: 0,
    ...over,
  };
}

/** Inverse of `svgDataUrl`; null for any other URL and for a malformed percent sequence. */
export function svgFromDataUrl(image: string): string | null {
  const prefix = "data:image/svg+xml,";
  if (!image.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(image.slice(prefix.length));
  } catch {
    return null;
  }
}

export const T0 = 100_000;

/** Key id of slot `n` (1-based) in the default MK.2 layout. */
export const slot = (n: number) => `mk2:${1 + Math.floor((n - 1) / 5)}:${(n - 1) % 5}`;

export const session = (id: string, over: Partial<SessionView> = {}) =>
  view({ key: { host: "win", sessionId: id }, ...over });

export const waiting = (id: string, since: number) =>
  session(id, { state: "needs_permission", episodeSince: since, episodeSeen: false });

/**
 * A Deck on a recording surface with all keys appeared at T0. `rejectKey(id)` makes the surface
 * refuse that key from now on (any other id accepts everything again).
 */
export function deckHarness(
  o: { max?: number; keys?: KeyPlacement[]; variant?: Variant; log?: (line: string) => void } = {},
) {
  const sends: { id: string; image: string }[] = [];
  let refused: string | null = null;
  const d = new Deck({
    send: (id, image) => {
      sends.push({ id, image });
      return id !== refused;
    },
    maxFramesPerSecond: o.max ?? 10,
    ...(o.variant ? { variant: o.variant } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
  for (const k of o.keys ?? defaultMk2Layout()) d.keyAppeared(k, T0);
  const svgOf = (id: string) =>
    svgFromDataUrl(sends.filter((s) => s.id === id).at(-1)?.image ?? "") ?? "";
  const sentTo = (id: string) => sends.filter((s) => s.id === id).length;
  const rejectKey = (id: string) => {
    refused = id;
  };
  return { d, sends, svgOf, sentTo, rejectKey };
}

/** A port the OS just handed out and that is free again (a fixed one can sit in the WSL port range). */
export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}
