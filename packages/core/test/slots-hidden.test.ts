import { describe, expect, it } from "vitest";
import { ATTENTION_HOLD_MS, SlotTable } from "../src/slots";
import type { SessionView } from "../src/types";
import { view } from "./helpers";

const v = (id: string, over: Parameters<typeof view>[0] = {}) =>
  view({ id, key: { host: "wsl:Ubuntu", sessionId: id }, ...over });
const ask = (id: string, at: number, over: Parameters<typeof view>[0] = {}) =>
  v(id, { state: "needs_permission", episodeSince: at, episodeSeen: false, ...over });
const ids = (t: SlotTable) => Array.from({ length: t.count }, (_, i) => t.idAt(i));

const step = (
  t: SlotTable,
  views: SessionView[],
  now: number,
  allowed?: (i: number) => boolean,
  pins?: readonly string[],
  surface?: boolean,
) => {
  t.sync(views, now, allowed);
  t.promote(views, now, allowed, pins, surface);
};

const secondPage = (i: number) => i >= 2;

describe("SlotTable: sessions that need attention on a hidden index", () => {
  it("swaps with the calmest visible session, which stays in the table", () => {
    const t = new SlotTable(4);
    step(t, [v("a"), v("b"), v("c"), v("d")], 0);
    const views = [ask("a", 1_000), v("b"), v("c"), v("d")];
    step(t, views, 1_000, secondPage);
    expect(ids(t)).toEqual(["d", "b", "c", "a"]);
    expect(t.overflow(views)).toEqual([]);
  });

  it("takes a free visible index first and leaves calm sessions where they are", () => {
    const t = new SlotTable(4);
    step(t, [ask("a", 0), v("b")], 0);
    step(t, [ask("a", 0), v("b"), v("c")], 1_000, (i) => i === 2 || i === 3);
    expect(ids(t)).toEqual([null, "b", "c", "a"]);
  });

  it("does not take a free index reserved for /clear", () => {
    const t = new SlotTable(3);
    step(t, [ask("a", 0), v("old", { cwd: "/p/atlas" }), v("c")], 0);
    t.release("old", { host: "wsl:Ubuntu", cwd: "/p/atlas", pid: null, until: 10_000 });
    step(t, [ask("a", 0), v("c")], 1_000, (i) => i >= 1);
    expect(ids(t)).toEqual(["c", "a", null]);
  });

  it("stays while every visible session needs attention or is held", () => {
    const t = new SlotTable(3);
    step(t, [v("a"), ask("b", 0), ask("c", 0)], 0);
    const seenC = ask("c", 0, { episodeSeen: true });
    const views = [ask("a", 1_000), ask("b", 0), seenC];
    const hiddenA = (i: number) => i !== t.count - 1;
    step(t, views, 1_000, hiddenA);
    expect(ids(t)).toEqual(["b", "c", "a"]);
    const before = ids(t);
    step(t, views, ATTENTION_HOLD_MS - 1, hiddenA);
    expect(ids(t)).toEqual(before);
  });

  it("comes to a visible index once the hold of a calm session has ended", () => {
    const t = new SlotTable(2);
    step(t, [ask("a", 0), ask("b", 0)], 0);
    const seenB = ask("b", 0, { episodeSeen: true });
    const views = [ask("a", 0), seenB];
    step(t, views, 1_000, (i) => i === 1);
    expect(ids(t)).toEqual(["a", "b"]);
    step(t, views, 1_000 + ATTENTION_HOLD_MS, (i) => i === 1);
    expect(ids(t)).toEqual(["b", "a"]);
  });

  it("prefers an unpinned calm session, and takes a pinned one when no other can give way", () => {
    const pinned = (id: string) => v(id, { hostSessionId: `local_${id}` });
    const pins = ["local_d"];
    const t = new SlotTable(4);
    step(t, [v("a"), v("b"), v("c"), pinned("d")], 0, undefined, pins);
    step(t, [ask("a", 1_000), v("b"), v("c"), pinned("d")], 1_000, secondPage, pins);
    expect(ids(t)).toEqual(["c", "b", "a", "d"]);
    const u = new SlotTable(2);
    step(u, [v("a"), pinned("d")], 0, undefined, pins);
    step(u, [ask("a", 1_000), pinned("d")], 1_000, (i) => i === 1, pins);
    expect(ids(u)).toEqual(["d", "a"]);
  });

  it("competes with sessions without a slot in order of urgency", () => {
    const t = new SlotTable(2);
    step(t, [v("a"), v("b")], 0);
    const input = v("late", { state: "needs_input", episodeSince: 1_000, episodeSeen: false });
    step(t, [ask("a", 1_000), v("b"), input], 1_000, (i) => i === 1);
    expect(ids(t)).toEqual(["b", "a"]);
  });

  it("a calm session on a hidden index keeps it, with free visible indexes around", () => {
    const t = new SlotTable(3);
    step(t, [v("a")], 0);
    step(t, [v("a")], 1_000, (i) => i !== 0);
    expect(ids(t)).toEqual(["a", null, null]);
  });

  it("no move while keys are still changing, overflow claimants still take their slot", () => {
    const t = new SlotTable(3);
    step(t, [v("a"), v("b"), v("c")], 0);
    const views = [ask("a", 1_000), v("b"), v("c"), ask("late", 1_000)];
    step(t, views, 1_000, secondPage, [], false);
    expect(ids(t)).toEqual(["a", "b", "late"]);
  });

  it("a session on a visible index never moves", () => {
    const t = new SlotTable(2);
    step(t, [ask("a", 0), v("b")], 0);
    step(t, [ask("a", 0), v("b")], 1_000, () => true);
    expect(ids(t)).toEqual(["a", "b"]);
  });
});
