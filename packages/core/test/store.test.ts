import { describe, expect, it } from "vitest";
import { basenameAny, SessionStore } from "../src/store";
import { ev, file, KEY } from "./helpers";

const REMOTE_KEY = { host: "mac:mbp", sessionId: "m1" };

describe("linking and view", () => {
  it("hook-only session shows its host badge before the file links it", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "prompt_submit", at: 1_000, auto: false }));
    expect(store.view(1_000)[0]).toMatchObject({
      id: "wsl:Ubuntu/s1",
      badge: "WSL",
      state: "working",
    });
    store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 2_000,
      sessions: [file({ status: "busy" })],
    });
    expect(store.view(2_000)[0]).toMatchObject({ badge: "WSL", title: "atlas", pid: 4242 });
  });

  it("keeps the hook cwd of a session first seen through a non-SessionStart hook", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "prompt_submit", at: 1_000, auto: false, cwd: "/home/h/atlas" }));
    expect(store.view(1_000)[0]).toMatchObject({ title: "atlas", cwd: "/home/h/atlas" });
  });

  it("badge names the host, not the entrypoint: Desktop sessions show WIN or WSL", () => {
    const store = new SessionStore();
    const desktop = { entrypoint: "claude-desktop", hostSessionId: "local_abc" };
    store.applySnapshot({
      host: "win",
      hostKind: "windows",
      at: 1,
      sessions: [file({ sessionId: "w1", ...desktop })],
    });
    store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 1,
      sessions: [file({ sessionId: "l1", ...desktop })],
    });
    store.apply(
      ev(
        { type: "prompt_submit", at: 1, auto: false },
        { host: "mac:mbp", sessionId: "m1" },
        "remote",
      ),
    );
    const badges = Object.fromEntries(store.view(1).map((v) => [v.key.sessionId, v.badge]));
    expect(badges).toEqual({ w1: "WIN", l1: "WSL", m1: "REM" });
    // the jump still uses the entrypoint and the Desktop id
    expect(store.view(1).find((v) => v.key.sessionId === "w1")).toMatchObject({
      entrypoint: "claude-desktop",
      hostSessionId: "local_abc",
    });
  });

  it("a Desktop session in WSL shows WSL; desktop name is the title", () => {
    const store = new SessionStore();
    store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 1,
      sessions: [
        file({
          entrypoint: "claude-desktop",
          name: "Mobile Entwicklung Northwind",
          hostSessionId: "local_abc",
        }),
      ],
    });
    expect(store.view(1)[0]).toMatchObject({
      badge: "WSL",
      title: "Mobile Entwicklung Northwind",
      hostSessionId: "local_abc",
    });
  });

  it("windows host without file name uses the cwd basename", () => {
    const store = new SessionStore();
    const key = { host: "win", sessionId: "w1" };
    store.applySnapshot({
      host: "win",
      hostKind: "windows",
      at: 1,
      sessions: [file({ sessionId: "w1", cwd: "C:\\dev\\n8nfmt" })],
    });
    expect(store.view(1).find((v) => v.key.sessionId === key.sessionId)).toMatchObject({
      badge: "WIN",
      title: "n8nfmt",
    });
  });

  it("basenameAny handles both separators and trailing slashes", () => {
    expect(basenameAny("/home/h/atlas/")).toBe("atlas");
    expect(basenameAny("C:\\dev\\n8nfmt")).toBe("n8nfmt");
    expect(basenameAny("")).toBe("");
  });
});

describe("removal", () => {
  it("a snapshot is authoritative for linked sessions but keeps hook-only ones", () => {
    const store = new SessionStore();
    store.applySnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1, sessions: [file()] });
    store.apply(
      ev(
        { type: "prompt_submit", at: 2, auto: false },
        { host: "wsl:Ubuntu", sessionId: "hookonly" },
      ),
    );
    const removed = store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 3,
      sessions: [],
    });
    expect(removed).toEqual([
      {
        id: "wsl:Ubuntu/s1",
        key: KEY,
        reason: "gone",
        cwd: "/home/h2k/dev/projects/atlas",
        pid: 4242,
      },
    ]);
    expect(store.view(3).map((v) => v.key.sessionId)).toEqual(["hookonly"]);
  });

  it("a late stop after a snapshot removal does not resurrect the session", () => {
    const store = new SessionStore();
    store.applySnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1, sessions: [file()] });
    store.applySnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 2, sessions: [] });
    store.apply(ev({ type: "stop", at: 3, background: null }));
    expect(store.view(3)).toEqual([]);
    store.apply(ev({ type: "prompt_submit", at: 59_999, auto: false }));
    expect(store.view(59_999)).toEqual([]);
  });

  it("a hook-only session younger than the grace period survives a snapshot that omits it", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "prompt_submit", at: 0, auto: false }));
    const removed = store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 14_999,
      sessions: [],
    });
    expect(removed).toEqual([]);
    expect(store.view(14_999)).toHaveLength(1);
  });

  it("a hook-only session older than the grace period is removed by a snapshot", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "prompt_submit", at: 0, auto: false }));
    const removed = store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 15_000,
      sessions: [],
    });
    expect(removed).toEqual([
      { id: "wsl:Ubuntu/s1", key: KEY, reason: "gone", cwd: "", pid: null },
    ]);
    expect(store.view(15_000)).toEqual([]);
    store.apply(ev({ type: "stop", at: 15_001, background: null }));
    expect(store.view(15_001)).toEqual([]);
  });

  it("the hook-only grace period is limited to the snapshot's host", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "prompt_submit", at: 0, auto: false }));
    store.apply(
      ev({ type: "prompt_submit", at: 0, auto: false }, { host: "win", sessionId: "w" }, "windows"),
    );
    const removed = store.applySnapshot({
      host: "wsl:Ubuntu",
      hostKind: "wsl",
      at: 15_000,
      sessions: [],
    });
    expect(removed.map((r) => r.id)).toEqual(["wsl:Ubuntu/s1"]);
    expect(store.view(15_000).map((v) => v.id)).toEqual(["win/w"]);
  });

  it("session_end reports the reason and blocks late events (tombstone)", () => {
    const store = new SessionStore();
    store.applySnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1, sessions: [file()] });
    const removed = store.apply(ev({ type: "session_end", at: 2, reason: "clear" }));
    expect(removed[0]).toMatchObject({
      reason: "clear",
      cwd: "/home/h2k/dev/projects/atlas",
      pid: 4242,
    });
    store.apply(ev({ type: "tool_end", at: 3, toolName: "Bash", toolUseId: "t1", agentId: null }));
    store.applySnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 4, sessions: [file()] });
    expect(store.view(4)).toEqual([]);
    store.tick(70_000);
    store.apply(ev({ type: "prompt_submit", at: 70_001, auto: false }));
    expect(store.view(70_001)).toHaveLength(1);
  });

  it("hook-only sessions expire after 30 minutes without events", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "prompt_submit", at: 0, auto: false }));
    expect(store.tick(1_799_999)).toEqual([]);
    expect(store.tick(1_800_000)[0]).toMatchObject({ reason: "hook_only_ttl" });
  });
});

