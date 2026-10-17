import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/store";
import { ev, file, KEY } from "./helpers";

const local = (store: SessionStore, at: number) =>
  store.applySnapshot({ host: KEY.host, hostKind: "wsl", at, sessions: [file()] });
const shell = { id: "b1", kind: "shell" as const };
const agent = { id: "a1", kind: "agent" as const };

describe("SessionStore background records (Plan 7)", () => {
  it("lists local sessions with jobs and their change time; remote and job-free sessions are left out", () => {
    const store = new SessionStore();
    local(store, 0);
    store.apply(ev({ type: "stop", at: 1_000, background: [shell, agent] }));
    store.applySnapshot({
      host: "remote",
      hostKind: "remote",
      at: 0,
      sessions: [file({ sessionId: "session_01", pid: null })],
    });
    store.apply(
      ev(
        { type: "stop", at: 1_000, background: [shell] },
        { host: "remote", sessionId: "session_01" },
        "remote",
      ),
    );
    store.applySnapshot({
      host: "win",
      hostKind: "windows",
      at: 0,
      sessions: [file({ sessionId: "w1" })],
    });
    expect(store.backgrounds()).toEqual([{ key: KEY, tasks: [shell, agent], changedAt: 1_000 }]);
  });

  it("restores saved jobs onto a known session without jobs, keeping the change time", () => {
    const store = new SessionStore();
    local(store, 100_000);
    expect(store.restoreBackground({ key: KEY, tasks: [shell], changedAt: 50_000 })).toBe(true);
    const v = store.view(100_000)[0];
    expect(v?.state).toBe("background");
    expect(v?.background).toMatchObject({ count: 1, kinds: { shell: 1 }, stale: false });
    // the 30 min stale mark counts from the saved change time
    expect(store.view(50_000 + 1_800_000)[0]?.background.stale).toBe(true);
    // a later live snapshot replaces it as usual
    store.apply(ev({ type: "stop", at: 120_000, background: [] }));
    expect(store.view(120_000)[0]?.background.count).toBe(0);
  });

  it("does not restore onto unknown sessions, over live jobs or from an empty list", () => {
    const store = new SessionStore();
    expect(store.restoreBackground({ key: KEY, tasks: [shell], changedAt: 0 })).toBe(false);
    local(store, 0);
    expect(store.restoreBackground({ key: KEY, tasks: [], changedAt: 0 })).toBe(false);
    store.apply(ev({ type: "subagent_start", at: 10, agentId: "live" }));
    expect(store.restoreBackground({ key: KEY, tasks: [shell], changedAt: 0 })).toBe(false);
    expect(store.backgrounds()[0]?.tasks).toEqual([{ id: "live", kind: "agent" }]);
  });
});
