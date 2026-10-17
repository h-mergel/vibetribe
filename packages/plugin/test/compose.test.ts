import { createServer } from "node:net";
import { INGRESS_TOKEN_MESSAGE, ingressPortError } from "@vibetribe/hub";
import type { HookEnvelope } from "@vibetribe/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemorySurface,
  parseMaxFrames,
  parseVariant,
  pollNowLine,
  type RunningVibeTribe,
  startVibeTribe,
} from "../src/compose";
import { defaultMk2Layout } from "../src/deck/keys";
import { svgFromDataUrl } from "./helpers";

let app: RunningVibeTribe | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await app?.stop();
  app = null;
});

const until = async (check: () => boolean, ms = 2_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Lets everything already queued (microtasks, I/O callbacks) run. */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

const envelope = (name: string, id = "sim-1", cwd = "/home/h/atlas"): HookEnvelope => ({
  v: 1,
  kind: "hook",
  source: { host: "sim", os: "wsl", distro: "Ubuntu", entrypoint: "claude-desktop" },
  session: { id, cwd, pid: null, hostSessionId: null },
  event: {
    name,
    ts: 0,
    toolName: null,
    toolUseId: null,
    agentId: null,
    notificationType: null,
    errorType: null,
    reason: null,
    auto: null,
    backgroundTasks: null,
  },
});

const layout = defaultMk2Layout();
const firstKey = layout[0] as ReturnType<typeof defaultMk2Layout>[number];
const text = (s: MemorySurface, id: string): string => svgFromDataUrl(s.images.get(id) ?? "") ?? "";

describe("startVibeTribe", () => {
  it("renders hub changes onto the surface, serves the mirror, executes seen and open_debug", async () => {
    const surface = new MemorySurface();
    const lines: string[] = [];
    // frozen clock: wait clocks and breathing cannot change an image behind the mirror comparison
    const frozen = Date.UTC(2026, 9, 13, 12, 0, 0);
    app = await startVibeTribe({
      surface,
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: (l) => lines.push(l),
      now: () => frozen,
      tickMs: 10,
      maxFramesPerSecond: 100,
    });
    for (const k of layout) app.keyAppeared(k);
    await until(() => surface.images.size === 15);
    expect(text(surface, "mk2:0:4")).toContain("Sources ok");

    const res = await fetch(`http://127.0.0.1:${app.port}/v1/event`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(envelope("Stop")),
    });
    expect(res.status).toBe(202);
    await until(() => text(surface, "mk2:1:0").includes("atlas"));
    expect(text(surface, "mk2:1:0")).toContain(">Done<");

    const mirror = (await (await fetch(`http://127.0.0.1:${app.port}/debug/keys.json`)).json()) as {
      keys: { id: string; image: string | null }[];
    };
    expect(mirror.keys.find((k) => k.id === "mk2:1:0")?.image).toBe(surface.images.get("mk2:1:0"));

    app.press("mk2:1:0", "long");
    await until(() => text(surface, "mk2:1:0").includes(">Idle<"));
    expect(app.hub.hub.state(frozen).sessions[0]?.state).toBe("idle");

    app.press("mk2:0:4", "long");
    expect(surface.urls).toEqual([`http://127.0.0.1:${app.port}/debug`]);
    // Extra key: the usage settings page, through the surface (MemorySurface starts nothing)
    app.press("mk2:0:3", "short");
    app.press("mk2:0:3", "long");
    expect(surface.urls).toEqual([
      `http://127.0.0.1:${app.port}/debug`,
      "https://claude.ai/settings/usage",
    ]);
    expect(lines).toContain("open_usage: https://claude.ai/settings/usage");
    app.press("mk2:1:0", "short");
    expect(lines.some((l) => l.includes("jump: sim/sim-1 (WSL) has no jump target"))).toBe(true);
  });

  it("refresh_usage polls once the 120 s spacing allows, and logs every press with its outcome", async () => {
    let fetches = 0;
    let saved = false;
    let clock = 1_000_000;
    const logs: string[] = [];
    app = await startVibeTribe({
      surface: new MemorySurface(),
      hub: {
        port: 0,
        token: "t",
        sources: [],
        usage: {
          refresher: { request: async () => false } as never,
          ports: {
            readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
            fetchUsage: async () => {
              fetches++;
              return { kind: "ok", input: { fiveHour: { usedPct: 5, resetsAt: null } } };
            },
            loadCache: async () => null,
            saveCache: async () => {
              await new Promise((r) => setTimeout(r, 100));
              saved = true;
            },
          },
        },
      },
      now: () => clock,
      log: (l) => logs.push(l),
      tickMs: 10,
    });
    await until(() => fetches === 1);
    // the start poll is over once its cache is saved and the microtasks behind that have run
    await until(() => saved);
    await settle();
    app.keyAppeared(layout[1] as ReturnType<typeof defaultMk2Layout>[number]);
    // 60 s after the start poll: inside the spacing, so ignored and logged with the age
    clock += 60_000;
    app.press("mk2:0:1", "short");
    expect(logs).toContain("refresh_usage: ignored (last poll 60 s ago)");
    await settle();
    expect(fetches).toBe(1);
    // 121 s after the start poll: the press polls now
    clock += 61_000;
    app.press("mk2:0:1", "short");
    expect(logs).toContain("refresh_usage: polling");
    await until(() => fetches === 2);
  });

  it("pollNowLine names every skip reason", () => {
    expect(pollNowLine({ started: true })).toBe("refresh_usage: polling");
    expect(pollNowLine({ started: false, reason: "recent", sinceLastMs: 59_600 })).toBe(
      "refresh_usage: ignored (last poll 60 s ago)",
    );
    expect(pollNowLine({ started: false, reason: "backoff", sinceLastMs: 5 })).toBe(
      "refresh_usage: ignored (backoff)",
    );
    expect(pollNowLine({ started: false, reason: "in flight", sinceLastMs: null })).toBe(
      "refresh_usage: ignored (in flight)",
    );
  });

  it("a refusing surface leaves the key without an image and keeps ticking", async () => {
    app = await startVibeTribe({
      surface: { setImage: () => false, openUrl: () => {} },
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: () => {},
      tickMs: 10,
    });
    app.keyAppeared(firstKey);
    await until(() => app?.deck.pendingCount === 0);
    expect(app.deck.mirror(Date.now()).keys[0]).toMatchObject({ image: null, sentAt: null });
  });

  it("keyAppeared, keyDisappeared and press never throw into the SDK", async () => {
    const lines: string[] = [];
    app = await startVibeTribe({
      surface: new MemorySurface(),
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: (l) => lines.push(l),
      tickMs: 10_000,
    });
    const boom = (): never => {
      throw new Error("deck bug");
    };
    app.deck.keyAppeared = boom;
    app.deck.keyDisappeared = boom;
    app.deck.press = boom;
    expect(() => app?.keyAppeared(firstKey)).not.toThrow();
    expect(() => app?.keyDisappeared("mk2:0:0")).not.toThrow();
    expect(() => app?.press("mk2:0:0", "short")).not.toThrow();
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringContaining("keyAppeared mk2:0:0 failed: Error: deck bug"),
        expect.stringContaining("keyDisappeared mk2:0:0 failed: Error: deck bug"),
        expect.stringContaining("press mk2:0:0 failed: Error: deck bug"),
      ]),
    );
  });

  it("logs a failing open_debug and keeps handling later presses", async () => {
    const lines: string[] = [];
    const urls: string[] = [];
    app = await startVibeTribe({
      surface: {
        setImage: () => true,
        openUrl: (u) => {
          urls.push(u);
          if (urls.length === 1) throw new Error("no browser");
        },
      },
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: (l) => lines.push(l),
      tickMs: 10_000,
    });
    for (const k of layout) app.keyAppeared(k);
    app.press("mk2:0:4", "long");
    app.press("mk2:0:4", "long");
    expect(urls).toHaveLength(2);
    expect(lines.some((l) => l.includes("open_debug failed: Error: no browser"))).toBe(true);
  });

  it("a missing token shows 'No token' on the status key", async () => {
    const surface = new MemorySurface();
    app = await startVibeTribe({
      surface,
      hub: { port: 0, token: "random", tokenMissing: true, sources: [], usage: null },
      log: () => {},
      tickMs: 10,
      maxFramesPerSecond: 100,
    });
    for (const k of layout) app.keyAppeared(k);
    await until(() => text(surface, "mk2:0:4").includes("No token"));
    expect(app.hub.hub.state(Date.now()).sources.ingress?.error).toBe(INGRESS_TOKEN_MESSAGE);
  });

  it("a missing token and a taken port are both kept, the port alert wins on the tile", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const taken = (blocker.address() as { port: number }).port;
    try {
      const surface = new MemorySurface();
      app = await startVibeTribe({
        surface,
        hub: { port: taken, token: "random", tokenMissing: true, sources: [], usage: null },
        log: () => {},
        tickMs: 10,
        maxFramesPerSecond: 100,
      });
      for (const k of layout) app.keyAppeared(k);
      const err = app.hub.hub.state(Date.now()).sources.ingress?.error ?? "";
      expect(err).toContain(ingressPortError([{ port: taken, code: "EADDRINUSE" }]));
      expect(err).toContain(INGRESS_TOKEN_MESSAGE);
      await until(() => text(surface, "mk2:0:4").includes("Port in use"));
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  const post = (port: number | null, env: HookEnvelope) =>
    fetch(`http://127.0.0.1:${port}/v1/event`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(env),
    });
  const quiet = { port: 0, token: "t", sources: [], usage: null };

  it("re-reads time-derived state without a hub event, in the injected time zone", async () => {
    let clock = Date.UTC(2026, 9, 13, 10, 0);
    const surface = new MemorySurface();
    app = await startVibeTribe({
      surface,
      hub: quiet,
      now: () => clock,
      timeZone: "Asia/Tokyo",
      log: () => {},
      tickMs: 10,
      maxFramesPerSecond: 100,
    });
    for (const k of layout) app.keyAppeared(k);
    app.hub.hub.ingestUsage({ fiveHour: { usedPct: 5, resetsAt: null } }, clock);
    await until(() => text(surface, "mk2:0:1").includes("5"));
    expect(text(surface, "mk2:0:1")).not.toContain("As of");
    clock += 16 * 60_000; // past the 15 min window staleness, no hub event
    await until(() => text(surface, "mk2:0:1").includes("As of 19:00"));
  });

  it("frees the slot of a removed session and the key shows empty again", async () => {
    let clock = 1_000_000;
    const surface = new MemorySurface();
    app = await startVibeTribe({
      surface,
      hub: quiet,
      now: () => clock,
      log: () => {},
      tickMs: 10,
      maxFramesPerSecond: 100,
    });
    for (const k of layout) app.keyAppeared(k);
    await post(app.port, envelope("Stop"));
    await until(() => text(surface, "mk2:1:0").includes("atlas"));
    clock += 1_900_000; // past the hook-only TTL
    const update = vi.spyOn(app.deck, "update");
    app.hub.hub.tick(clock);
    expect(update.mock.calls[0]?.[1].map((r) => r.reason)).toEqual(["hook_only_ttl"]);
    await until(() => !text(surface, "mk2:1:0").includes("atlas"));
    await post(app.port, envelope("Stop", "sim-2", "/home/h/eta"));
    await until(() => text(surface, "mk2:1:0").includes("eta"));
  });

  it("stop is idempotent, ends ticking, closes the port and detaches from the hub", async () => {
    const surface = new MemorySurface();
    app = await startVibeTribe({ surface, hub: quiet, log: () => {}, tickMs: 5 });
    const port = app.port;
    const hubOfApp = app.hub.hub;
    const tick = vi.spyOn(app.deck, "tick");
    const update = vi.spyOn(app.deck, "update");
    const appeared = vi.spyOn(app.deck, "keyAppeared");
    const pressed = vi.spyOn(app.deck, "press");
    const gone = vi.spyOn(app.deck, "keyDisappeared");
    const hubStop = vi.spyOn(app.hub, "stop");
    await until(() => tick.mock.calls.length >= 2);
    await Promise.all([app.stop(), app.stop()]);
    await app.stop();
    const ticks = tick.mock.calls.length;
    update.mockClear();
    hubOfApp.markError("ingress", "x");
    expect(update).not.toHaveBeenCalled();
    app.keyAppeared(firstKey);
    app.press("mk2:0:0", "short");
    app.keyDisappeared("mk2:0:0");
    expect(gone).not.toHaveBeenCalled();
    expect(hubStop).toHaveBeenCalledTimes(1);
    expect(appeared).not.toHaveBeenCalled();
    expect(pressed).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(tick.mock.calls.length).toBe(ticks);
    expect(surface.images.size).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/debug`)).rejects.toThrow();
  });

  it("ticks every 250 ms by default", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    app = await startVibeTribe({ surface: new MemorySurface(), hub: quiet, log: () => {} });
    const tick = vi.spyOn(app.deck, "tick");
    vi.advanceTimersByTime(249);
    expect(tick).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(750);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("a long press on the inbox marks every unseen session seen", async () => {
    const surface = new MemorySurface();
    app = await startVibeTribe({ surface, hub: quiet, log: () => {}, tickMs: 10 });
    for (const k of layout) app.keyAppeared(k);
    for (const id of ["a", "b", "c"]) await post(app.port, envelope("Stop", id, `/home/h/${id}`));
    await until(() => app?.hub.hub.state(Date.now()).sessions.length === 3);
    const unseen = () =>
      app?.hub.hub.state(Date.now()).sessions.filter((v) => v.state === "done_unseen").length;
    expect(unseen()).toBe(3);
    app.press("mk2:0:0", "long");
    expect(unseen()).toBe(0);
  });

  it("a throwing deck.tick is logged and the loop keeps running", async () => {
    const lines: string[] = [];
    app = await startVibeTribe({
      surface: new MemorySurface(),
      hub: quiet,
      log: (l) => lines.push(l),
      tickMs: 5,
    });
    const tick = vi.spyOn(app.deck, "tick").mockImplementation(() => {
      throw new Error("tick bug");
    });
    await until(() => tick.mock.calls.length >= 3);
    const failed = lines.filter((l) => l.includes("deck tick failed: Error: tick bug"));
    expect(failed.length).toBeGreaterThanOrEqual(3);
  });

  it("passes the frame budget to the deck", async () => {
    const surface = new MemorySurface();
    app = await startVibeTribe({
      surface,
      hub: quiet,
      now: () => 5_000,
      log: () => {},
      tickMs: 5,
      maxFramesPerSecond: 2,
    });
    for (const k of layout) app.keyAppeared(k);
    // the clock is frozen: once the two frames of the budget are out, more ticks send nothing
    await until(() => surface.images.size === 2);
    const tick = vi.spyOn(app.deck, "tick");
    await until(() => tick.mock.calls.length >= 3);
    expect(surface.images.size).toBe(2);
  });

  it("does not open /debug when the ingress failed, and says so", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const taken = (blocker.address() as { port: number }).port;
    try {
      const lines: string[] = [];
      const surface = new MemorySurface();
      app = await startVibeTribe({
        surface,
        hub: { ...quiet, port: taken },
        log: (l) => lines.push(l),
        tickMs: 10_000,
      });
      for (const k of layout) app.keyAppeared(k);
      app.press("mk2:0:4", "long");
      expect(surface.urls).toEqual([]);
      expect(lines.some((l) => l.includes("open_debug skipped"))).toBe(true);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  it("logs one line when the token is missing and still opens /debug", async () => {
    const lines: string[] = [];
    const surface = new MemorySurface();
    app = await startVibeTribe({
      surface,
      hub: { ...quiet, tokenMissing: true },
      log: (l) => lines.push(l),
      tickMs: 10_000,
    });
    expect(lines.filter((l) => l.includes("no token"))).toHaveLength(1);
    for (const k of layout) app.keyAppeared(k);
    app.press("mk2:0:4", "long");
    expect(surface.urls).toHaveLength(1);
  });

  it("parseVariant takes compact (any case, trimmed) and falls back to comfortable", () => {
    expect(parseVariant(undefined)).toBe("comfortable");
    expect(parseVariant("compact")).toBe("compact");
    expect(parseVariant(" Compact ")).toBe("compact");
    expect(parseVariant("comfortable")).toBe("comfortable");
    expect(parseVariant("dense")).toBe("comfortable");
  });

  it("passes the variant to the deck", async () => {
    const surface = new MemorySurface();
    app = await startVibeTribe({
      surface,
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: () => {},
      tickMs: 10,
      maxFramesPerSecond: 100,
      variant: "compact",
    });
    for (const k of layout) app.keyAppeared(k);
    // compact status: four source rows; comfortable would show "Sources ok"
    await until(() => text(surface, "mk2:0:4").includes("vt-status-WIN"));
  });

  it("parseMaxFrames accepts 1..100 and defaults to 10", () => {
    expect(parseMaxFrames(undefined)).toBe(10);
    expect(parseMaxFrames("25")).toBe(25);
    expect(parseMaxFrames("0")).toBe(10);
    expect(parseMaxFrames("1000")).toBe(10);
    expect(parseMaxFrames("x")).toBe(10);
    expect(parseMaxFrames(" 25")).toBe(10);
    expect(parseMaxFrames("1e1")).toBe(10);
  });
});

describe("startVibeTribe breathing on the real refresh loop", () => {
  it("keeps both breathing keys on at least 90 % of the breath steps with ten waiting sessions (fake timers, 20 s)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 13, 12, 0, 0));
    const perKey = new Map<string, number>();
    app = await startVibeTribe({
      surface: {
        setImage: (id) => {
          perKey.set(id, (perKey.get(id) ?? 0) + 1);
          return true;
        },
        openUrl: () => {},
      },
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: () => {},
    });
    for (const k of layout) app.keyAppeared(k);
    for (let i = 0; i < 10; i++) {
      app.hub.hub.ingest(envelope("PermissionRequest", `w${i}`, `/home/h/w${i}`), Date.now());
      vi.advanceTimersByTime(10);
    }
    perKey.clear();
    // tick every 250 ms; every second the composition re-reads the hub state and updates the deck
    for (let i = 0; i < 80; i++) vi.advanceTimersByTime(250);
    const counts = [...perKey.entries()]
      .filter(([id]) => id.startsWith("mk2:1") || id.startsWith("mk2:2"))
      .map(([, n]) => n)
      .sort((a, b) => b - a);
    console.info(`MEASURED compose breathing frames per 20 s: ${counts.slice(0, 2)}`);
    expect(counts[0]).toBeGreaterThanOrEqual(60);
    expect(counts[1]).toBeGreaterThanOrEqual(60);
  });
});
