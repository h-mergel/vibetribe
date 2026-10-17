import { describe, expect, it, vi } from "vitest";
import { DESKTOP_POLL_MS, type DesktopPorts, pollDesktop } from "../src/desktop-poll";
import { Hub } from "../src/hub";
import { hook, info, KEY, scan, T } from "./background-fixtures";

const ID = "local_0a1b2c3d-0000-4000-8000-00000000000a";

/** A hub with one session of Claude Desktop whose `name` hook arrived at T. */
function hubWith(name: string, hostSessionId: string | null = ID): Hub {
  const hub = new Hub();
  hub.ingestSnapshot(scan(T - 10_000, [{ ...info, hostSessionId }]));
  hub.ingest(hook(name), T);
  return hub;
}

/** Starts the loop with a fake timer; `next()` runs the next poll. */
async function poll(hub: Hub, ports: Partial<DesktopPorts>, now = T + 5_000) {
  const lines: string[] = [];
  const timers: { ms: number; fn: () => void }[] = [];
  pollDesktop({
    hub,
    ports: { pins: null, focus: null, ...ports },
    now: () => now,
    log: (l) => lines.push(l),
    later: (ms, fn) => timers.push({ ms, fn }),
  });
  await vi.waitFor(() => expect(timers).toHaveLength(1));
  const next = async () => {
    const n = timers.length;
    timers[n - 1]?.fn();
    await vi.waitFor(() => expect(timers).toHaveLength(n + 1));
  };
  return { lines, timers, next };
}

const focusAt = (at: number, asked: (readonly string[])[] = []) => ({
  focus: async (ids: readonly string[]) => {
    asked.push(ids);
    return new Map([[ID, at]]);
  },
});

describe("pollDesktop with the focus of Claude Desktop's sessions", () => {
  it("a Done session opened in Claude Desktop after its turn ended counts as seen", async () => {
    const hub = hubWith("Stop");
    const asked: (readonly string[])[] = [];
    const { lines } = await poll(hub, focusAt(T + 2_000, asked));
    expect(asked).toEqual([[ID]]);
    expect(hub.state(T + 5_000).sessions[0]).toMatchObject({ state: "idle", episodeSeen: true });
    expect(lines).toEqual(["seen in Claude Desktop: 1"]);
  });

  it("an opened request stops escalating but still waits for the answer, as after a jump", async () => {
    const hub = hubWith("PermissionRequest");
    await poll(hub, focusAt(T + 2_000));
    expect(hub.state(T + 5_000).sessions[0]).toMatchObject({
      state: "needs_permission",
      episodeSince: T,
      episodeSeen: true,
    });
  });

  it.each([
    ["before the turn ended: the session was open already", T - 1],
    ["at the very moment the turn ended", T],
    ["later than now: clock skew", T + 60_000],
  ])("a focus %s changes nothing", async (_name, at) => {
    const hub = hubWith("Stop");
    const { lines } = await poll(hub, focusAt(at));
    expect(hub.state(T + 5_000).sessions[0]).toMatchObject({
      state: "done_unseen",
      episodeSeen: false,
    });
    expect(lines).toEqual([]);
  });

  it("reads no focus while no session of Claude Desktop waits to be seen", async () => {
    const seen = hubWith("Stop");
    seen.markSeen({ key: KEY, hostKind: "wsl" }, T + 1_000);
    const asked: (readonly string[])[] = [];
    await poll(seen, focusAt(T + 2_000, asked));
    await poll(hubWith("Stop", null), focusAt(T + 2_000, asked));
    await poll(hubWith("UserPromptSubmit"), focusAt(T + 2_000, asked));
    expect(asked).toEqual([]);
  });

  it("compares with the episode as it is after the read: one that began meanwhile stays unseen", async () => {
    const hub = hubWith("Stop");
    await poll(hub, {
      focus: async () => {
        hub.ingest(hook("PermissionRequest"), T + 3_000);
        return new Map([[ID, T + 2_000]]);
      },
    });
    expect(hub.state(T + 5_000).sessions[0]).toMatchObject({
      state: "needs_permission",
      episodeSince: T + 3_000,
      episodeSeen: false,
    });
  });

  it("reads pins and focus again every 5 s; a failing port is logged and stops neither", async () => {
    const hub = hubWith("Stop");
    let reads = 0;
    const { lines, timers, next } = await poll(hub, {
      pins: async () => {
        reads++;
        if (reads === 1) throw new Error("locked");
        return ["local_b"];
      },
      focus: async () => {
        if (reads === 1) throw new Error("gone");
        return new Map([[ID, T + 2_000]]);
      },
    });
    expect(lines).toEqual([
      "desktop pins failed: Error: locked",
      "desktop focus failed: Error: gone",
    ]);
    expect(timers.map((t) => t.ms)).toEqual([DESKTOP_POLL_MS]);
    await next();
    expect(hub.state(T + 5_000).pins).toEqual(["local_b"]);
    expect(hub.state(T + 5_000).sessions[0]?.state).toBe("idle");
    expect(timers.map((t) => t.ms)).toEqual([DESKTOP_POLL_MS, DESKTOP_POLL_MS]);
  });
});
