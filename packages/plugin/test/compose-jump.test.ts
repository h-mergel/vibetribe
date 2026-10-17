import type { HostSnapshot } from "@vibetribe/core";
import { DESKTOP_POLL_MS, type SessionSource } from "@vibetribe/hub";
import type { HookEnvelope } from "@vibetribe/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySurface, type RunningVibeTribe, startVibeTribe } from "../src/compose";
import { defaultMk2Layout } from "../src/deck/keys";
import type { JumpOpener, JumpResult } from "../src/jump/opener";
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

const stop = (host: string, id: string, cwd = "C:/p"): HookEnvelope => ({
  v: 1,
  kind: "hook",
  source: host.startsWith("wsl:")
    ? { host, os: "wsl", distro: host.slice(4), entrypoint: "cli" }
    : { host, os: "windows", distro: null, entrypoint: "claude-desktop" },
  session: { id, cwd, pid: 7, hostSessionId: null },
  event: {
    name: "Stop",
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

const desktopFile: HostSnapshot["sessions"][number] = {
  sessionId: "s1",
  pid: 7,
  cwd: "C:/p",
  entrypoint: "claude-desktop",
  name: "Desk",
  hostSessionId: "local_7b1f",
  bridgeSessionId: null,
  status: "idle",
  waitingFor: null,
};

const winSessions = (sessions: HostSnapshot["sessions"]): SessionSource => ({
  name: "sessions:win",
  host: "win",
  hostKind: "windows",
  scan: async (now) => ({ host: "win", hostKind: "windows", at: now, sessions }),
});

function recorder(result: JumpResult | "throw") {
  const urls: string[] = [];
  const opener: JumpOpener = {
    open: async (url) => {
      urls.push(url);
      if (result === "throw") throw new Error("boom");
      return result;
    },
  };
  return { opener, urls };
}

async function start(opener: JumpOpener | undefined, clock: () => number) {
  const surface = new MemorySurface();
  const lines: string[] = [];
  app = await startVibeTribe({
    surface,
    hub: {
      port: 0,
      token: "t",
      usage: null,
      sources: [winSessions([desktopFile])],
    },
    opener,
    log: (l) => lines.push(l),
    now: clock,
    tickMs: 10,
    maxFramesPerSecond: 100,
  });
  for (const k of defaultMk2Layout()) app.keyAppeared(k);
  const running = app;
  await until(() => running.hub.hub.state(clock()).sessions.length === 1);
  running.hub.hub.ingest(stop("win", "s1"), clock());
  const stateOf = () => running.hub.hub.state(clock()).sessions[0]?.state;
  await until(() => stateOf() === "done_unseen");
  const text = (id: string) => svgFromDataUrl(surface.images.get(id) ?? "") ?? "";
  // a slot press acts on the session its key showed: wait until the key shows it
  await until(() => text("mk2:1:0").includes(">Done<"));
  return { app: running, lines, stateOf, text };
}

const desktopIdOf = (url: string): string => url.slice(url.lastIndexOf("/") + 1);

/** Two Desktop sessions done and unseen, with a focus port the test sets; setTimeout is faked. */
async function startWithFocus(opener: JumpOpener, clock: () => number) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const files = [
    desktopFile,
    { ...desktopFile, sessionId: "s2", name: "Other", hostSessionId: "local_7b2f" },
  ];
  const focus = new Map<string, number>();
  let asks = 0;
  app = await startVibeTribe({
    surface: new MemorySurface(),
    hub: {
      port: 0,
      token: "t",
      usage: null,
      sources: [winSessions(files)],
      focus: async (ids) => {
        asks++;
        return new Map([...focus].filter(([id]) => ids.includes(id)));
      },
    },
    opener,
    log: () => {},
    now: clock,
    tickMs: 10,
    maxFramesPerSecond: 100,
  });
  const a = app;
  const { hub } = a.hub;
  for (const k of defaultMk2Layout()) a.keyAppeared(k);
  await vi.waitFor(() => expect(hub.state(clock()).sessions).toHaveLength(2));
  hub.ingest(stop("win", "s1"), clock());
  hub.ingest(stop("win", "s2"), clock());
  const stateOf = (desktopId: string) =>
    hub.state(clock()).sessions.find((s) => s.hostSessionId === desktopId)?.state;
  /** runs the next focus poll */
  const poll = async (): Promise<void> => {
    const before = asks;
    await vi.advanceTimersByTimeAsync(DESKTOP_POLL_MS);
    await vi.waitFor(() => expect(asks).toBeGreaterThan(before));
  };
  return { a, focus, stateOf, poll };
}

describe("startVibeTribe jumps", () => {
  it("a slot press opens the Desktop link, marks the session seen and records the jump", async () => {
    const { opener, urls } = recorder("opened");
    const { app: a, lines, stateOf } = await start(opener, Date.now);
    a.press("mk2:1:0", "short");
    await until(() => stateOf() === "idle");
    expect(urls).toEqual(["claude://claude.ai/epitaxy/local_7b1f"]);
    expect(lines).toContain(
      "jump to win/s1 (Desk): claude://claude.ai/epitaxy/local_7b1f (opened)",
    );
    const mirror = (await (await fetch(`http://127.0.0.1:${a.port}/debug/keys.json`)).json()) as {
      jumps: { session: string; result: string }[];
    };
    expect(mirror.jumps).toMatchObject([{ session: "win/s1", result: "opened" }]);
  });

  it("a failed or throwing opener leaves the session unseen", async () => {
    for (const result of ["failed", "throw"] as const) {
      const { opener, urls } = recorder(result);
      const { app: a, lines, stateOf } = await start(opener, Date.now);
      a.press("mk2:1:0", "short");
      await until(() => lines.some((l) => l.endsWith("(failed)")));
      expect(urls).toHaveLength(1);
      expect(stateOf()).toBe("done_unseen");
      await a.stop();
      app = null;
    }
  });

  it("without an opener nothing is opened and nothing is marked seen", async () => {
    const { app: a, lines, stateOf } = await start(undefined, Date.now);
    a.press("mk2:1:0", "short");
    await until(() => lines.some((l) => l.endsWith("(failed)")));
    expect(lines).toContain("jump not opened (no opener): claude://claude.ai/epitaxy/local_7b1f");
    expect(stateOf()).toBe("done_unseen");
  });

  it("the inbox jumps at once and marks seen only on the landing 5 s later", async () => {
    let clock = Date.UTC(2026, 9, 13, 12, 0);
    const { opener, urls } = recorder("logged");
    const { app: a, stateOf } = await start(opener, () => clock);
    a.press("mk2:0:0", "short");
    await until(() => urls.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(stateOf()).toBe("done_unseen");
    clock += 6_000;
    await until(() => stateOf() === "idle");
  });

  it("an inbox landing after a failed jump does not mark the session seen", async () => {
    let clock = Date.UTC(2026, 9, 13, 12, 0);
    const { opener, urls } = recorder("failed");
    const { app: a, lines, stateOf } = await start(opener, () => clock);
    a.press("mk2:0:0", "short");
    await until(() => urls.length === 1 && lines.some((l) => l.endsWith("(failed)")));
    clock += 6_000;
    await until(() => lines.includes("inbox landed on win/s1; not seen, the jump failed"));
    expect(stateOf()).toBe("done_unseen");
  });

  it("an inbox landing while the jump is still in flight does not mark seen when it then fails", async () => {
    let clock = Date.UTC(2026, 9, 13, 12, 0);
    let release: (r: JumpResult) => void = () => {};
    const urls: string[] = [];
    const opener: JumpOpener = {
      open: (url) => {
        urls.push(url);
        return new Promise<JumpResult>((resolve) => {
          release = resolve;
        });
      },
    };
    const { app: a, lines, stateOf } = await start(opener, () => clock);
    a.press("mk2:0:0", "short");
    await until(() => urls.length === 1);
    clock += 6_000;
    await new Promise((r) => setTimeout(r, 100));
    expect(stateOf()).toBe("done_unseen");
    release("failed");
    await until(() => lines.some((l) => l.endsWith("(failed)")));
    expect(stateOf()).toBe("done_unseen");
  });

  it("a session without a link shows 'No link' and is recorded as no_target", async () => {
    const { opener, urls } = recorder("opened");
    const { app: a, lines, text } = await start(opener, Date.now);
    a.hub.hub.ingest(stop("wsl:Ubuntu", "cli-1", "/home/h/clitool"), Date.now());
    // s1 keeps slot 1, the new session takes slot 2
    await until(() => text("mk2:1:1").includes("clitool"));
    a.press("mk2:1:1", "short");
    await until(() => text("mk2:1:1").includes("No link"));
    expect(urls).toEqual([]);
    expect(lines).toContain("jump: wsl:Ubuntu/cli-1 (WSL) has no jump target");
    const mirror = (await (await fetch(`http://127.0.0.1:${a.port}/debug/keys.json`)).json()) as {
      jumps: unknown[];
    };
    expect(mirror.jumps).toMatchObject([
      { session: "wsl:Ubuntu/cli-1", url: null, result: "no_target" },
    ]);
  });

  it("cycling the inbox through Claude Desktop sees only the landing; a later focus of a skipped session counts", async () => {
    const t0 = Date.UTC(2026, 9, 16, 12, 0);
    let clock = t0;
    const { opener, urls } = recorder("opened");
    const { a, focus, stateOf, poll } = await startWithFocus(opener, () => clock);
    a.press("mk2:0:0", "short");
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    a.press("mk2:0:0", "short");
    await vi.waitFor(() => expect(urls).toHaveLength(2));
    const [skipped = "", landed = ""] = urls.map(desktopIdOf);
    // Claude Desktop shows each session about 2 s after the deck opened it
    focus.set(skipped, t0 + 2_000);
    focus.set(landed, t0 + 2_000);
    clock = t0 + 6_000;
    await vi.waitFor(() => expect(stateOf(landed)).toBe("idle"));
    await poll();
    expect(stateOf(skipped)).toBe("done_unseen");
    // later the user opens the skipped session in Claude Desktop
    focus.set(skipped, t0 + 6_000);
    await poll();
    await vi.waitFor(() => expect(stateOf(skipped)).toBe("idle"));
  });

  it("an inbox jump drops the focus it causes even when the opener answers only after it", async () => {
    const t0 = Date.UTC(2026, 9, 16, 12, 0);
    let clock = t0;
    const urls: string[] = [];
    const opener: JumpOpener = {
      open: async (url) => {
        urls.push(url);
        clock = t0 + 3_000;
        return "opened";
      },
    };
    const { a, focus, stateOf, poll } = await startWithFocus(opener, () => clock);
    a.press("mk2:0:0", "short");
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    const jumped = desktopIdOf(urls[0] ?? "");
    focus.set(jumped, t0 + 2_000);
    await poll();
    expect(stateOf(jumped)).toBe("done_unseen");
  });
});
