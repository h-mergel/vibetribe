import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub";
import { mapRemoteSession, type RemoteSession } from "../src/remote/api";
import { RemoteTracker, TURN_MEMORY_MS } from "../src/remote/tracker";

const T = 1_000_000;
const rs = (id: string, over: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  title: id.slice(10),
  status: "idle",
  doneUnread: false,
  at: null,
  ...over,
});
const byId = (hub: Hub, now: number) =>
  Object.fromEntries(hub.state(now).sessions.map((v) => [v.key.sessionId, v]));

/** a connected idle session in the shape of the review_ready probe (2026-10-14), mapped by the parser */
const reviewReady = (unread: boolean, at: number): RemoteSession => {
  const s = mapRemoteSession({
    id: "cse_01Rev",
    title: "Review",
    connection_status: "connected",
    status: "active",
    status_bucket: "review_ready",
    worker_status: "idle",
    unread,
    last_event_at: new Date(at).toISOString(),
    external_metadata: { post_turn_summary: { status_category: "review_ready" } },
  });
  if (!s) throw new Error("probe shape not mapped");
  return s;
};

describe("Hub.ingestRemote", () => {
  it("maps a listing onto REM sessions; episodes start at last_event_at", () => {
    const hub = new Hub();
    hub.ingestRemote(
      [
        rs("session_01Wait", { status: "waiting", at: T - 30_000 }),
        rs("session_01Busy", { status: "busy" }),
        rs("session_01Done", { doneUnread: true, at: T - 5_000 }),
        rs("session_01Idle"),
      ],
      T,
    );
    const v = byId(hub, T);
    expect(v.session_01Wait).toMatchObject({
      state: "needs_input",
      badge: "REM",
      hostKind: "remote",
      title: "Wait",
      pid: null,
      bridgeSessionId: "session_01Wait",
      episodeSince: T - 30_000,
      episodeSeen: false,
    });
    expect(v.session_01Busy?.state).toBe("working");
    expect(v.session_01Done).toMatchObject({ state: "done_unseen", episodeSince: T - 5_000 });
    expect(v.session_01Idle?.state).toBe("idle");
    expect(hub.state(T).sources["sessions:remote"]).toMatchObject({ health: "ok", lastAt: T });
  });

  it("never starts an episode in the future when the server clock runs ahead", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Wait", { status: "waiting", at: T + 60_000 })], T);
    expect(byId(hub, T).session_01Wait?.episodeSince).toBe(T);
  });

  it("does not duplicate a local session that uses Remote Control", () => {
    const hub = new Hub();
    hub.ingestSnapshot({
      host: "win",
      hostKind: "windows",
      at: T,
      sessions: [
        {
          sessionId: "local-1",
          pid: 7,
          cwd: "C:/p",
          entrypoint: "claude-desktop",
          name: "Lokal",
          hostSessionId: "local_7b1f",
          bridgeSessionId: "session_01Local",
          status: "idle",
          waitingFor: null,
        },
      ],
    });
    hub.ingestRemote([rs("session_01Local"), rs("session_01Mac")], T);
    const sessions = hub.state(T).sessions;
    expect(sessions.map((s) => [s.key.host, s.key.sessionId])).toEqual([
      ["win", "local-1"],
      ["remote", "session_01Mac"],
    ]);
  });

  it("removes a remote session once the listing no longer shows it (disconnected, archived)", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A"), rs("session_01B")], T);
    hub.drainRemovals();
    hub.ingestRemote([rs("session_01A")], T + 20_000);
    expect(hub.drainRemovals()).toMatchObject([{ id: "remote/session_01B", reason: "gone" }]);
    expect(hub.state(T + 20_000).sessions.map((s) => s.key.sessionId)).toEqual(["session_01A"]);
  });

  it("a done session seen on the deck stays seen while the list still calls it unread", () => {
    const hub = new Hub();
    const done = rs("session_01Done", { doneUnread: true });
    hub.ingestRemote([done], T);
    const view = byId(hub, T).session_01Done;
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([done], T + 20_000);
    expect(byId(hub, T + 20_000).session_01Done?.state).toBe("idle");
  });

  it("read on another device: done + unread turning read ends done_unseen", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Done", { doneUnread: true })], T);
    hub.ingestRemote([rs("session_01Done")], T + 20_000);
    expect(byId(hub, T + 20_000).session_01Done?.state).toBe("idle");
  });

  it("a new turn after done raises done_unseen again when it finishes", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Done", { doneUnread: true })], T);
    hub.ingestRemote([rs("session_01Done", { status: "busy" })], T + 20_000);
    expect(byId(hub, T + 20_000).session_01Done?.state).toBe("working");
    hub.ingestRemote([rs("session_01Done", { doneUnread: true })], T + 40_000);
    expect(byId(hub, T + 40_000).session_01Done).toMatchObject({
      state: "done_unseen",
      episodeSince: T + 40_000,
    });
  });

  it.each([
    ["read elsewhere", false],
    ["seen on the deck", true],
  ])("a quick wait after a done turn, then read: calm, not done (%s)", (_name, seenOnDeck) => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Ask", { doneUnread: true, at: T })], T);
    if (seenOnDeck) {
      const view = byId(hub, T).session_01Ask;
      if (!view) throw new Error("missing");
      hub.markSeen(view, T + 1_000);
    } else hub.ingestRemote([rs("session_01Ask", { at: T })], T + 20_000);
    hub.ingestRemote([rs("session_01Ask", { status: "waiting", at: T + 30_000 })], T + 40_000);
    expect(byId(hub, T + 40_000).session_01Ask?.state).toBe("needs_input");
    hub.ingestRemote([rs("session_01Ask", { at: T + 30_000 })], T + 60_000);
    expect(byId(hub, T + 60_000).session_01Ask?.state).toBe("idle");
  });

  it("needs input ends when the listing says the session is no longer blocked", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01Wait", { status: "waiting" })], T);
    hub.ingestRemote([rs("session_01Wait", { status: "busy" })], T + 20_000);
    expect(byId(hub, T + 20_000).session_01Wait?.state).toBe("working");
  });

  it("without a new listing the sessions go no_signal after 90 s and are removed after 210 s", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A", { status: "waiting" })], T);
    expect(byId(hub, T + 89_000).session_01A?.state).toBe("needs_input");
    expect(byId(hub, T + 90_000).session_01A?.state).toBe("no_signal");
    hub.tick(T + 210_000);
    expect(hub.drainRemovals()).toMatchObject([{ reason: "no_signal_timeout" }]);
  });

  it("an empty listing is a valid listing: it removes every remote session and marks the source ok", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A")], T);
    hub.ingestRemote([], T + 20_000);
    expect(hub.state(T + 20_000).sessions).toEqual([]);
    expect(hub.state(T + 20_000).sources["sessions:remote"]?.health).toBe("ok");
  });
});

