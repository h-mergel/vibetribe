import { describe, expect, it } from "vitest";
import type { RemoteSession } from "../src/remote/api";
import { RemoteTracker, TURN_MEMORY_MS } from "../src/remote/tracker";

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
    t.ack("session_01A", T);
    const present = new Set(["session_01A"]);
    expect(t.plan([done], none, present, T + 1).finished).toEqual([]);
    t.plan([], none, none, T + 2);
    expect(t.plan([done], none, none, T + 2 + TURN_MEMORY_MS + 1).finished).toHaveLength(1);
    t.ack("session_01A", T);
    t.forget("session_01A");
    expect(t.plan([done], none, present, T + 3 + TURN_MEMORY_MS).finished).toHaveLength(1);
  });

  it("a changed last_event_at alone is no new turn, a read in between makes one", () => {
    const t = new RemoteTracker();
    const present = new Set(["session_01A"]);
    t.plan([rs("session_01A", { doneUnread: true, at: T })], none, none, T);
    t.ack("session_01A", T);
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

  it("a disconnect in between is no sign of a new turn", () => {
    const t = new RemoteTracker();
    t.plan(
      [rs("session_01A", { doneUnread: true, at: T }), rs("session_01N", { doneUnread: true })],
      none,
      none,
      T,
    );
    t.ack("session_01A", T);
    t.ack("session_01N", T);
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
