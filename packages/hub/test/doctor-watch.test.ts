import { afterEach, describe, expect, it, vi } from "vitest";
import { type CheckResult, changed, ok, skipped } from "../src/doctor/check";
import { DRIFT_CHECK_MS, watchDrift } from "../src/doctor/watch";
import { type RunningHub, startHub } from "../src/runtime";

/** Starts the watch with a fake timer; `next(results)` runs the next round with these results. */
async function watch(first: CheckResult[]) {
  const lines: string[] = [];
  const timers: { ms: number; fn: () => void }[] = [];
  let results = first;
  watchDrift({
    check: async () => results,
    log: (l) => lines.push(l),
    later: (ms, fn) => timers.push({ ms, fn }),
  });
  await vi.waitFor(() => expect(timers).toHaveLength(1));
  const next = async (r: CheckResult[]) => {
    results = r;
    const n = timers.length;
    timers[n - 1]?.fn();
    await vi.waitFor(() => expect(timers).toHaveLength(n + 1));
  };
  return { lines, timers, next };
}

const moved = changed("desktop folder", "no claude_desktop_config.json in 3 known folders");

describe("watchDrift", () => {
  it("logs a drift once, its end once, and keeps it while the check is skipped", async () => {
    const { lines, timers, next } = await watch([moved, ok("desktop pins", "6 pinned")]);
    expect(lines).toEqual([
      "drift: desktop folder: no claude_desktop_config.json in 3 known folders",
    ]);
    await next([moved]);
    await next([skipped("desktop folder", "config unreadable right now (EBUSY)")]);
    expect(lines).toHaveLength(1);
    await next([ok("desktop folder", "AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc")]);
    await next([ok("desktop folder", "AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc")]);
    expect(lines.slice(1)).toEqual(["drift resolved: desktop folder"]);
    expect(new Set(timers.map((t) => t.ms))).toEqual(new Set([DRIFT_CHECK_MS]));
  });

  it("logs a failing round by its error code only and checks again an hour later", async () => {
    const lines: string[] = [];
    const timers: number[] = [];
    for (const err of [
      Object.assign(new Error("EACCES: open '/home/someone/.vibetribe/port'"), { code: "EACCES" }),
      new Error("boom at /home/someone"),
    ])
      watchDrift({
        check: async () => {
          throw err;
        },
        log: (l) => lines.push(l),
        later: (ms) => timers.push(ms),
      });
    await vi.waitFor(() => expect(timers).toEqual([DRIFT_CHECK_MS, DRIFT_CHECK_MS]));
    expect(lines).toEqual(["drift check failed: EACCES", "drift check failed: error"]);
  });
});

describe("startHub with a drift check", () => {
  let running: RunningHub | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    await running?.stop();
  });

  it("checks with the bound port at start and every hour, logging only changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const lines: string[] = [];
    const ports: (number | null)[] = [];
    running = await startHub({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      log: (l) => lines.push(l),
      drift: async (port) => {
        ports.push(port);
        return [moved];
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DRIFT_CHECK_MS);
    expect(ports).toEqual([running.port, running.port]);
    expect(lines.filter((l) => l.startsWith("drift"))).toEqual([
      "drift: desktop folder: no claude_desktop_config.json in 3 known folders",
    ]);
  });
});
