import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub";
import { mapRemoteSession, type RemoteSession } from "../src/remote/api";

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

  it("a bare last_event_at bump on a seen, still unread idle session is no new turn", () => {
    const hub = new Hub();
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T - 5_000 })], T);
    const view = byId(hub, T).session_01A;
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([rs("session_01A", { doneUnread: true, at: T + 15_000 })], T + 20_000);
    expect(byId(hub, T + 20_000).session_01A?.state).toBe("idle");
  });

  it("a new turn after the user saw the last one is raised again once a poll saw it working", () => {
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

  it("after a disconnect flap a seen turn stays seen, an unseen turn comes back unseen", () => {
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

  it("after the no-signal removal a session that is still done + unread is raised again", () => {
    const hub = new Hub();
    const done = rs("session_01A", { doneUnread: true, at: T - 5_000 });
    hub.ingestRemote([done], T);
    hub.tick(T + 210_000);
    expect(hub.drainRemovals()).toMatchObject([{ reason: "no_signal_timeout" }]);
    hub.ingestRemote([done], T + 300_000);
    expect(byId(hub, T + 300_000).session_01A?.state).toBe("done_unseen");
  });
});
