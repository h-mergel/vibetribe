import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub";
import { mapRemoteSession, type RemoteSession } from "../src/remote/api";
import { RemoteTracker, TURN_MEMORY_MS } from "../src/remote/tracker";

const T = 1_000_000_000;
const ID = "session_01Ask";
const DAY = 24 * 3_600_000;
const POLL = 20_000;

const asking = (over: Partial<RemoteSession> = {}): RemoteSession => ({
  id: ID,
  title: "Ask",
  status: "waiting",
  doneUnread: false,
  quiet: true,
  at: T - 5_000,
  ...over,
});
const viewOf = (hub: Hub, now: number) =>
  hub.state(now).sessions.find((s) => s.key.sessionId === ID);

/** A hub whose listing shows the waiting session, already looked at on the deck at T + 1 s. */
function lookedAt(session = asking()): Hub {
  const hub = new Hub();
  hub.ingestRemote([session], T);
  const view = viewOf(hub, T);
  if (!view) throw new Error("missing");
  hub.markSeen(view, T + 1_000);
  return hub;
}

describe("a remote session waiting for input, looked at", () => {
  it("is Idle at once, without waiting for the next poll, and tells the listeners", () => {
    const hub = new Hub();
    hub.ingestRemote([asking()], T);
    let notified = 0;
    hub.onChange(() => notified++);
    const view = viewOf(hub, T);
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    expect(viewOf(hub, T + 1_000)).toMatchObject({ state: "idle", episodeSeen: true });
    expect(notified).toBe(1);
  });

  it("stays Idle through later polls of the same turn, for days", () => {
    const hub = lookedAt();
    for (const now of [T + POLL, T + 2 * POLL, T + 3 * DAY]) {
      hub.ingestRemote([asking()], now);
      expect(viewOf(hub, now)?.state).toBe("idle");
    }
  });

  it("gets loud again with a fresh wait timer when a poll shows a new turn waiting", () => {
    const hub = lookedAt();
    hub.ingestRemote([asking({ at: T + POLL - 3_000 })], T + POLL);
    expect(viewOf(hub, T + POLL)).toMatchObject({
      state: "needs_input",
      episodeSeen: false,
      episodeSince: T + POLL - 3_000,
    });
  });

  it("gets loud again after a poll saw it working, however the time field looks", () => {
    const hub = lookedAt();
    hub.ingestRemote([asking({ status: "busy" })], T + POLL);
    expect(viewOf(hub, T + POLL)?.state).toBe("working");
    hub.ingestRemote([asking()], T + 2 * POLL);
    expect(viewOf(hub, T + 2 * POLL)).toMatchObject({
      state: "needs_input",
      episodeSeen: false,
      episodeSince: T - 5_000,
    });
  });

  it("a wait without last_event_at stays calm until a listing shows it no longer waiting", () => {
    const wait = asking({ at: null });
    const hub = lookedAt(wait);
    expect(viewOf(hub, T + 1_000)?.state).toBe("idle");
    hub.ingestRemote([wait], T + POLL);
    expect(viewOf(hub, T + POLL)?.state).toBe("idle");
    hub.ingestRemote([asking({ at: null, status: "busy" })], T + 2 * POLL);
    expect(viewOf(hub, T + 2 * POLL)?.state).toBe("working");
    hub.ingestRemote([wait], T + 3 * POLL);
    expect(viewOf(hub, T + 3 * POLL)).toMatchObject({
      state: "needs_input",
      episodeSeen: false,
      episodeSince: T + 3 * POLL,
    });
  });

  it("can be looked at again after the new turn", () => {
    const hub = lookedAt();
    const next = asking({ at: T + POLL - 3_000 });
    hub.ingestRemote([next], T + POLL);
    const view = viewOf(hub, T + POLL);
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + POLL + 1_000);
    hub.ingestRemote([next], T + 2 * POLL);
    expect(viewOf(hub, T + 2 * POLL)?.state).toBe("idle");
  });

  it("does not calm a turn that only started after the look: a working session stays out of it", () => {
    const hub = new Hub();
    hub.ingestRemote([asking({ status: "busy" })], T);
    const view = viewOf(hub, T);
    if (!view) throw new Error("missing");
    hub.markSeen(view, T + 1_000);
    hub.ingestRemote([asking()], T + POLL);
    expect(viewOf(hub, T + POLL)).toMatchObject({ state: "needs_input", episodeSeen: false });
  });

  it("a failed poll changes nothing: a gap ends in Idle again, also after the no-signal removal", () => {
    const hub = lookedAt();
    expect(viewOf(hub, T + 90_000)?.state).toBe("no_signal");
    hub.ingestRemote([asking()], T + 100_000);
    expect(viewOf(hub, T + 100_000)?.state).toBe("idle");
    hub.tick(T + 310_000);
    expect(viewOf(hub, T + 310_000)).toBeUndefined();
    hub.tick(T + 380_000);
    hub.ingestRemote([asking()], T + 380_000);
    expect(viewOf(hub, T + 380_000)?.state).toBe("idle");
  });

  it("a disconnect flap does not bring the question back", () => {
    const hub = lookedAt();
    hub.ingestRemote([], T + POLL);
    hub.tick(T + POLL + 61_000);
    hub.ingestRemote([asking()], T + POLL + 61_000);
    expect(viewOf(hub, T + POLL + 61_000)?.state).toBe("idle");
  });

  it("is Input again after a restart, until looked at again", () => {
    lookedAt();
    const restarted = new Hub();
    restarted.ingestRemote([asking()], T + POLL);
    expect(viewOf(restarted, T + POLL)).toMatchObject({
      state: "needs_input",
      episodeSeen: false,
      episodeSince: T - 5_000,
    });
  });
});

