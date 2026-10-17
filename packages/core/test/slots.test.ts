import { describe, expect, it } from "vitest";
import { ATTENTION_HOLD_MS, SlotTable } from "../src/slots";
import { view } from "./helpers";

const v = (id: string, over: Parameters<typeof view>[0] = {}) =>
  view({ id, key: { host: "wsl:Ubuntu", sessionId: id }, ...over });

describe("SlotTable", () => {
  it("assigns stably: a session keeps its slot when others change state", () => {
    const t = new SlotTable(3);
    t.sync([v("a"), v("b")], 0);
    expect([t.idAt(0), t.idAt(1), t.idAt(2)]).toEqual(["a", "b", null]);
    t.sync([v("a"), v("b", { state: "needs_permission", episodeSince: 1 })], 1);
    expect([t.idAt(0), t.idAt(1)]).toEqual(["a", "b"]);
  });

  it("frees slots of gone sessions and fills the first free one", () => {
    const t = new SlotTable(3);
    t.sync([v("a"), v("b"), v("c")], 0);
    t.sync([v("a"), v("c"), v("d")], 1);
    expect([t.idAt(0), t.idAt(1), t.idAt(2)]).toEqual(["a", "d", "c"]);
  });

  it("overflow holds the rest; the most severe overflow session moves up first", () => {
    const t = new SlotTable(1);
    const views = [v("a"), v("b"), v("c", { state: "needs_input", episodeSince: 5 })];
    t.sync([views[0]], 0);
    t.sync(views, 1);
    expect(t.overflow(views).map((x) => x.id)).toEqual(["c", "b"]);
    t.sync([views[1], views[2]], 2);
    expect(t.idAt(0)).toBe("c");
  });

  it("reserves a slot for /clear and gives it to the next session with same host and cwd", () => {
    const t = new SlotTable(2);
    t.sync([v("old", { cwd: "/p/atlas", pid: 7 }), v("x", { cwd: "/p/other" })], 0);
    t.release("old", { host: "wsl:Ubuntu", cwd: "/p/atlas", pid: 7, until: 10_000 });
    t.sync([v("x", { cwd: "/p/other" }), v("stranger", { cwd: "/p/else" })], 1);
    expect(t.idAt(0)).toBeNull();
    expect(t.overflow([v("stranger", { cwd: "/p/else" })]).map((x) => x.id)).toEqual(["stranger"]);
    t.sync([v("x", { cwd: "/p/other" }), v("new", { cwd: "/p/atlas", pid: 7 })], 2);
    expect(t.idAt(0)).toBe("new");
  });

  it("expired reservations become free slots", () => {
    const t = new SlotTable(1);
    t.sync([v("old", { cwd: "/p/atlas" })], 0);
    t.release("old", { host: "wsl:Ubuntu", cwd: "/p/atlas", pid: null, until: 10_000 });
    t.sync([v("other", { cwd: "/p/else" })], 10_000);
    expect(t.idAt(0)).toBe("other");
  });

  it("resize keeps assignments in remaining slots and overflows the rest", () => {
    const t = new SlotTable(3);
    const views = [v("a"), v("b"), v("c")];
    t.sync(views, 0);
    t.resize(2);
    t.sync(views, 1);
    expect([t.idAt(0), t.idAt(1)]).toEqual(["a", "b"]);
    expect(t.overflow(views).map((x) => x.id)).toEqual(["c"]);
    t.resize(4);
    t.sync(views, 2);
    expect(t.idAt(2)).toBe("c");
    expect(t.count).toBe(4);
  });

  it("assigns only into allowed indexes; existing sessions keep theirs, even on disallowed ones", () => {
    const t = new SlotTable(4);
    t.sync([v("a")], 0);
    const allowed = (i: number) => i === 2 || i === 3;
    t.sync([v("a"), v("b"), v("c"), v("d")], 1, allowed);
    expect([t.idAt(0), t.idAt(1), t.idAt(2), t.idAt(3)]).toEqual(["a", null, "b", "c"]);
    expect(t.overflow([v("d")]).map((x) => x.id)).toEqual(["d"]);
  });

  it("does not hand a reservation on a disallowed index to its successor", () => {
    const t = new SlotTable(2);
    const a = v("a");
    t.sync([a], 0);
    t.release(a.id, { host: a.key.host, cwd: a.cwd, pid: null, until: 10_000 });
    t.sync([v("a2", { cwd: a.cwd })], 1, (i) => i === 1);
    expect([t.idAt(0), t.idAt(1)]).toEqual([null, "a2"]);
  });
});