describe("remote hosts", () => {
  it("remote sessions go no_signal after 90 s and are removed after 210 s", () => {
    const store = new SessionStore();
    store.applySnapshot({
      host: "mac:mbp",
      hostKind: "remote",
      at: 0,
      sessions: [file({ sessionId: "m1", status: "busy" })],
    });
    store.apply(
      ev({ type: "wait_start", at: 1, reason: "permission", waitId: "t1" }, REMOTE_KEY, "remote"),
    );
    expect(store.view(60_000)[0].state).toBe("needs_permission");
    expect(store.view(91_000)[0].state).toBe("no_signal");
    expect(store.tick(209_000)).toEqual([]);
    expect(store.tick(211_000)[0]).toMatchObject({ reason: "no_signal_timeout" });
  });

  it("a deck 'seen' is no sign of life for the host", () => {
    const store = new SessionStore();
    store.applySnapshot({
      host: "mac:mbp",
      hostKind: "remote",
      at: 0,
      sessions: [file({ sessionId: "m1" })],
    });
    store.apply(ev({ type: "seen", at: 80_000 }, REMOTE_KEY, "remote"));
    expect(store.view(91_000)[0].state).toBe("no_signal");
  });

  it("a late event of an ended remote session is no sign of life for the host", () => {
    const store = new SessionStore();
    store.applySnapshot({
      host: "mac:mbp",
      hostKind: "remote",
      at: 0,
      sessions: [file({ sessionId: "m1" }), file({ sessionId: "m2" })],
    });
    store.apply(ev({ type: "session_end", at: 1, reason: null }, REMOTE_KEY, "remote"));
    store.apply(
      ev(
        { type: "tool_end", at: 50_000, toolName: "Bash", toolUseId: "t1", agentId: null },
        REMOTE_KEY,
        "remote",
      ),
    );
    expect(store.view(91_000).map((v) => v.state)).toEqual(["no_signal"]);
  });

  it("host liveness never moves backwards when events arrive out of order", () => {
    const store = new SessionStore();
    store.applySnapshot({
      host: "mac:mbp",
      hostKind: "remote",
      at: 0,
      sessions: [file({ sessionId: "m1" })],
    });
    store.applyFileDelta("mac:mbp", "remote", 100_000, file({ sessionId: "m1" }));
    store.applyFileDelta("mac:mbp", "remote", 10_000, file({ sessionId: "m1" }));
    store.applyFileDelta("mac:mbp", "remote", 20_000, file({ sessionId: "m1" }));
    store.applySnapshot({
      host: "mac:mbp",
      hostKind: "remote",
      at: 5_000,
      sessions: [file({ sessionId: "m1" })],
    });
    expect(store.view(150_000)[0].state).toBe("idle");
  });

  it("a file delta keeps the host alive and does not remove other sessions", () => {
    const store = new SessionStore();
    store.applySnapshot({
      host: "mac:mbp",
      hostKind: "remote",
      at: 0,
      sessions: [file({ sessionId: "m1" }), file({ sessionId: "m2" })],
    });
    store.applyFileDelta("mac:mbp", "remote", 85_000, file({ sessionId: "m1", status: "busy" }));
    const states = store.view(150_000).map((v) => [v.key.sessionId, v.state]);
    expect(states).toEqual([
      ["m1", "working"],
      ["m2", "idle"],
    ]);
    expect(store.tick(200_000)).toEqual([]);
  });
});

describe("background staleness", () => {
  it("marks the background count stale after 30 minutes without change", () => {
    const store = new SessionStore();
    store.apply(ev({ type: "stop", at: 0, background: [{ id: "b1", kind: "shell" }] }));
    expect(store.view(1_799_999)[0].background).toMatchObject({ count: 1, stale: false });
    expect(store.view(1_800_000)[0].background).toMatchObject({
      count: 1,
      stale: true,
      kinds: { shell: 1, agent: 0, monitor: 0, other: 0 },
    });
  });
});
