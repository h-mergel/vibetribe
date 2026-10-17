import type { HostSnapshot } from "@vibetribe/core";
import { DEFAULT_PORT, type HookEnvelope } from "@vibetribe/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePort, type RunningHub, startHub } from "../src/runtime";
import type { InactiveScan, SessionSource } from "../src/sessions/sources";

let running: RunningHub[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(0);
});
afterEach(async () => {
  for (const r of running) await r.stop();
  running = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const start = async (...args: Parameters<typeof startHub>) => {
  const r = await startHub(...args);
  running.push(r);
  await vi.advanceTimersByTimeAsync(0);
  return r;
};

type Status = NonNullable<HostSnapshot["sessions"][number]["status"]>;
const file = (
  status: Status,
  waitingFor: string | null = null,
): HostSnapshot["sessions"][number] => ({
  sessionId: "s1",
  pid: 7,
  cwd: "C:/p",
  entrypoint: "claude-desktop",
  name: "Test",
  hostSessionId: null,
  bridgeSessionId: null,
  status,
  waitingFor,
});
const source = (scan: SessionSource["scan"]): SessionSource => ({
  name: "sessions:win",
  host: "win",
  hostKind: "windows",
  scan,
});
const snapshotOf =
  (status: Status, waitingFor: string | null = null): SessionSource["scan"] =>
  async (now) => ({
    host: "win",
    hostKind: "windows",
    at: now,
    sessions: [file(status, waitingFor)],
  });

const counting = (scan: SessionSource["scan"]) => {
  const s = { scans: 0 };
  return {
    s,
    src: source((now) => {
      s.scans++;
      return scan(now);
    }),
  };
};

const hook: HookEnvelope = {
  v: 1,
  kind: "hook",
  source: { host: "win", os: "windows", distro: null, entrypoint: "claude-desktop" },
  session: { id: "h1", cwd: "C:/p", pid: 9, hostSessionId: null },
  event: {
    name: "UserPromptSubmit",
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
};

describe("scan interval", () => {
  it("is 5 s while the host has no active session", async () => {
    const { s, src } = counting(snapshotOf("idle"));
    await start({ port: 0, token: "t", sources: [src], usage: null });
    expect(s.scans).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(s.scans).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.scans).toBe(2);
  });

  it("is 1.5 s while a session of the host is working", async () => {
    const { s, src } = counting(snapshotOf("busy"));
    await start({ port: 0, token: "t", sources: [src], usage: null });
    expect(s.scans).toBe(1);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(s.scans).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.scans).toBe(2);
  });

  it("is 1.5 s while a session of the host needs the user", async () => {
    const { s, src } = counting(snapshotOf("waiting", "permission prompt"));
    const r = await start({ port: 0, token: "t", sources: [src], usage: null });
    expect(r.hub.state(0).sessions[0]?.state).toMatch(/^needs_/);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(s.scans).toBe(2);
  });
});

describe("tick loop", () => {
  it("ticks every second", async () => {
    const r = await start({ port: 0, token: "t", sources: [], usage: null });
    const tick = vi.spyOn(r.hub, "tick");
    await vi.advanceTimersByTimeAsync(2_999);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("keeps ticking when hub.tick throws and logs it", async () => {
    const lines: string[] = [];
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      log: (l) => lines.push(l),
    });
    const tick = vi.spyOn(r.hub, "tick").mockImplementation(() => {
      throw new Error("tick boom");
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(lines.some((l) => l.includes("tick boom"))).toBe(true);
  });

  it("keeps ticking when a listener throws on a real removal", async () => {
    const lines: string[] = [];
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      log: (l) => lines.push(l),
    });
    r.hub.ingest(hook, 0);
    r.hub.onChange(() => {
      throw new Error("listener boom");
    });
    const tick = vi.spyOn(r.hub, "tick");
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(r.hub.drainRemovals()).toEqual([expect.objectContaining({ reason: "hook_only_ttl" })]);
    expect(lines.some((l) => l.includes("listener error: Error: listener boom"))).toBe(true);
    const after = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tick.mock.calls.length).toBe(after + 3);
  });
});