describe("SlotTable promotion (Plan 7)", () => {
  const ask = (id: string, at: number, over: Parameters<typeof view>[0] = {}) =>
    v(id, { state: "needs_permission", episodeSince: at, episodeSeen: false, ...over });
  const input = (id: string, at: number) =>
    v(id, { state: "needs_input", episodeSince: at, episodeSeen: false });
  const ids = (t: SlotTable) => Array.from({ length: t.count }, (_, i) => t.idAt(i));
  /** what the deck does on update and tick: fill free slots, then promote */
  const step = (
    t: SlotTable,
    views: ReturnType<typeof v>[],
    now: number,
    allowed?: (i: number) => boolean,
  ) => {
    t.sync(views, now, allowed);
    t.promote(views, now, allowed);
  };

  it("a session that needs attention takes the slot of the calmest session", () => {
    const t = new SlotTable(3);
    const calm = [v("a", { state: "working" }), v("b"), v("c")];
    step(t, calm, 0);
    const views = [...calm, ask("r", 1_000)];
    step(t, views, 1_000);
    // idle is calmer than working; of the two idle sessions the later slot goes first
    expect(ids(t)).toEqual(["a", "b", "r"]);
    expect(t.overflow(views).map((x) => x.id)).toEqual(["c"]);
  });

  it("sync alone only fills free slots; promote displaces", () => {
    const t = new SlotTable(1);
    t.sync([v("a")], 0);
    t.sync([v("a"), ask("r", 1)], 1);
    expect(t.idAt(0)).toBe("a");
    t.promote([v("a"), ask("r", 1)], 1);
    expect(t.idAt(0)).toBe("r");
  });

  it("never displaces a session that needs attention; calm sessions without a slot never displace", () => {
    const t = new SlotTable(2);
    step(t, [ask("a", 0), ask("b", 0)], 0);
    step(t, [ask("a", 0), ask("b", 0), ask("c", 10), v("idle")], 60_000);
    expect(ids(t)).toEqual(["a", "b"]);
    const u = new SlotTable(1);
    step(u, [v("a")], 0);
    step(u, [v("a"), v("late", { state: "working" })], 60_000);
    expect(ids(u)).toEqual(["a"]);
  });

  it("an unseen done_unseen claims a slot like an alarm (R9); seen waiting sessions are calm", () => {
    const t = new SlotTable(2);
    step(t, [v("a"), v("b")], 0);
    const done = v("d", { state: "done_unseen", episodeSince: 5, episodeSeen: false });
    const seen = v("s", { state: "needs_input", episodeSince: 5, episodeSeen: true });
    step(t, [v("a"), v("b"), done, seen], 1_000);
    expect(ids(t)).toEqual(["a", "d"]);
    // done now needs attention itself: an error takes the remaining calm slot, never done's
    const err = v("e", { state: "error", episodeSince: 6, episodeSeen: false });
    step(t, [v("a"), v("b"), done, seen, err], 2_000);
    expect(ids(t)).toEqual(["e", "d"]);
  });

  it("a seen done keeps its slot for the 30 s hold, then gives way", () => {
    const t = new SlotTable(1);
    step(t, [v("a")], 0);
    step(t, [v("a"), v("d", { state: "done_unseen", episodeSince: 1, episodeSeen: false })], 1_000);
    expect(t.idAt(0)).toBe("d");
    // seen: the session falls back to its rest state (idle)
    const r = ask("r", 2_000);
    step(t, [v("a"), v("d"), r], 2_000);
    expect(t.idAt(0)).toBe("d");
    step(t, [v("a"), v("d"), r], 1_000 + ATTENTION_HOLD_MS);
    expect(t.idAt(0)).toBe("r");
  });

  it("a session keeps its slot for 30 s after it stopped needing attention", () => {
    const t = new SlotTable(1);
    step(t, [ask("a", 0)], 0);
    const seenA = ask("a", 0, { episodeSeen: true });
    step(t, [seenA, ask("b", 1_000)], 1_000);
    expect(t.idAt(0)).toBe("a");
    step(t, [seenA, ask("b", 1_000)], ATTENTION_HOLD_MS - 1);
    expect(t.idAt(0)).toBe("a");
    step(t, [seenA, ask("b", 1_000)], ATTENTION_HOLD_MS);
    expect(t.idAt(0)).toBe("b");
  });

  it("a promoted session seen at once keeps its slot against the next claimant for 30 s", () => {
    const t = new SlotTable(1);
    step(t, [v("a")], 0);
    step(t, [v("a"), ask("r", 1_000)], 1_000);
    expect(t.idAt(0)).toBe("r");
    const seenR = ask("r", 1_000, { episodeSeen: true });
    step(t, [v("a"), seenR, ask("s", 2_000)], 2_000);
    expect(t.idAt(0)).toBe("r");
    step(t, [v("a"), seenR, ask("s", 2_000)], 31_000);
    expect(t.idAt(0)).toBe("s");
  });

  it("two waiting sessions do not flap one slot", () => {
    const t = new SlotTable(1);
    step(t, [ask("a", 0), ask("b", 0)], 0);
    expect(t.idAt(0)).toBe("a");
    // a is seen at 5 s; b waited all along: it gets the slot 30 s after a last needed attention (0)
    const seenA = ask("a", 0, { episodeSeen: true });
    step(t, [seenA, ask("b", 0)], 5_000);
    step(t, [seenA, ask("b", 0)], 29_999);
    expect(t.idAt(0)).toBe("a");
    step(t, [seenA, ask("b", 0)], 30_000);
    expect(t.idAt(0)).toBe("b");
    // a asks again at once: b is protected while it needs attention and for 30 s after
    const seenB = ask("b", 0, { episodeSeen: true });
    step(t, [ask("a", 36_000), ask("b", 0)], 36_000);
    step(t, [ask("a", 36_000), seenB], 40_000);
    step(t, [ask("a", 36_000), seenB], 65_999);
    expect(t.idAt(0)).toBe("b");
    step(t, [ask("a", 36_000), seenB], 66_000);
    expect(t.idAt(0)).toBe("a");
  });

  it("prefers the session calm longest over a calmer state", () => {
    const t = new SlotTable(2);
    step(t, [ask("x", 0), v("y", { state: "working" })], 0);
    const x = ask("x", 0, { state: "idle", episodeSeen: true });
    step(t, [x, v("y", { state: "working" })], 40_000);
    step(t, [x, v("y", { state: "working" }), ask("r", 50_000)], 50_000);
    expect(ids(t)).toEqual(["x", "r"]);
  });

  it("attention while waiting without a slot counts: such a session is not the first to give way", () => {
    const t = new SlotTable(2);
    step(t, [ask("p", 0), ask("q", 0)], 0);
    const seenP = ask("p", 0, { episodeSeen: true });
    // w waits as "+N": p is held (seen 1 s ago), q needs attention
    step(t, [seenP, ask("q", 0), ask("w", 1_000)], 1_000);
    expect(ids(t)).toEqual(["p", "q"]);
    // q ends; w gets the free slot and is seen in the same step
    const seenW = ask("w", 1_000, { episodeSeen: true });
    step(t, [seenP, seenW], 2_000);
    expect(ids(t)).toEqual(["p", "w"]);
    // p was calm since 0, w since 1 s: p gives way
    step(t, [seenP, seenW, ask("r", 40_000)], 40_000);
    expect(ids(t)).toEqual(["r", "w"]);
  });

  it("never takes a disallowed (hidden) index, even when the tie-break would pick it", () => {
    const t = new SlotTable(3);
    // assignment follows the id order: a, b, hidden -> the hidden session sits on the last index
    step(t, [v("a"), v("b"), v("hidden")], 0);
    expect(ids(t)).toEqual(["a", "b", "hidden"]);
    const allowed = (i: number) => i !== 2;
    step(t, [v("a"), v("b"), v("hidden"), input("q", 1), ask("p", 2)], 1_000, allowed);
    // the most severe claimant (permission before input) gets the later allowed slot
    expect(ids(t)).toEqual(["q", "p", "hidden"]);
  });

  it("a hold in the future (clock set back) does not protect", () => {
    const t = new SlotTable(1);
    step(t, [ask("a", 0)], 100_000);
    const seenA = ask("a", 0, { episodeSeen: true });
    step(t, [seenA, ask("b", 1)], 1_000);
    expect(t.idAt(0)).toBe("b");
  });
});