describe("Hub.ingestRemote – seen and turns", () => {
  it("a done session read elsewhere that is blocked again in the same poll raises an unseen wait", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T - 1_000 })], T);
    hub.ingestRemote([rs("session_01A", { status: "waiting", at: T + 15_000 })], T + 20_000);
    expect(byId(hub, T + 20_000).session_01A).toMatchObject({
      state: "needs_input",
      episodeSeen: false,
      episodeSince: T + 15_000,
    });
  });

  it("R4 (ruling): a bare last_event_at bump on a seen, still unread idle session is no new turn", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T - 5_000 })], T);
    const view = byId(hub, T).session_01A;
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T + 15_000 })], T + 20_000);
    expect(byId(hub, T + 20_000).session_01A?.state).toBe("idle");
  });

  it("R3: a new turn after the user saw the last one is raised again once a poll saw it working", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T - 5_000 })], T);
    const view = byId(hub, T).session_01A;
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([rs("session_01A", { status: "busy", at: T + 15_000 })], T + 20_000);
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T + 35_000 })], T + 40_000);
    expect(byId(hub, T + 40_000).session_01A).toMatchObject({
      state: "done_unseen",
      episodeSince: T + 35_000,
    });
  });

  it("R4: after a disconnect flap a seen turn stays seen, an unseen turn comes back unseen", () => {
    const hub = new Hub();
    const seen = rs("session_01Seen", { doneUnread: true, at: T - 5_000 });
    const unseen = rs("session_01Unseen", { doneUnread: true, at: T - 4_000 });
    hub.ingestRemote([seen, unseen], T);
    const view = byId(hub, T).session_01Seen;
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([], T + 20_000);
    expect(hub.state(T + 20_000).sessions).toEqual([]);
    // the removal leaves a 60 s tombstone; the tick drops it
    hub.tick(T + 81_000);
    hub.ingestRemote([seen, unseen], T + 100_000);
    const v = byId(hub, T + 100_000);
    expect(v.session_01Seen?.state).toBe("idle");
    expect(v.session_01Unseen?.state).toBe("done_unseen");
  });

  it("review_ready (probe 2026-10-14): Done once, a bare bump stays seen, unread again is a new turn", () => {
    const hub = new Hub();
    hub.ingestRemote([reviewReady(true, T - 5_000)], T);
    const view = byId(hub, T).session_01Rev;
    expect(view).toMatchObject({ state: "done_unseen", episodeSince: T - 5_000, badge: "REM" });
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([reviewReady(true, T + 15_000)], T + 20_000);
    expect(byId(hub, T + 20_000).session_01Rev?.state).toBe("idle");
    hub.ingestRemote([reviewReady(false, T + 15_000)], T + 40_000);
    expect(byId(hub, T + 40_000).session_01Rev?.state).toBe("idle");
    hub.ingestRemote([reviewReady(true, T + 55_000)], T + 60_000);
    expect(byId(hub, T + 60_000).session_01Rev).toMatchObject({
      state: "done_unseen",
      episodeSince: T + 55_000,
    });
  });

  it("review_ready after a restart: a new hub shows the unread turn as Done once, a later bare bump raises nothing", () => {
    const before = new Hub();
    before.ingestRemote([reviewReady(true, T - 5_000)], T);
    const seen = byId(before, T).session_01Rev;
    if (!seen) throw new Error("missing");
    before.markSeen(seen, T + 1_000);
    // the plugin restarts: the turn memory is gone, so the still unread turn comes back once
    const after = new Hub();
    after.ingestRemote([reviewReady(true, T - 5_000)], T + 60_000);
    expect(byId(after, T + 60_000).session_01Rev).toMatchObject({
      state: "done_unseen",
      episodeSince: T - 5_000,
    });
    after.ingestRemote([reviewReady(true, T + 70_000)], T + 80_000);
    expect(byId(after, T + 80_000).session_01Rev).toMatchObject({
      state: "done_unseen",
      episodeSince: T - 5_000,
    });
  });

  it("R5: after the no-signal removal a session that is still done + unread is raised again", () => {
    const hub = new Hub();
    const done = rs("session_01A", { doneUnread: true, at: T - 5_000 });
    hub.ingestRemote([done], T);
    hub.tick(T + 210_000);
    expect(hub.drainRemovals()).toMatchObject([{ reason: "no_signal_timeout" }]);
    hub.ingestRemote([done], T + 300_000);
    expect(byId(hub, T + 300_000).session_01A?.state).toBe("done_unseen");
  });
});

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