describe("scan loop never dies", () => {
  it("keeps scanning after a failing async scan", async () => {
    const { s, src } = counting(async () => {
      throw new Error("EIO");
    });
    await start({ port: 0, token: "t", sources: [src], usage: null });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.scans).toBe(3);
  });

  it("keeps scanning after a synchronous throw from scan", async () => {
    const lines: string[] = [];
    const { s, src } = counting(() => {
      throw new Error("sync boom");
    });
    const r = await start({
      port: 0,
      token: "t",
      sources: [src],
      usage: null,
      log: (l) => lines.push(l),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.scans).toBe(3);
    expect(r.hub.state(0).sources["sessions:win"]?.error).toContain("sync boom");
    expect(lines.some((l) => l.includes("sync boom"))).toBe(true);
  });

  it("keeps scanning when hub.state throws while choosing the next delay", async () => {
    const { s, src } = counting(snapshotOf("idle"));
    const r = await start({ port: 0, token: "t", sources: [src], usage: null });
    vi.spyOn(r.hub, "state").mockImplementation(() => {
      throw new Error("state boom");
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.scans).toBe(3);
  });

  it("keeps scanning and ticking when an onChange listener throws", async () => {
    const lines: string[] = [];
    const { s, src } = counting(snapshotOf("idle"));
    const r = await start({
      port: 0,
      token: "t",
      sources: [src],
      usage: null,
      log: (l) => lines.push(l),
    });
    r.hub.onChange(() => {
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.scans).toBe(3);
    expect(lines.some((l) => l.includes("listener error: Error: boom"))).toBe(true);
  });
});

describe("usage loop", () => {
  const usage = (readCredentials: () => Promise<null>, loadCache = async () => null) =>
    ({
      refresher: { request: async () => false } as never,
      ports: {
        readCredentials,
        fetchUsage: async () => ({ kind: "error", message: "unused" }) as const,
        loadCache,
        saveCache: async () => {},
      },
    }) as const;

  it("retries after USAGE_RETRY_MS when poll throws", async () => {
    let calls = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [],
      usage: usage(async () => {
        calls++;
        throw new Error("EIO");
      }),
    });
    expect(calls).toBe(1);
    expect(r.hub.state(0).sources.usage?.error).toContain("EIO");
    await vi.advanceTimersByTimeAsync(299_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
  });

  it("logs a failing cache load at startup", async () => {
    const lines: string[] = [];
    await start({
      port: 0,
      token: "t",
      sources: [],
      log: (l) => lines.push(l),
      usage: usage(
        async () => null,
        async () => {
          throw new Error("corrupt");
        },
      ),
    });
    expect(lines.some((l) => l.includes("usage cache unreadable") && l.includes("corrupt"))).toBe(
      true,
    );
  });
});

describe("stop", () => {
  it("stops all scans, ticks and polls", async () => {
    let polls = 0;
    const { s, src } = counting(snapshotOf("busy"));
    const r = await start({
      port: 0,
      token: "t",
      sources: [src],
      usage: {
        refresher: { request: async () => false } as never,
        ports: {
          readCredentials: async () => {
            polls++;
            return null;
          },
          fetchUsage: async () => ({ kind: "error", message: "unused" }),
          loadCache: async () => null,
          saveCache: async () => {},
        },
      },
    });
    const tick = vi.spyOn(r.hub, "tick");
    await r.stop();
    const before = { scans: s.scans, polls, ticks: tick.mock.calls.length };
    await vi.advanceTimersByTimeAsync(600_000);
    expect({ scans: s.scans, polls, ticks: tick.mock.calls.length }).toEqual(before);
  });

  it("does not reschedule a scan that finishes after stop", async () => {
    let release: (v: HostSnapshot | InactiveScan) => void = () => {};
    let scans = 0;
    const r = await start({
      port: 0,
      token: "t",
      sources: [
        source(() => {
          scans++;
          return new Promise((res) => {
            release = res;
          });
        }),
      ],
      usage: null,
    });
    await r.stop();
    release({ inactive: "x" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scans).toBe(1);
  });
});

describe("parsePort", () => {
  it("accepts integers in 1..65535", () => {
    expect(parsePort("43711")).toEqual({ port: 43711, warning: null });
    expect(parsePort(undefined)).toEqual({ port: DEFAULT_PORT, warning: null });
  });

  it("falls back to 43710 with a warning for anything else", () => {
    for (const bad of ["0", "65536", "-1", "12.5", "abc", "", "1e3"]) {
      const r = parsePort(bad);
      expect(r.port).toBe(43710);
      expect(r.warning).toContain("VIBETRIBE_PORT");
    }
  });
});
