import type { HostSnapshot } from "@vibetribe/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_POLL_MS } from "../src/desktop-poll";
import { BIND_RETRY_MS } from "../src/http/listener";
import { ingressError, type RunningHub, startHub } from "../src/runtime";
import type { SessionSource } from "../src/sessions/sources";
import { POLL_MS } from "../src/usage/poller";
import { hook, info, scan } from "./background-fixtures";

let running: RunningHub[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const r of running) await r.stop();
  running = [];
});
const start = async (...args: Parameters<typeof startHub>) => {
  const r = await startHub(...args);
  running.push(r);
  return r;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The port a started hub listens on; fails the test when it has none. */
const boundPort = (r: RunningHub): number => {
  if (r.port === null) throw new Error("hub not listening");
  return r.port;
};

const session: HostSnapshot["sessions"][number] = {
  sessionId: "s1",
  pid: 7,
  cwd: "C:/p",
  entrypoint: "claude-desktop",
  name: "Test",
  hostSessionId: null,
  bridgeSessionId: null,
  status: "idle",
  waitingFor: null,
};
const fakeSource = (scan: SessionSource["scan"]): SessionSource => ({
  name: "sessions:win",
  host: "win",
  hostKind: "windows",
  scan,
});

describe("startHub", () => {
  it("binds the port, reports ingress ok, scans sources and serves state.json", async () => {
    let scans = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [
        fakeSource(async (now) => {
          scans++;
          return { host: "win", hostKind: "windows", at: now, sessions: [session] };
        }),
      ],
      usage: null,
    });
    await wait(50);
    expect(scans).toBeGreaterThan(0);
    const state = (await (await fetch(`http://127.0.0.1:${r.port}/debug/state.json`)).json()) as {
      sessions: { title: string }[];
      sources: Record<string, { health: string }>;
    };
    expect(state.sessions.map((s) => s.title)).toEqual(["Test"]);
    expect(state.sources.ingress?.health).toBe("ok");
  });

  it("reports a taken port in the ingress health instead of crashing", async () => {
    const first = await start({ port: 0, token: "t", sources: [], usage: null });
    const second = await start({ port: boundPort(first), token: "t", sources: [], usage: null });
    expect(second.hub.state(Date.now()).sources.ingress?.error).toMatch(
      /Port \d+ in use or blocked/,
    );
  });

  it("binds a port that became free at the next retry; a stopped hub retries nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const holder = await start({ port: 0, token: "t", sources: [], usage: null });
    const port = boundPort(holder);
    // stopped first and scheduled first: had it retried, it would have taken the port
    const stopped = await start({ port, token: "t", sources: [], usage: null });
    const waiting = await start({ port, token: "t", sources: [], usage: null });
    await stopped.stop();
    await holder.stop();
    await vi.advanceTimersByTimeAsync(BIND_RETRY_MS);
    await vi.waitFor(() => expect(waiting.port).toBe(port));
    expect(ingressError(waiting, Date.now())).toBeNull();
    expect(stopped.port).toBeNull();
  });

  it("takes the first free fallback port when the first one is taken, and records it", async () => {
    const holder = await start({ port: 0, token: "t", sources: [], usage: null });
    const saved: number[] = [];
    const r = await start({
      port: boundPort(holder),
      fallbackPorts: [0],
      savePort: async (port) => {
        saved.push(port);
      },
      token: "t",
      sources: [],
      usage: null,
    });
    expect(r.port).not.toBeNull();
    expect(r.port).not.toBe(holder.port);
    expect(saved).toEqual([r.port]);
    expect(ingressError(r, Date.now())).toBeNull();
  });

  it("a hub stopped right after startHub (main.ts with a taken port) never reads credentials", async () => {
    const first = await start({ port: 0, token: "t", sources: [], usage: null });
    let reads = 0;
    const readCredentials = async () => {
      reads++;
      return null;
    };
    const second = await startHub({
      port: boundPort(first),
      token: "t",
      sources: [],
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials,
          fetchUsage: async () => ({ kind: "rate_limited" }),
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
      remote: { ports: { readCredentials, fetchSessions: async () => ({ kind: "rate_limited" }) } },
    });
    expect(ingressError(second, Date.now())).not.toBeNull();
    await second.stop();
    await wait(50);
    expect(reads).toBe(0);
  });

  it("puts the inactive reason into the source error and logs it once per change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const lines: string[] = [];
    let reason = "EACCES: permission denied, scandir X";
    const r = await start({
      port: 0,
      token: "t",
      sources: [
        {
          name: "sessions:wsl:Ubuntu",
          host: "wsl:Ubuntu",
          hostKind: "wsl",
          scan: async () => ({ inactive: reason }),
        },
      ],
      usage: null,
      log: (l) => lines.push(l),
    });
    await vi.advanceTimersByTimeAsync(16_000);
    const src = r.hub.state(Date.now()).sources["sessions:wsl:Ubuntu"];
    expect(src).toMatchObject({ health: "missing", error: reason });
    expect(lines.filter((l) => l.includes("EACCES"))).toHaveLength(1);
    reason = "distro not running";
    await vi.advanceTimersByTimeAsync(6_000);
    expect(r.hub.state(Date.now()).sources["sessions:wsl:Ubuntu"]?.error).toBe(reason);
    expect(lines.filter((l) => l.includes("distro not running"))).toHaveLength(1);
  });

  it("marks a source inactive when scan reports it", async () => {
    const r = await start({
      port: 0,
      token: "t",
      sources: [
        {
          name: "sessions:wsl:Ubuntu",
          host: "wsl:Ubuntu",
          hostKind: "wsl",
          scan: async () => ({ inactive: "distro not running" }),
        },
      ],
      usage: null,
    });
    await wait(50);
    expect(r.hub.state(Date.now()).sources["sessions:wsl:Ubuntu"]?.health).toBe("missing");
  });

  it("reports a failing scan as source error and keeps scanning", async () => {
    let scans = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [
        fakeSource(async () => {
          scans++;
          throw new Error("EIO");
        }),
      ],
      usage: null,
    });
    await wait(50);
    expect(r.hub.state(Date.now()).sources["sessions:win"]).toMatchObject({
      health: "missing",
      error: "Error: EIO",
    });
    expect(scans).toBe(1);
  });

  it("pollNow polls at once, is a no-op while a poll is in flight and during a 429 backoff", async () => {
    // Date is faked too: the 120 s spacing reads the clock
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let fetches = 0;
    let release: (() => void) | null = null;
    let answer: "ok" | "rate_limited" = "ok";
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            if (release) await new Promise<void>((res) => (release = res));
            return answer === "ok"
              ? { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } }
              : { kind: "rate_limited" };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    // immediate poll, and the regular poll is rescheduled from now (none at the old 300 s mark)
    // 121 s: past the 120 s spacing of pollNow
    await vi.advanceTimersByTimeAsync(121_000);
    expect(r.pollNow()).toEqual({ started: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(250_000);
    expect(fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(fetches).toBe(3);
    await vi.advanceTimersByTimeAsync(120_000);
    // in flight: a second request is ignored
    release = () => {};
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(4);
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(4);
    const unblock = release as () => void;
    release = null;
    unblock();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(120_000);
    // 429: the poller doubles the interval; pollNow stays quiet until the backoff has passed
    answer = "rate_limited";
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(5);
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(5);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetches).toBe(6);
  });

  it("an in-flight pollNow does not double the regular poll cadence", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fetches = 0;
    let gate: Promise<void> | null = null;
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            if (gate) await gate;
            return { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    let openGate: () => void = () => {};
    gate = new Promise<void>((res) => {
      openGate = res;
    });
    // the regular poll at 300 s is now in flight and blocked
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetches).toBe(2);
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(fetches).toBe(2);
    // release: the poll completes at t = 3 * POLL_MS and the next one follows one interval later
    gate = null;
    openGate();
    await vi.advanceTimersByTimeAsync(0);
    const before = fetches;
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(fetches - before).toBe(2);
  });

  it("pollNow honours the 429 backoff against a controlled clock: blocked until its end, then polls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 0;
    let fetches = 0;
    let answer: "ok" | "rate_limited" = "ok";
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      now: () => clock,
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            return answer === "ok"
              ? { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } }
              : { kind: "rate_limited" };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    // move the controlled clock and the fake timers together
    const advance = async (ms: number) => {
      clock += ms;
      await vi.advanceTimersByTimeAsync(ms);
    };
    await advance(0);
    expect(fetches).toBe(1);
    answer = "rate_limited";
    // regular poll at 300 s answers 429: backoff 600 s, so backoffUntil = 900 s
    await advance(POLL_MS);
    expect(fetches).toBe(2);
    await advance(100_000);
    r.pollNow();
    await advance(0);
    expect(fetches).toBe(2);
    await advance(499_999); // clock = 899 999 ms, still inside the backoff
    r.pollNow();
    await advance(0);
    expect(fetches).toBe(2);
    // the clock reaches the backoff end exactly; the fake timers have not fired yet
    clock = 900_000;
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(3);
    // after the second 429 the backoff is 1 200 s; a later success clears it
    answer = "ok";
    clock = 2_100_000;
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(4);
  });

  it("a successful poll clears the backoff even when the wall clock has jumped back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 0;
    let fetches = 0;
    let answer: "ok" | "rate_limited" = "ok";
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      now: () => clock,
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            return answer === "ok"
              ? { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } }
              : { kind: "rate_limited" };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    clock = POLL_MS;
    answer = "rate_limited";
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetches).toBe(2);
    // the 429 set backoffUntil = 300 s + 600 s; the wall clock then jumps back to 0
    clock = 0;
    answer = "ok";
    await vi.advanceTimersByTimeAsync(600_000); // the backoff timer fires; the poll succeeds at clock 0
    expect(fetches).toBe(3);
    // 120 s after the poll at clock 0: the spacing is over, so only the backoff can still block
    clock = 120_000;
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(4);
  });

  it("pollNow is spaced at least 120 s after the last poll attempt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 0;
    let fetches = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      now: () => clock,
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            return { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    const advance = async (ms: number) => {
      clock += ms;
      await vi.advanceTimersByTimeAsync(ms);
    };
    await advance(0);
    expect(fetches).toBe(1); // the start poll is an attempt too
    await advance(60_000);
    expect(r.pollNow()).toEqual({ started: false, reason: "recent", sinceLastMs: 60_000 });
    await advance(0);
    expect(fetches).toBe(1);
    await advance(61_000); // 121 s after the start poll
    expect(r.pollNow()).toEqual({ started: true });
    await advance(0);
    expect(fetches).toBe(2);
    await advance(60_000);
    expect(r.pollNow()).toEqual({ started: false, reason: "recent", sinceLastMs: 60_000 });
    await advance(0);
    expect(fetches).toBe(2);
    await advance(61_000);
    expect(r.pollNow()).toEqual({ started: true });
    await advance(0);
    expect(fetches).toBe(3);
  });

  it("a wall clock that jumped back does not block pollNow for the size of the jump", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 1_000_000;
    let fetches = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      now: () => clock,
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            return { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    clock = 0;
    expect(r.pollNow()).toEqual({ started: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(2);
  });

  it("pollNow after stop is a no-op and fetches nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fetches = 0;
    const r = await startHub({
      port: 0,
      token: "t",
      sources: [],
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => ({ accessToken: "a", expiresAt: 10 ** 15 }),
          fetchUsage: async () => {
            fetches++;
            return { kind: "ok", input: { fiveHour: { usedPct: 1, resetsAt: null } } };
          },
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
    await r.stop();
    r.pollNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetches).toBe(1);
  });

  it("ingressError names the taken port, null when listening; pollNow without usage is harmless", async () => {
    const first = await start({ port: 0, token: "t", sources: [], usage: null });
    expect(ingressError(first, Date.now())).toBeNull();
    expect(() => first.pollNow()).not.toThrow();
    const second = await start({ port: boundPort(first), token: "t", sources: [], usage: null });
    // the exit message in main.ts prints this text, so it must carry the errno code
    expect(ingressError(second, Date.now())).toMatch(/^Port \d+ in use or blocked \(\w+;/);
  });

  it("survives a broken usage cache at startup", async () => {
    const lines: string[] = [];
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      log: (l) => lines.push(l),
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => null,
          fetchUsage: async () => ({ kind: "error", message: "unused" }),
          loadCache: async () => {
            throw new Error("corrupt");
          },
          saveCache: async () => {},
        },
      },
    });
    expect(r.hub.state(Date.now()).sources.usage?.error).toBeTruthy();
  });

  it("shows the deck mirror on /debug and /debug/keys through startHub", async () => {
    const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      mirror: () => ({
        at: 1,
        sentLastSecond: 1,
        pending: 0,
        keys: [
          {
            id: "k1",
            role: "inbox",
            slot: null,
            device: "mk2",
            row: 0,
            column: 0,
            image,
            sentAt: 1,
          },
        ],
      }),
    });
    const page = await (await fetch(`http://127.0.0.1:${r.port}/debug`)).text();
    expect(page).toContain(`<img src="${image}"`);
    const keys = await (await fetch(`http://127.0.0.1:${r.port}/debug/keys`)).text();
    expect(keys).toContain(`<img src="${image}"`);
  });

  it("keeps /debug and /debug/keys answering when the mirror throws", async () => {
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      mirror: () => {
        throw new Error("plugin gone");
      },
    });
    const page = await fetch(`http://127.0.0.1:${r.port}/debug`);
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain("Mirror unavailable");
    expect(text).toContain("<h2>Sessions");
    expect((await fetch(`http://127.0.0.1:${r.port}/debug/keys`)).status).toBe(200);
  });

  it("keeps the tick and scan loops running when an onChange listener throws", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const lines: string[] = [];
    let scans = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [
        fakeSource(async (now) => {
          scans++;
          return { host: "win", hostKind: "windows", at: now, sessions: [session] };
        }),
      ],
      usage: null,
      log: (l) => lines.push(l),
    });
    r.hub.onChange(() => {
      throw new Error("boom");
    });
    const tick = vi.spyOn(r.hub, "tick");
    await vi.advanceTimersByTimeAsync(11_000);
    expect(scans).toBeGreaterThanOrEqual(3);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(lines.some((l) => l.includes("listener error: Error: boom"))).toBe(true);
  });
});