describe("RemoteTracker", () => {
  const none = new Set<string>();

  it("keeps the first of duplicate ids and reports finished/read edges once", () => {
    const t = new RemoteTracker();
    const first = t.plan(
      [rs("session_01A", { doneUnread: true }), rs("session_01A", { status: "busy" })],
      none,
      none,
      T,
    );
    expect(first.snapshot.sessions.map((s) => [s.sessionId, s.status])).toEqual([
      ["session_01A", "idle"],
    ]);
    expect(first.finished).toEqual([{ sessionId: "session_01A", at: T }]);
    const present = new Set(["session_01A"]);
    expect(
      t.plan([rs("session_01A", { doneUnread: true })], none, present, T + 1).finished,
    ).toEqual([]);
    expect(t.plan([rs("session_01A")], none, present, T + 2).read).toEqual(["session_01A"]);
    expect(t.plan([rs("session_01A")], none, present, T + 3).read).toEqual([]);
  });

  it("reads only an idle session: a session that turns busy or waiting is not read", () => {
    const t = new RemoteTracker();
    const present = new Set(["session_01A"]);
    t.plan([rs("session_01A", { doneUnread: true })], none, none, T);
    expect(t.plan([rs("session_01A", { status: "waiting" })], none, present, T + 1).read).toEqual(
      [],
    );
  });

  it("a session that vanished is neither finished nor read", () => {
    const t = new RemoteTracker();
    t.plan([rs("session_01A", { doneUnread: true })], none, none, T);
    expect(t.plan([], none, none, T + 1)).toMatchObject({ finished: [], read: [] });
  });

  it("forgets a turn after TURN_MEMORY_MS without a listing, and on forget()", () => {
    const t = new RemoteTracker();
    const done = rs("session_01A", { doneUnread: true, at: T });
    t.plan([done], none, none, T);
    t.ack("session_01A");
    const present = new Set(["session_01A"]);
    expect(t.plan([done], none, present, T + 1).finished).toEqual([]);
    t.plan([], none, none, T + 2);
    expect(t.plan([done], none, none, T + 2 + TURN_MEMORY_MS + 1).finished).toHaveLength(1);
    t.ack("session_01A");
    t.forget("session_01A");
    expect(t.plan([done], none, present, T + 3 + TURN_MEMORY_MS).finished).toHaveLength(1);
  });

  it("R4 (ruling): a changed last_event_at alone is no new turn, a read in between makes one", () => {
    const t = new RemoteTracker();
    const present = new Set(["session_01A"]);
    t.plan([rs("session_01A", { doneUnread: true, at: T })], none, none, T);
    t.ack("session_01A");
    const bumped = t.plan(
      [rs("session_01A", { doneUnread: true, at: T + 5 })],
      none,
      present,
      T + 10,
    );
    expect(bumped.finished).toEqual([]);
    // read elsewhere (done + unread went false), then unread again with a new time: a new turn
    expect(t.plan([rs("session_01A", { at: T + 5 })], none, present, T + 20).read).toEqual([
      "session_01A",
    ]);
    expect(
      t.plan([rs("session_01A", { doneUnread: true, at: T + 25 })], none, present, T + 30).finished,
    ).toEqual([{ sessionId: "session_01A", at: T + 25 }]);
  });

  it("R4 (ruling): a disconnect in between is no sign of a new turn", () => {
    const t = new RemoteTracker();
    t.plan(
      [rs("session_01A", { doneUnread: true, at: T }), rs("session_01N", { doneUnread: true })],
      none,
      none,
      T,
    );
    t.ack("session_01A");
    t.ack("session_01N");
    t.plan([], none, none, T + 10);
    const back = t.plan(
      [rs("session_01A", { doneUnread: true, at: T + 5 }), rs("session_01N", { doneUnread: true })],
      none,
      none,
      T + 20,
    );
    expect(back.finished).toEqual([]);
  });

  it("maps waiting onto the 'input needed' file wait and never a permission", () => {
    const t = new RemoteTracker();
    const b = t.plan([rs("session_01W", { status: "waiting" })], none, none, T);
    expect(b.deltas[0]?.info).toMatchObject({ status: "waiting", waitingFor: "input needed" });
  });
});
