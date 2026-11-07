import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub";
import type { RemoteSession } from "../src/remote/api";

const T = 1_000_000;
const rs = (id: string, over: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  title: id.slice(10),
  status: "idle",
  doneUnread: false,
  quiet: true,
  at: null,
  ...over,
});
const byId = (hub: Hub, now: number) =>
  Object.fromEntries(hub.state(now).sessions.map((v) => [v.key.sessionId, v]));

describe("Hub – local before remote", () => {
  const local = (bridge: string | null) => ({
    host: "win",
    hostKind: "windows" as const,
    at: 0,
    sessions:
      bridge === null
        ? []
        : [
            {
              sessionId: "local-1",
              pid: 7,
              cwd: "C:/p",
              entrypoint: "claude-desktop",
              name: "Lokal",
              hostSessionId: "local_7b1f",
              bridgeSessionId: bridge,
              status: "idle" as const,
              waitingFor: null,
            },
          ],
  });
  const ids = (hub: Hub, now: number) =>
    hub
      .state(now)
      .sessions.map((s) => `${s.key.host}/${s.key.sessionId}`)
      .sort();

  it("remote list first, local scan second: the duplicate disappears with the local scan", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Local"), rs("session_01Mac")], T);
    expect(ids(hub, T)).toEqual(["remote/session_01Local", "remote/session_01Mac"]);
    hub.drainRemovals();
    hub.ingestSnapshot({ ...local("session_01Local"), at: T + 1_500 });
    expect(ids(hub, T + 1_500)).toEqual(["remote/session_01Mac", "win/local-1"]);
    expect(hub.drainRemovals()).toMatchObject([{ id: "remote/session_01Local", reason: "gone" }]);
    // a re-plan is no sign of life: the remote host still goes no_signal 90 s after the listing
    expect(byId(hub, T + 90_000).session_01Mac?.state).toBe("no_signal");
  });

  it("a local session that ended while the list still calls it connected leaves no REM ghost for 120 s", () => {
    const hub = new Hub();
    hub.ingestSnapshot({ ...local("session_01Local"), at: T });
    hub.ingestRemote([rs("session_01Local")], T + 1_000);
    hub.ingestSnapshot({ ...local(null), at: T + 5_000 });
    expect(ids(hub, T + 5_000)).toEqual([]);
    hub.ingestRemote([rs("session_01Local")], T + 20_000);
    expect(ids(hub, T + 20_000)).toEqual([]);
    hub.ingestRemote([rs("session_01Local")], T + 119_000);
    expect(ids(hub, T + 119_000)).toEqual([]);
    // still listed as connected two minutes later: then it really runs remotely
    hub.ingestRemote([rs("session_01Local")], T + 125_000);
    expect(ids(hub, T + 125_000)).toEqual(["remote/session_01Local"]);
  });

  it("a local scan after the no-signal removal does not bring back the stale listing", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Mac", { doneUnread: true, at: T - 5_000 })], T);
    hub.tick(T + 210_000);
    expect(hub.drainRemovals()).toMatchObject([{ reason: "no_signal_timeout" }]);
    hub.ingestSnapshot({ ...local("session_01Local"), at: T + 215_000 });
    expect(ids(hub, T + 215_000)).toEqual(["win/local-1"]);
    expect(hub.drainRemovals()).toEqual([]);
  });

  it("a local session that returns within the hold restarts it", () => {
    const hub = new Hub();
    hub.ingestSnapshot({ ...local("session_01Local"), at: T });
    hub.ingestSnapshot({ ...local(null), at: T + 5_000 });
    // back after the 60 s tombstone of its first end
    hub.ingestSnapshot({ ...local("session_01Local"), at: T + 70_000 });
    expect(ids(hub, T + 70_000)).toEqual(["win/local-1"]);
    hub.ingestSnapshot({ ...local(null), at: T + 75_000 });
    // 120 s after the first end, but only 55 s after the last local sighting
    hub.ingestRemote([rs("session_01Local")], T + 125_000);
    expect(ids(hub, T + 125_000)).toEqual([]);
    hub.ingestRemote([rs("session_01Local")], T + 190_000);
    expect(ids(hub, T + 190_000)).toEqual(["remote/session_01Local"]);
  });

  it("a done + unread session that was local first is raised when it shows up as remote", () => {
    const hub = new Hub();
    const done = rs("session_01Local", { doneUnread: true, at: T });
    hub.ingestSnapshot({ ...local("session_01Local"), at: T });
    hub.ingestRemote([done], T + 1_000);
    hub.ingestSnapshot({ ...local(null), at: T + 5_000 });
    hub.ingestRemote([done], T + 20_000);
    expect(ids(hub, T + 20_000)).toEqual([]);
    hub.ingestRemote([done], T + 130_000);
    expect(byId(hub, T + 130_000).session_01Local?.state).toBe("done_unseen");
  });
});