describe("a remote session blocked while its worker runs", () => {
  const raw = (worker: string | null) => ({
    id: "cse_01Ask",
    connection_status: "connected",
    status_bucket: "blocked",
    worker_status: worker,
    unread: true,
    last_event_at: new Date(T - 5_000).toISOString(),
  });
  const mapped = (worker: string | null): RemoteSession => {
    const s = mapRemoteSession(raw(worker));
    if (!s) throw new Error("not mapped");
    return s;
  };

  it("only a missing or idle worker is quiet", () => {
    expect(mapped("idle")).toMatchObject({ status: "waiting", quiet: true });
    expect(mapped(null)).toMatchObject({ status: "waiting", quiet: true });
    expect(mapped("running")).toMatchObject({ status: "waiting", quiet: false });
  });

  it("stays Input after a look, seen, also through later polls", () => {
    const hub = lookedAt(mapped("running"));
    const seen = { state: "needs_input", episodeSeen: true, episodeSince: T - 5_000 };
    expect(viewOf(hub, T + 1_000)).toMatchObject(seen);
    hub.ingestRemote([mapped("running")], T + POLL);
    expect(viewOf(hub, T + POLL)).toMatchObject(seen);
  });

  it("a calmed wait whose worker starts to run is loud again", () => {
    const hub = lookedAt(mapped("idle"));
    expect(viewOf(hub, T + 1_000)?.state).toBe("idle");
    hub.ingestRemote([mapped("running")], T + POLL);
    expect(viewOf(hub, T + POLL)).toMatchObject({ state: "needs_input", episodeSeen: false });
    hub.ingestRemote([mapped("idle")], T + 2 * POLL);
    expect(viewOf(hub, T + 2 * POLL)).toMatchObject({ state: "needs_input", episodeSeen: false });
  });
});

describe("a remote session waiting for input, not looked at", () => {
  it("stays Input for days with its first wait timer", () => {
    const hub = new Hub();
    for (const now of [T, T + POLL, T + DAY, T + 5 * DAY]) {
      hub.ingestRemote([asking()], now);
      expect(viewOf(hub, now)).toMatchObject({
        state: "needs_input",
        episodeSeen: false,
        episodeSince: T - 5_000,
      });
    }
  });

  it("the rule for a read turn stays: unread false on a quiet worker is Idle without any look", () => {
    const raw = {
      id: "cse_01Ask",
      connection_status: "connected",
      status_bucket: "blocked",
      worker_status: "idle",
      last_event_at: new Date(T).toISOString(),
    };
    expect(mapRemoteSession({ ...raw, unread: false })?.status).toBe("idle");
    expect(mapRemoteSession({ ...raw, unread: true })?.status).toBe("waiting");
    const hub = new Hub();
    hub.ingestRemote([asking()], T);
    hub.ingestRemote([asking({ status: "idle" })], T + POLL);
    expect(viewOf(hub, T + POLL)?.state).toBe("idle");
  });
});

describe("RemoteTracker: what it remembers of a look", () => {
  const none = new Set<string>();

  it("forgets it TURN_MEMORY_MS after the session was last listed", () => {
    const t = new RemoteTracker();
    t.plan([asking()], none, none, T);
    expect(t.ack(ID, T)).toBe(true);
    expect(t.plan([asking()], none, none, T + 1).deltas[0]?.info.status).toBe("idle");
    t.plan([], none, none, T + 2);
    const back = t.plan([asking()], none, none, T + 1 + TURN_MEMORY_MS);
    expect(back.deltas[0]?.info.status).toBe("idle");
    t.plan([], none, none, T + 2 + 2 * TURN_MEMORY_MS);
    const later = t.plan([asking()], none, none, T + 3 + 2 * TURN_MEMORY_MS);
    expect(later.deltas[0]?.info.status).toBe("waiting");
  });

  it("keeps it while the session stays listed, however long", () => {
    const t = new RemoteTracker();
    t.plan([asking()], none, none, T);
    t.ack(ID, T);
    for (const now of [T + DAY - 1, T + 2 * DAY - 2, T + 3 * DAY - 3])
      expect(t.plan([asking()], none, none, now).deltas[0]?.info.status).toBe("idle");
  });

  it("a look at anything but a waiting session records nothing", () => {
    const t = new RemoteTracker();
    t.plan(
      [asking({ status: "busy" }), asking({ id: "session_01D", doneUnread: true })],
      none,
      none,
      T,
    );
    expect(t.ack(ID, T)).toBe(false);
    expect(t.ack("session_01D", T)).toBe(false);
    expect(t.ack("session_01Unknown", T)).toBe(false);
    const running = new RemoteTracker();
    running.plan([asking({ quiet: false })], none, none, T);
    expect(running.ack(ID, T)).toBe(false);
  });
});