describe("startHub with Claude Desktop's pins", () => {
  it("reads them at start and every 5 s; an unreadable or failing read keeps the last pins", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const answers: (string[] | null | Error)[] = [
      ["local_a"],
      null,
      new Error("boom"),
      ["local_b", "local_a"],
    ];
    let reads = 0;
    const lines: string[] = [];
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      log: (l) => lines.push(l),
      pins: async () => {
        const answer = reads < answers.length ? answers[reads] : [];
        reads++;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    await vi.waitFor(() => expect(r.hub.state(0).pins).toEqual(["local_a"]));
    await vi.advanceTimersByTimeAsync(DESKTOP_POLL_MS);
    // unreadable for now (locked, half written): the last pins stay, nothing is logged
    expect(reads).toBe(2);
    expect(r.hub.state(0).pins).toEqual(["local_a"]);
    expect(lines.filter((l) => l.startsWith("desktop pins"))).toEqual([]);
    await vi.advanceTimersByTimeAsync(DESKTOP_POLL_MS);
    expect(lines).toContain("desktop pins failed: Error: boom");
    expect(r.hub.state(0).pins).toEqual(["local_a"]);
    await vi.advanceTimersByTimeAsync(DESKTOP_POLL_MS);
    expect(r.hub.state(0).pins).toEqual(["local_b", "local_a"]);
    expect(reads).toBe(4);
    await r.stop();
    await vi.advanceTimersByTimeAsync(DESKTOP_POLL_MS);
    expect(reads).toBe(4);
  });
});

describe("startHub with Claude Desktop's focus", () => {
  it("every 5 s, sees a session that Claude Desktop showed after its turn ended", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 1_000_000;
    const asked: (readonly string[])[] = [];
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      now: () => clock,
      focus: async (ids) => {
        asked.push(ids);
        return new Map([["local_a", 1_002_000]]);
      },
    });
    r.hub.ingestSnapshot(scan(clock, [{ ...info, hostSessionId: "local_a" }]));
    r.hub.ingest(hook("Stop"), 1_001_000);
    clock = 1_003_000;
    expect(r.hub.state(clock).sessions[0]?.state).toBe("done_unseen");
    await vi.advanceTimersByTimeAsync(DESKTOP_POLL_MS);
    expect(asked).toEqual([["local_a"]]);
    expect(r.hub.state(clock).sessions[0]).toMatchObject({ state: "idle", episodeSeen: true });
  });
});
