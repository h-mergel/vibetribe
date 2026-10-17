import type { SessionView } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { changed, ok, skipped } from "../src/doctor/check";
import {
  checkHubState,
  checkPortFile,
  checkPorts,
  parseExcludedRanges,
  parsePortRange,
} from "../src/doctor/hub";
import type { HubState } from "../src/state";

const OURS = [43710, 37710, 31710, 25710];
const A = "local_0a1b2c3d-0000-4000-8000-00000000000a";
const B = "local_0a1b2c3d-0000-4000-8000-00000000000b";

const NETSH = [
  'Portausschlussbereiche für das Protokoll "tcp"',
  "",
  "Startport      Endport",
  "----------    --------",
  "      5357        5357",
  "     50000       50059     *",
  "",
  "* - Verwaltete Portausschlüsse.",
].join("\r\n");

const view = (fields: Partial<SessionView>): SessionView => ({
  id: "win/s",
  key: { host: "win", sessionId: "s" },
  hostKind: "windows",
  badge: "WIN",
  title: "Secret title",
  cwd: "C:/p",
  state: "idle",
  detail: null,
  errorType: null,
  episodeSince: null,
  episodeSeen: false,
  background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
  pid: 7,
  entrypoint: "claude-desktop",
  hostSessionId: A,
  bridgeSessionId: null,
  ...fields,
});

const state = (o: Partial<HubState> = {}): HubState => ({
  now: 0,
  sessions: [view({})],
  pins: [A],
  limits: { fiveHour: null, sevenDay: null, extra: null, auth: "ok" },
  sources: {
    ingress: { health: "ok", lastAt: 1, error: null },
    "sessions:win": { health: "ok", lastAt: 1, error: null },
  },
  recent: [],
  invalidEnvelopes: 0,
  ...o,
});

describe("port parsers", () => {
  it("read the WSL range and every row of netsh in any language", () => {
    expect(parsePortRange("44620\t48715\n")).toEqual([44620, 48715]);
    expect(parsePortRange("")).toBeNull();
    expect(parseExcludedRanges(NETSH)).toEqual([
      [5357, 5357],
      [50000, 50059],
    ]);
  });
});

describe("checkPorts", () => {
  it("names the first free port and the blocked one", () => {
    expect(checkPorts(OURS, [44620, 48715], parseExcludedRanges(NETSH))).toEqual(
      ok("ports", "43710 free; WSL range 44620–48715"),
    );
    expect(checkPorts(OURS, [40525, 44620], [])).toEqual(
      ok("ports", "37710 free; 43710 in the WSL range 40525–44620"),
    );
  });

  it("calls a block that covers two ports, or no free port at all, drift", () => {
    expect(checkPorts(OURS, [36000, 44000], [])).toEqual(
      changed(
        "ports",
        "more than one port blocked: 43710 in the WSL range 36000–44000, 37710 in the WSL range 36000–44000",
      ),
    );
    expect(checkPorts([43710], null, [[43000, 43999]])).toEqual(
      changed("ports", "no port free: 43710 excluded by Windows (43000–43999)"),
    );
    expect(checkPorts([44620], [40525, 44620], [])).toEqual(
      changed("ports", "no port free: 44620 in the WSL range 40525–44620"),
    );
  });
});

describe("checkPortFile", () => {
  it("compares the port file with the port the hub answers on", () => {
    expect(checkPortFile("37710\n", 37710)).toEqual(ok("port file", "37710"));
    expect(checkPortFile("43710", 37710)).toEqual(
      changed("port file", "says 43710, the hub listens on 37710"),
    );
    expect(checkPortFile(null, 37710)).toEqual(
      changed("port file", "missing or invalid; the hub listens on 37710"),
    );
    expect(checkPortFile("43710", null)).toEqual(skipped("port file", "no hub running"));
  });
});

describe("checkHubState", () => {
  it("is quiet when the hub has no source error, every Desktop id and Desktop's pins", () => {
    const remote = view({ hostKind: "remote", entrypoint: null, hostSessionId: null });
    const cli = view({ entrypoint: "cli", hostSessionId: null });
    expect(checkHubState(state({ sessions: [view({}), remote, cli] }), [A])).toEqual([
      ok("hub sources", "sources: 2"),
      ok("desktop ids in hub", "Claude Desktop sessions: 1"),
      ok("pins in hub", "same pins as Claude Desktop: 1"),
    ]);
  });

  it("names a reshaped reply, Desktop sessions without their id and pins the hub does not know", () => {
    const sources = {
      ingress: { health: "ok" as const, lastAt: 1, error: null },
      "sessions:remote": { health: "missing" as const, lastAt: null, error: "unexpected response" },
    };
    const sessions = [view({}), view({ hostSessionId: null }), view({ hostSessionId: "x" })];
    expect(checkHubState(state({ sources, sessions, pins: [] }), [A, B])).toEqual([
      changed("hub sources", "replies no longer have their shape: sessions:remote"),
      changed("desktop ids in hub", "Claude Desktop sessions without one: 2 of 3"),
      changed("pins in hub", "the hub has 0 pins, Claude Desktop 2, shared 0"),
    ]);
  });

  it("lets outages pass by source name only and calls extra pins in the hub drift", () => {
    const sources = {
      usage: { health: "stale" as const, lastAt: 1, error: "rate limited" },
      "sessions:win": {
        health: "missing" as const,
        lastAt: null,
        error: "EACCES: permission denied, scandir C:\\Users\\me\\.claude\\sessions",
      },
      ingress: { health: "ok" as const, lastAt: 1, error: null },
    };
    const [hubSources, , pins] = checkHubState(state({ sources, pins: [A, B] }), [A]);
    expect(hubSources).toEqual(
      ok("hub sources", "sources: 3, with a passing error: usage, sessions:win"),
    );
    expect(pins).toEqual(changed("pins in hub", "the hub has 2 pins, Claude Desktop 1, shared 1"));
  });

  it("skips what it cannot compare", () => {
    expect(checkHubState(null, [A])).toEqual([
      skipped("hub sources", "no hub running"),
      skipped("desktop ids in hub", "no hub running"),
      skipped("pins in hub", "no hub running"),
    ]);
    expect(checkHubState(state({ sessions: [] }), null).slice(1)).toEqual([
      skipped("desktop ids in hub", "no Claude Desktop session running"),
      skipped("pins in hub", "Claude Desktop's pins unknown"),
    ]);
  });
});