describe("SlotTable with sessions pinned in Claude Desktop", () => {
  const pin = (id: string, over: Parameters<typeof view>[0] = {}) =>
    v(id, { hostSessionId: `local_${id}`, ...over });
  const ask = (id: string, at: number, over: Parameters<typeof view>[0] = {}) =>
    v(id, { state: "needs_permission", episodeSince: at, episodeSeen: false, ...over });
  const ids = (t: SlotTable) => Array.from({ length: t.count }, (_, i) => t.idAt(i));
  /** what the deck does on update and tick, with Desktop's pins */
  const step = (
    t: SlotTable,
    views: ReturnType<typeof v>[],
    now: number,
    pins: string[],
    allowed?: (i: number) => boolean,
  ) => {
    t.sync(views, now, allowed);
    t.promote(views, now, allowed, pins);
  };

  it("an alarm takes the slot of an unpinned calm session before the one of a calmer pinned session", () => {
    const calm = [pin("p"), v("u", { state: "working" })];
    const pinned = new SlotTable(2);
    step(pinned, calm, 0, ["local_p"]);
    expect(ids(pinned)).toEqual(["u", "p"]);
    step(pinned, [...calm, ask("r", 1_000)], 1_000, ["local_p"]);
    expect(ids(pinned)).toEqual(["r", "p"]);
    // without pins the idle session gives way: it is the calmer one
    const plain = new SlotTable(2);
    step(plain, calm, 0, []);
    step(plain, [...calm, ask("r", 1_000)], 1_000, []);
    expect(ids(plain)).toEqual(["u", "r"]);
  });

  it("an alarm takes the slot of a pinned session only when no unpinned one can give way", () => {
    const t = new SlotTable(2);
    step(t, [pin("p"), ask("a", 0)], 0, ["local_p"]);
    expect(ids(t)).toEqual(["a", "p"]);
    step(t, [pin("p"), ask("a", 0), ask("r", 1_000)], 1_000, ["local_p"]);
    expect(ids(t)).toEqual(["a", "r"]);
  });

  it("a resting pinned session without a slot takes the slot of a resting unpinned one", () => {
    const t = new SlotTable(1);
    step(t, [v("u")], 0, ["local_p"]);
    const views = [v("u"), pin("p")];
    step(t, views, 1_000, ["local_p"]);
    expect(t.idAt(0)).toBe("p");
    expect(t.overflow(views).map((x) => x.id)).toEqual(["u"]);
  });

  it.each(["working", "throttled", "background", "needs_input"] as const)(
    "a resting pinned session never takes the slot of a %s unpinned one",
    (state) => {
      const t = new SlotTable(1);
      const u = v("u", { state, episodeSince: 0, episodeSeen: true });
      step(t, [u], 0, ["local_p"]);
      step(t, [u, pin("p")], 60_000, ["local_p"]);
      expect(t.idAt(0)).toBe("u");
    },
  );

  it("a running pinned session takes the slot of a running unpinned one", () => {
    const t = new SlotTable(1);
    step(t, [v("u", { state: "working" })], 0, ["local_p"]);
    step(t, [v("u", { state: "working" }), pin("p", { state: "working" })], 1_000, ["local_p"]);
    expect(t.idAt(0)).toBe("p");
  });

  it("calm sessions without a pin never displace a pinned one, running or not", () => {
    const t = new SlotTable(1);
    step(t, [pin("p")], 0, ["local_p"]);
    step(t, [pin("p"), v("w", { state: "working" }), v("i")], 1_000, ["local_p"]);
    expect(t.idAt(0)).toBe("p");
  });

  it("pinned sessions never displace each other; running ones claim first, then the sidebar order", () => {
    const running = new SlotTable(1);
    step(running, [v("u")], 0, []);
    const views = [v("u"), pin("a"), pin("b"), pin("w", { state: "working" })];
    step(running, views, 1_000, ["local_b", "local_a", "local_w"]);
    expect(running.idAt(0)).toBe("w");
    const t = new SlotTable(1);
    step(t, [v("u")], 0, []);
    step(t, [v("u"), pin("a"), pin("b")], 1_000, ["local_b", "local_a"]);
    expect(t.idAt(0)).toBe("b");
    // a new sidebar order moves nobody
    step(t, [v("u"), pin("a"), pin("b")], 2_000, ["local_a", "local_b"]);
    expect(t.idAt(0)).toBe("b");
  });

  it("a running pinned claimant takes a running slot first and leaves the resting one to a resting pinned claimant", () => {
    const t = new SlotTable(2);
    const calm = [v("u1"), v("u2", { state: "working" })];
    step(t, calm, 0, []);
    expect(ids(t)).toEqual(["u2", "u1"]);
    const pins = ["local_p1", "local_p2"];
    step(t, [...calm, pin("p1", { state: "working" }), pin("p2")], 1_000, pins);
    expect(ids(t)).toEqual(["p1", "p2"]);
  });

  it("a session that needed attention less than 30 s ago keeps its slot against a pinned one", () => {
    const t = new SlotTable(1);
    step(t, [ask("u", 0)], 0, ["local_p"]);
    const seenU = ask("u", 0, { state: "idle", episodeSeen: true });
    step(t, [seenU, pin("p")], 1_000, ["local_p"]);
    expect(t.idAt(0)).toBe("u");
    step(t, [seenU, pin("p")], ATTENTION_HOLD_MS - 1, ["local_p"]);
    expect(t.idAt(0)).toBe("u");
    step(t, [seenU, pin("p")], ATTENTION_HOLD_MS, ["local_p"]);
    expect(t.idAt(0)).toBe("p");
  });

  it("a pinned session takes only visible slots", () => {
    const t = new SlotTable(2);
    step(t, [v("a"), v("hidden")], 0, []);
    expect(ids(t)).toEqual(["a", "hidden"]);
    step(t, [v("a"), v("hidden"), pin("p")], 1_000, ["local_p"], (i) => i !== 1);
    expect(ids(t)).toEqual(["p", "hidden"]);
  });

  it("pins that name no live session change nothing", () => {
    const t = new SlotTable(1);
    step(t, [v("u")], 0, ["local_x"]);
    step(t, [v("u"), v("w")], 1_000, ["local_x"]);
    expect(t.idAt(0)).toBe("u");
  });
});
