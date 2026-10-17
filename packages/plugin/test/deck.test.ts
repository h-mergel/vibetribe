import type { Removal } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { Deck } from "../src/deck/deck";
import { contentSignature } from "../src/deck/frame";
import { defaultMk2Layout, type KeyPlacement } from "../src/deck/keys";
import type { DeckCommand } from "../src/deck/press";
import {
  deckHarness,
  hubState,
  session,
  slot,
  svgFromDataUrl,
  T0,
  type view,
  waiting,
} from "./helpers";

const deck = (max = 10, keys = defaultMk2Layout(), log?: (line: string) => void) =>
  deckHarness({ max, keys, log });
const layoutKey = (id: string): KeyPlacement => {
  const k = defaultMk2Layout().find((p) => p.id === id);
  if (!k) throw new Error(`no such key ${id}`);
  return k;
};
const removal = (v: ReturnType<typeof view>, reason: Removal["reason"]): Removal => ({
  id: v.id,
  key: v.key,
  reason,
  cwd: v.cwd,
  pid: v.pid,
});

describe("Deck rendering and budget", () => {
  it("fills slot keys by severity, sends at most 10 images per second and nothing twice", () => {
    const { d, sends, svgOf } = deck();
    const a = session("alpha", { state: "working" });
    const b = session("beta", { state: "throttled", errorType: "rate_limit" });
    d.update(hubState({ sessions: [a, b] }), [], T0);
    expect(d.tick(T0)).toEqual([]);
    expect(sends).toHaveLength(10);
    expect(d.pendingCount).toBe(5);
    d.tick(T0 + 250);
    expect(sends).toHaveLength(10);
    d.tick(T0 + 1_000);
    expect(sends).toHaveLength(15);
    expect(d.pendingCount).toBe(0);
    // throttled outranks working: beta takes slot 1
    expect(svgOf(slot(1))).toContain("beta");
    expect(svgOf(slot(1))).toContain(">Limited<");
    expect(svgOf(slot(2))).toContain("alpha");
    expect(svgOf(slot(3))).not.toContain("<text");
    expect(svgOf("mk2:0:0")).toContain('id="vt-count"');
    expect(svgOf("mk2:0:4")).toContain("Sources ok");
    // same state again before the working dot moves (every 2 s): nothing is sent twice
    d.update(hubState({ sessions: [a, b] }), [], T0 + 1_500);
    d.tick(T0 + 1_500);
    expect(sends).toHaveLength(15);
  });

  it("breathes on the two newest episodes; calm keys only follow the clock", () => {
    // slot keys only: no other clock competes for the one clock frame per second
    const { d, sentTo } = deck(
      10,
      defaultMk2Layout().filter((k) => k.role === "slot"),
    );
    const sessions = [waiting("one", T0 - 2_000), waiting("two", T0 - 1_000), waiting("three", T0)];
    d.update(hubState({ sessions }), [], T0);
    // let the first full render through the budget: 10 at T0, the rest plus clocks at +1 s
    d.tick(T0);
    d.tick(T0 + 1_000);
    d.tick(T0 + 2_000);
    const base = [1, 2, 3].map((n) => sentTo(slot(n)));
    for (const dt of [2_250, 2_500, 2_750, 3_000]) d.tick(T0 + dt);
    const delta = [1, 2, 3].map((n, i) => sentTo(slot(n)) - (base[i] ?? 0));
    // slots follow severity (oldest first): "one" is calm, its clock changes once (at +3 s)
    expect(delta[0]).toBe(1);
    // "two" and "three" breathe: a new step every 300 ms, so 3 or 4 of the 4 ticks carry a frame
    expect(delta[1]).toBeGreaterThanOrEqual(3);
    expect(delta[2]).toBeGreaterThanOrEqual(3);
  });

  it("with a tight budget, state frames beat breathing and breathing beats clocks", () => {
    const keys = defaultMk2Layout().filter((k) => k.id === slot(1) || k.id === slot(2));
    const { d, sends } = deck(1, keys);
    const breathing = waiting("b", T0);
    // an unseen Done: a clock, never breathing (handoff v2)
    const clocked = session("c", {
      state: "done_unseen",
      episodeSince: T0 - 5_000,
      episodeSeen: false,
    });
    d.update(hubState({ sessions: [breathing, clocked] }), [], T0);
    d.tick(T0);
    expect(sends.map((s) => s.id)).toEqual([slot(1)]);
    // slot 2 still waits for its first (state) frame; slot 1 only wants a breathing frame
    d.tick(T0 + 1_000);
    expect(sends.map((s) => s.id)).toEqual([slot(1), slot(2)]);
    // now both want a new frame: breathing (slot 1) outranks the clock (slot 2)
    d.tick(T0 + 2_000);
    expect(sends.map((s) => s.id)).toEqual([slot(1), slot(2), slot(1)]);
  });

  it("records only images the surface accepted: a rejected key stays blank in the mirror", () => {
    const { d, sentTo, rejectKey } = deck(100);
    rejectKey(slot(2));
    d.update(hubState({ sessions: [session("a"), session("b")] }), [], T0);
    d.tick(T0);
    expect(sentTo(slot(2))).toBe(1);
    const m = d.mirror(T0);
    expect(m.keys.find((k) => k.id === slot(1))).toMatchObject({ sentAt: T0 });
    expect(m.keys.find((k) => k.id === slot(2))).toMatchObject({ image: null, sentAt: null });
    expect(m.sentLastSecond).toBe(14);
  });
});

describe("Deck keys appearing and vanishing (spec §6.3 stable slots)", () => {
  it("a key that appears again without disappearing gets its image resent", () => {
    const { d, sends, sentTo } = deck(100);
    d.update(hubState({ sessions: [session("a")] }), [], T0);
    d.tick(T0);
    sends.length = 0;
    d.keyAppeared(layoutKey(slot(1)), T0 + 500);
    d.tick(T0 + 500);
    expect(sentTo(slot(1))).toBe(1);
    expect(sends.filter((s) => s.id !== slot(1))).toHaveLength(0);
  });

  it("all keys vanish and return: same sessions on the same keys, images resent", () => {
    const { d, sends, svgOf } = deck(100);
    const sessions = [session("a"), session("b"), session("c")];
    d.update(hubState({ sessions }), [], T0);
    d.tick(T0);
    const before = [1, 2, 3].map((n) => svgOf(slot(n)));
    for (const k of defaultMk2Layout()) d.keyDisappeared(k.id, T0 + 500);
    expect(d.mirror(T0).keys).toHaveLength(0);
    sends.length = 0;
    d.update(hubState({ sessions }), [], T0 + 1_000);
    for (const k of defaultMk2Layout()) d.keyAppeared(k, T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(sends).toHaveLength(15);
    expect([1, 2, 3].map((n) => svgOf(slot(n)))).toEqual(before);
  });

  it("a middle slot key vanishes: the other keys keep their sessions, the orphaned one overflows", () => {
    const { d, svgOf } = deck(100);
    const sessions = [session("a"), session("b"), session("c")];
    d.update(hubState({ sessions }), [], T0);
    d.tick(T0);
    d.keyDisappeared(slot(2), T0 + 500);
    // b starts waiting while its key is hidden
    const later = [session("a"), waiting("b", T0 + 1_000), session("c")];
    d.update(hubState({ sessions: later }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf(slot(1))).toContain(">a<");
    expect(svgOf(slot(3))).toContain(">c<");
    // b keeps slot 2 although no key shows it; the inbox counts it as "+1" (it needs attention)
    expect(svgOf("mk2:0:0")).toContain("+1");
    d.keyAppeared(layoutKey(slot(2)), T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(svgOf(slot(2))).toContain(">b<");
    expect(svgOf("mk2:0:0")).not.toContain("+1");
  });
});

describe("Deck slots on removals", () => {
  it("releases before syncing: a /clear reservation beats a more urgent newcomer (mutation-sensitive)", () => {
    const { d, svgOf } = deck(100);
    const a = session("a");
    const b = session("b");
    d.update(hubState({ sessions: [a, b] }), [], T0);
    const successor = session("a2", { cwd: a.cwd });
    // "working" outranks the idle successor: with sync before release it would take slot 1
    const other = session("c", { state: "working" });
    d.update(hubState({ sessions: [b, other, successor] }), [removal(a, "clear")], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf(slot(1))).toContain("a2");
    expect(svgOf(slot(2))).toContain(">b<");
    expect(svgOf(slot(3))).toContain(">c<");
    d.update(hubState({ sessions: [other, successor] }), [removal(b, "end")], T0 + 2_000);
    const late = session("late");
    d.update(hubState({ sessions: [other, successor, late] }), [], T0 + 3_000);
    d.tick(T0 + 3_000);
    expect(svgOf(slot(2))).toContain("late");
  });

  it("overflow: calm surplus sessions do not count on the inbox; removals of unslotted sessions are harmless", () => {
    const { d, svgOf } = deck(100);
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session(`s${String(i).padStart(2, "0")}`, i < 2 ? { state: "working" } : {}),
    );
    d.update(hubState({ sessions }), [], T0);
    d.tick(T0);
    expect(svgOf("mk2:0:0")).not.toContain("+");
    // the two working sessions outrank the idle ones and sit in slots 1 and 2
    expect(svgOf(slot(1))).toContain("s00");
    expect(svgOf(slot(2))).toContain("s01");
    const overflowed = sessions[11];
    if (!overflowed) throw new Error("fixture");
    expect(() =>
      d.update(hubState({ sessions: sessions.slice(0, 11) }), [removal(overflowed, "end")], T0 + 1),
    ).not.toThrow();
    d.tick(T0 + 1_000);
    expect(svgOf("mk2:0:0")).not.toContain("+");
  });

  it("drops a /clear reservation after 10 s", () => {
    const { d, svgOf } = deck(100);
    const a = session("a");
    d.update(hubState({ sessions: [a] }), [], T0);
    d.update(hubState({ sessions: [] }), [removal(a, "resume")], T0 + 1_000);
    d.update(hubState({ sessions: [session("x")] }), [], T0 + 12_000);
    d.tick(T0 + 12_000);
    expect(svgOf(slot(1))).toContain(">x<");
  });
});

describe("Deck press seam", () => {
  const needs = { ...waiting("p", T0 - 1_000), hostSessionId: "local_p" };
  const done = session("d", {
    state: "done_unseen",
    episodeSince: T0 - 500,
    episodeSeen: false,
    hostSessionId: "local_d",
  });
  const done2 = session("d2", {
    state: "done_unseen",
    episodeSince: T0 - 400,
    episodeSeen: false,
  });
  const idle = session("i");
  const types = (cmds: DeckCommand[]) =>
    cmds.map((c) => ("session" in c ? `${c.type}:${c.session.key.sessionId}` : c.type));

  function pressable() {
    const { d } = deck(100);
    d.update(hubState({ sessions: [needs, done, done2, idle] }), [], T0);
    // a slot press acts on what its key showed: let the keys accept their images first
    d.tick(T0);
    return d;
  }

  it("slot: short press asks for a jump, long press for seen, empty slot does nothing", () => {
    const d = pressable();
    expect(types(d.press(slot(1), "short", T0))).toEqual(["jump:p"]);
    expect(types(d.press(slot(1), "long", T0))).toEqual(["seen:p"]);
    expect(d.press(slot(9), "short", T0)).toEqual([]);
    expect(d.press("unknown", "short", T0)).toEqual([]);
  });

  it("inbox: short presses cycle through waiting sessions within 5 s; the landing is reported on settle", () => {
    const d = pressable();
    expect(types(d.press("mk2:0:0", "short", T0))).toEqual(["jump:p"]);
    expect(types(d.press("mk2:0:0", "short", T0 + 1_000))).toEqual(["jump:d"]);
    expect(types(d.tick(T0 + 5_999))).toEqual([]);
    expect(types(d.tick(T0 + 6_000))).toEqual(["landed:d"]);
    expect(types(d.tick(T0 + 6_250))).toEqual([]);
    expect(types(d.press("mk2:0:0", "short", T0 + 20_000))).toEqual(["jump:p"]);
    // settle happens before the next press as well; long press acknowledges every done_unseen
    expect(types(d.press("mk2:0:0", "long", T0 + 30_000))).toEqual([
      "landed:p",
      "seen:d",
      "seen:d2",
    ]);
  });

  it("limit, extra and status keys", () => {
    const d = pressable();
    expect(types(d.press("mk2:0:1", "short", T0))).toEqual(["refresh_usage"]);
    expect(types(d.press("mk2:0:2", "short", T0))).toEqual(["refresh_usage"]);
    expect(types(d.press("mk2:0:3", "long", T0))).toEqual([]);
    expect(types(d.press("mk2:0:4", "short", T0))).toEqual([]);
    expect(types(d.press("mk2:0:4", "long", T0))).toEqual(["open_debug"]);
  });
});

describe("Deck mirror", () => {
  it("lists every key with role, slot number, last image and the budget figures", () => {
    const { d } = deck();
    d.update(hubState({ sessions: [session("m")] }), [], T0);
    d.tick(T0);
    const m = d.mirror(T0 + 100);
    expect(m.keys).toHaveLength(15);
    expect(m.sentLastSecond).toBe(10);
    expect(m.pending).toBe(5);
    const first = m.keys.find((k) => k.id === slot(1));
    expect(first).toMatchObject({ role: "slot", slot: 0, row: 1, column: 0, sentAt: T0 });
    expect(svgFromDataUrl(first?.image ?? "")).toContain(">m<");
    expect(m.keys.find((k) => k.id === "mk2:0:0")).toMatchObject({ role: "inbox", slot: null });
    expect(d.mirror(T0 + 1_000).sentLastSecond).toBe(0);
  });
});

describe("Deck with monotonic slot indexes (visible-only assignment)", () => {
  const without = (id: string) => defaultMk2Layout().filter((k) => k.id !== id);

  it("a key added later in an earlier position does not move live sessions", () => {
    const { d, svgOf } = deck(100, without(slot(1)));
    const sessions = [session("a"), session("b")];
    d.update(hubState({ sessions }), [], T0);
    d.tick(T0);
    expect(svgOf(slot(2))).toContain(">a<");
    expect(svgOf(slot(3))).toContain(">b<");
    d.keyAppeared(layoutKey(slot(1)), T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf(slot(2))).toContain(">a<");
    expect(svgOf(slot(3))).toContain(">b<");
    expect(svgOf(slot(1))).not.toContain("<text");
    // a newcomer takes the lowest free index (slot(1) got the last index when it appeared late)
    d.update(hubState({ sessions: [...sessions, session("c")] }), [], T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(svgOf(slot(4))).toContain(">c<");
  });

  it("a deleted key never receives a new session while a visible key is free", () => {
    const { d, svgOf } = deck(100);
    d.keyDisappeared(slot(1), T0 - 1);
    d.update(hubState({ sessions: [session("a"), session("b")] }), [], T0);
    d.tick(T0);
    expect(svgOf(slot(2))).toContain(">a<");
    expect(svgOf(slot(3))).toContain(">b<");
    expect(svgOf("mk2:0:0")).not.toContain("+");
  });

  it("a session on an invisible index is overflow while hidden and back on its key afterwards", () => {
    const { d, svgOf } = deck(100);
    const a = waiting("a", T0);
    d.update(hubState({ sessions: [a] }), [], T0);
    for (const k of defaultMk2Layout().filter((p) => p.role === "slot"))
      d.keyDisappeared(k.id, T0 + 500);
    // both wait: a on its hidden index, late without any (no visible slot to take)
    const late = waiting("late", T0 + 1_000);
    d.update(hubState({ sessions: [a, late] }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf("mk2:0:0")).toContain("+2");
    for (const k of defaultMk2Layout().filter((p) => p.role === "slot"))
      d.keyAppeared(k, T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(svgOf(slot(1))).toContain(">a<");
    expect(svgOf(slot(2))).toContain("late");
    expect(svgOf("mk2:0:0")).not.toContain("+");
  });

  it("ignores a key with an invalid placement", () => {
    const { d, sends } = deck(100, []);
    d.update(hubState({ sessions: [session("a")] }), [], T0);
    d.keyAppeared({ id: "x", role: "slot", device: "mk2", row: 1.5, column: 0 }, T0);
    d.tick(T0);
    expect(sends).toHaveLength(0);
    expect(d.mirror(T0).keys).toHaveLength(0);
  });
});

describe("Deck frame budget headroom", () => {
  const tenWaiting = () => Array.from({ length: 10 }, (_, i) => waiting(`s${i}`, T0 + i * 10));

  it("keeps breathing on at least 90 % of the breath steps with ten waiting sessions (20 s)", () => {
    const { d, sends } = deck();
    d.update(hubState({ sessions: tenWaiting() }), [], T0);
    for (let t = T0; t <= T0 + 20_000; t += 250) d.tick(t);
    const perKey = new Map<string, number>();
    for (const s of sends) perKey.set(s.id, (perKey.get(s.id) ?? 0) + 1);
    const counts = [...perKey.entries()]
      .filter(([id]) => id.startsWith("mk2:1") || id.startsWith("mk2:2"))
      .map(([, n]) => n)
      .sort((a, b) => b - a);
    expect(counts[0]).toBeGreaterThanOrEqual(60);
    expect(counts[1]).toBeGreaterThanOrEqual(60);
    // and no extra clock-only frames on top of the breath steps
    expect(counts[0]).toBeLessThanOrEqual(67);
    expect(counts[1]).toBeLessThanOrEqual(67);
    // the clocks of the eight calm keys get the remainder, not nothing
    const rest = counts.slice(2).reduce((a, b) => a + b, 0);
    expect(rest).toBeGreaterThanOrEqual(10);
    console.info(`MEASURED breathing=${counts.slice(0, 2)} others=${rest} all=${sends.length}`);
  });

  it("never fills the whole second with breathing and clocks: a state frame always fits", () => {
    const { d, sends } = deck();
    d.update(hubState({ sessions: tenWaiting() }), [], T0);
    for (let t = T0; t <= T0 + 8_000; t += 250) {
      d.tick(t);
      if (t >= T0 + 3_000) expect(d.mirror(t).sentLastSecond).toBeLessThanOrEqual(9);
    }
    // one session stops waiting: its state frame must go out in this very tick
    const before = sends.length;
    const calmer = [...tenWaiting().slice(0, 9), session("s9")];
    d.update(hubState({ sessions: calmer }), [], T0 + 8_000);
    d.tick(T0 + 8_000);
    expect(sends.length).toBeGreaterThan(before);
  });

  it("with a tight budget the breathing key beats the clock key although the clock key is first in line", () => {
    const keys = [layoutKey(slot(2)), layoutKey(slot(1))];
    const { d, sends, svgOf } = deck(1, keys);
    // an unseen Done: a clock, never breathing (handoff v2)
    const clocked = session("c", {
      state: "done_unseen",
      episodeSince: T0 - 5_000,
      episodeSeen: false,
    });
    // slot(2) was seen first, so it holds the more severe (breathing) session; slot(1) iterates first
    d.update(hubState({ sessions: [clocked, waiting("b", T0 + 10)] }), [], T0);
    for (const t of [T0, T0 + 1_000]) d.tick(t);
    expect(svgOf(slot(2))).toContain(">b<");
    for (const t of [T0 + 2_000, T0 + 3_000]) {
      d.tick(t);
      expect(sends.at(-1)?.id).toBe(slot(2));
    }
  });
});

describe("Deck keys: hide time, reflow and immediate redraw", () => {
  const slotKeys = () => defaultMk2Layout().filter((p) => p.role === "slot");
  const abc = () => [session("a"), session("b"), session("c")];

  it("a deleted key session reflows onto a visible free key after more than 60 s", () => {
    const { d, svgOf } = deck(100);
    d.update(hubState({ sessions: abc() }), [], T0);
    d.tick(T0);
    // b keeps slot 2 and starts waiting: "+1" while its key is hidden
    const bWaits = [session("a"), waiting("b", T0 + 500), session("c")];
    d.update(hubState({ sessions: bWaits }), [], T0 + 500);
    d.keyDisappeared(slot(2), T0 + 1_000);
    d.tick(T0 + 61_000);
    expect(svgOf("mk2:0:0")).toContain("+1");
    expect(svgOf(slot(4))).not.toContain(">b<");
    d.tick(T0 + 61_001);
    expect(svgOf(slot(4))).toContain(">b<");
    expect(svgOf("mk2:0:0")).not.toContain("+1");
  });

  it("a page switch of 30 s keeps every slot", () => {
    const { d, svgOf } = deck(100);
    d.update(hubState({ sessions: abc() }), [], T0);
    d.tick(T0);
    for (const k of slotKeys()) d.keyDisappeared(k.id, T0 + 1_000);
    d.tick(T0 + 31_000);
    for (const k of slotKeys()) d.keyAppeared(k, T0 + 31_000);
    d.tick(T0 + 31_000);
    expect(svgOf(slot(1))).toContain(">a<");
    expect(svgOf(slot(2))).toContain(">b<");
    expect(svgOf(slot(3))).toContain(">c<");
  });

  it("prunes ghost indexes: a key returning after a long absence takes the released index", () => {
    const { d } = deck(100);
    d.update(hubState({ sessions: [] }), [], T0);
    d.keyDisappeared(slot(1), T0 + 1_000);
    d.tick(T0 + 40_000);
    d.keyAppeared(layoutKey(slot(1)), T0 + 40_000);
    expect(d.mirror(T0 + 40_000).keys.find((k) => k.id === slot(1))?.slot).toBe(0);
    d.keyDisappeared(slot(1), T0 + 41_000);
    d.tick(T0 + 102_000);
    d.keyAppeared(layoutKey(slot(1)), T0 + 102_000);
    // released after 60 s hidden and taken again: the numbering does not grow with page switches
    const slots = d.mirror(T0 + 102_000).keys.flatMap((k) => (k.slot === null ? [] : [k.slot]));
    expect(slots.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("ticking applies reservation expiry: an overflow session moves up without a hub update", () => {
    const { d, svgOf } = deck(100);
    const w = Array.from({ length: 10 }, (_, i) => session(`w${i}`, { state: "working" }));
    const z = session("z");
    d.update(hubState({ sessions: [...w, z] }), [], T0);
    const first = w[0];
    if (!first) throw new Error("fixture");
    d.update(hubState({ sessions: [...w.slice(1), z] }), [removal(first, "clear")], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf(slot(1))).not.toContain(">z<");
    expect(svgOf("mk2:0:0")).not.toContain("+");
    d.tick(T0 + 11_001);
    expect(svgOf(slot(1))).toContain(">z<");
    expect(svgOf("mk2:0:0")).not.toContain("+");
  });

  it("keyDisappeared drops the pending frame of the key", () => {
    const { d, sentTo } = deck(100);
    d.update(hubState({ sessions: abc() }), [], T0);
    d.keyDisappeared(slot(3), T0);
    d.tick(T0);
    expect(sentTo(slot(3))).toBe(0);
  });

  it("keyDisappeared updates the inbox overflow at state priority", () => {
    const keys = defaultMk2Layout().filter((k) => ["mk2:0:0", slot(1), slot(2)].includes(k.id));
    const { d, sends } = deck(1, keys);
    const err = session("b", { state: "error", episodeSince: T0, episodeSeen: false });
    d.update(hubState({ sessions: [waiting("w", T0), err] }), [], T0);
    for (const t of [T0, T0 + 1_000, T0 + 2_000]) d.tick(t);
    expect(sends).toHaveLength(3);
    d.keyDisappeared(slot(2), T0 + 2_900);
    d.tick(T0 + 3_000);
    expect(sends).toHaveLength(4);
    expect(sends.at(-1)?.id).toBe("mk2:0:0");
  });

  it("keyAppeared clears the mirror image and redraws at state priority", () => {
    const keys = [layoutKey(slot(1)), layoutKey(slot(2))];
    const { d, sends } = deck(1, keys);
    // an unseen Done: a clock, never breathing (handoff v2)
    const clocked = session("c", {
      state: "done_unseen",
      episodeSince: T0 - 5_000,
      episodeSeen: false,
    });
    d.update(hubState({ sessions: [clocked, session("i")] }), [], T0);
    d.tick(T0);
    d.tick(T0 + 1_000);
    expect(sends.map((s) => s.id)).toEqual([slot(1), slot(2)]);
    // slot(1) now has a pending clock frame and iterates first; the re-appearing slot(2) must go first
    d.keyAppeared(layoutKey(slot(2)), T0 + 2_000);
    expect(d.mirror(T0 + 2_000).keys.find((k) => k.id === slot(2))).toMatchObject({
      image: null,
      sentAt: null,
    });
    d.tick(T0 + 2_000);
    expect(sends.at(-1)?.id).toBe(slot(2));
  });

  it("a key that was hidden briefly and came back is not released later", () => {
    const { d, svgOf } = deck(100);
    const [a, b, c] = abc();
    if (!a || !b || !c) throw new Error("fixture");
    d.update(hubState({ sessions: [a, b, c] }), [], T0);
    d.update(hubState({ sessions: [b, c] }), [removal(a, "end")], T0 + 500);
    d.keyDisappeared(slot(2), T0 + 1_000);
    d.keyAppeared(layoutKey(slot(2)), T0 + 2_000);
    d.tick(T0 + 100_000);
    expect(svgOf(slot(2))).toContain(">b<");
    expect(svgOf(slot(1))).not.toContain("<text");
  });
});

describe("Deck clock and defaults", () => {
  it("keeps sending after the clock jumped 60 s backwards", () => {
    const { d, sends } = deck();
    d.update(hubState({ sessions: [session("a")] }), [], T0 + 100_000);
    d.tick(T0 + 100_000);
    expect(sends).toHaveLength(10);
    d.tick(T0 + 40_000);
    expect(sends).toHaveLength(15);
    expect(d.mirror(T0 + 40_000).sentLastSecond).toBe(5);
  });

  it("defaults to 10 images per second", () => {
    const sends: string[] = [];
    const d = new Deck({
      send: (id) => {
        sends.push(id);
        return true;
      },
    });
    for (const k of defaultMk2Layout()) d.keyAppeared(k, T0);
    d.update(hubState({ sessions: [session("a")] }), [], T0);
    d.tick(T0);
    expect(sends).toHaveLength(10);
  });

  it("passes the time zone to the tiles", () => {
    const five = {
      id: "five_hour" as const,
      usedPct: 62,
      resetsAt: null,
      pacePct: null,
      aheadOfPlan: false,
      level: "neutral" as const,
      stale: true,
      receivedAt: Date.UTC(2026, 9, 13, 12, 34),
      rolledOver: false,
    };
    const state = hubState({
      limits: { fiveHour: five, sevenDay: null, extra: null, auth: "ok" },
    });
    const text = (timeZone: string) => {
      const sent = new Map<string, string>();
      const d = new Deck({
        timeZone,
        send: (id, image) => {
          sent.set(id, image);
          return true;
        },
      });
      for (const k of defaultMk2Layout()) d.keyAppeared(k, T0);
      d.update(state, [], T0);
      d.tick(T0);
      return svgFromDataUrl(sent.get("mk2:0:1") ?? "") ?? "";
    };
    expect(text("Asia/Tokyo")).toContain("21:34");
    expect(text("UTC")).toContain("12:34");
  });
});

describe("Deck reservations and press edge cases", () => {
  function successorSlot(reason: "clear" | "resume", arrivesAfter: number) {
    const { d, svgOf } = deck(100);
    const a = session("a");
    const b = session("b");
    d.update(hubState({ sessions: [a, b] }), [], T0);
    d.update(hubState({ sessions: [b] }), [removal(a, reason)], T0 + 1_000);
    const urgent = session("c", { state: "working" });
    const successor = session("a2", { cwd: a.cwd });
    const at = T0 + 1_000 + arrivesAfter;
    d.update(hubState({ sessions: [b, urgent, successor] }), [], at);
    d.tick(at);
    return svgOf(slot(1));
  }

  it.each(["clear", "resume"] as const)("a %s reservation lasts 10 s", (reason) => {
    expect(successorSlot(reason, 9_900)).toContain("a2");
    expect(successorSlot(reason, 10_100)).toContain(">c<");
  });

  it("extra key: short press opens the usage settings page (Plan 7), long does nothing", () => {
    const { d } = deck();
    d.update(hubState(), [], T0);
    expect(d.press("mk2:0:3", "short", T0)).toEqual([{ type: "open_usage" }]);
    expect(d.press("mk2:0:3", "long", T0)).toEqual([]);
  });

  it("pressing before the first hub update does nothing", () => {
    const { d } = deck();
    for (const id of [slot(1), "mk2:0:0", "mk2:0:1", "mk2:0:3", "mk2:0:4"])
      expect(d.press(id, "short", T0)).toEqual([]);
  });
});

describe("Deck on the real refresh path (update every second plus tick every 250 ms)", () => {
  const tenWaiting = () => Array.from({ length: 10 }, (_, i) => waiting(`s${i}`, T0 + i * 10));

  function run(n: number, seconds: number) {
    const { d, sends } = deck();
    const sessions = Array.from({ length: n }, (_, i) => waiting(`s${i}`, T0 + i * 10));
    for (let t = T0; t <= T0 + seconds * 1_000; t += 250) {
      // compose.refresh(): every second the whole state is pushed again (wait clocks tick)
      if ((t - T0) % 1_000 === 0) d.update(hubState({ sessions, now: t }), [], t);
      d.tick(t);
    }
    const perKey = new Map<string, number>();
    for (const s of sends) perKey.set(s.id, (perKey.get(s.id) ?? 0) + 1);
    return [...perKey.entries()]
      .filter(([id]) => id.startsWith("mk2:1") || id.startsWith("mk2:2"))
      .map(([, c]) => c)
      .sort((a, b) => b - a);
  }

  // 4 breath steps per 1.2 s, sampled every 250 ms: at most 10/3 frames per second (66 in 20 s);
  // >= 60 means at least 90 % of the breath steps reach the key
  it.each([5, 8, 10])("%i waiting sessions: both breathing keys keep >= 60 frames in 20 s", (n) => {
    const counts = run(n, 20);
    console.info(
      `MEASURED n=${n} breathing frames per 20 s: ${counts.slice(0, 2)} (fps ${counts.slice(0, 2).map((c) => c / 20)})`,
    );
    expect(counts[0]).toBeGreaterThanOrEqual(60);
    expect(counts[1]).toBeGreaterThanOrEqual(60);
  });

  it("a real content change still goes out at state priority while clocks are backlogged", () => {
    const { d, sends } = deck();
    d.update(hubState({ sessions: tenWaiting() }), [], T0);
    for (let t = T0; t <= T0 + 8_000; t += 250) {
      if ((t - T0) % 1_000 === 0) d.update(hubState({ sessions: tenWaiting(), now: t }), [], t);
      d.tick(t);
    }
    const before = sends.length;
    const calmer = [...tenWaiting().slice(0, 9), session("s9")];
    d.update(hubState({ sessions: calmer, now: T0 + 8_000 }), [], T0 + 8_000);
    d.tick(T0 + 8_000);
    expect(sends.length).toBeGreaterThan(before);
  });
});

describe("Deck survives a tile that cannot be rendered", () => {
  it("logs once per key and keeps drawing the other keys", () => {
    const lines: string[] = [];
    const { d, sends, sentTo } = deck(100, defaultMk2Layout(), (l) => lines.push(l));
    const broken = session("bad", { title: 5 as never });
    const fine = session("ok", { state: "working" });
    d.update(hubState({ sessions: [broken, fine] }), [], T0);
    d.update(hubState({ sessions: [broken, fine] }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(lines).toHaveLength(1);
    // the working session outranks the broken one: it sits on slot 1, the broken one on slot 2
    expect(lines[0]).toContain(slot(2));
    expect(sentTo(slot(2))).toBe(0);
    expect(sentTo(slot(1))).toBe(1);
    expect(sends.length).toBe(14);
  });
});

describe("contentSignature", () => {
  const slotTile = {
    kind: "slot",
    title: "a",
    state: "idle",
    badge: "APP",
    wait: 4,
    detail: null,
    bgCount: 0,
    bgStale: false,
    frame: "normal",
    level: 0.5,
  } as const;
  const limitTile = {
    kind: "limit",
    label: "5h",
    usedPct: 10,
    pacePct: null,
    resetIn: "4h 59m",
    level: "neutral",
    ahead: false,
    stale: false,
    note: "As of 12:00",
  } as const;
  const extraTile = {
    kind: "extra",
    used: "1 €",
    limit: null,
    ratio: null,
    level: "neutral",
    stale: false,
    note: "As of 12:00",
  } as const;

  it("ignores exactly the time-derived fields", () => {
    expect(contentSignature({ ...slotTile, wait: 5 })).toBe(contentSignature(slotTile));
    expect(contentSignature({ ...slotTile, level: 1 })).toBe(contentSignature(slotTile));
    expect(contentSignature({ ...limitTile, resetIn: "4h 58m" })).toBe(contentSignature(limitTile));
    expect(contentSignature({ ...limitTile, note: null })).toBe(contentSignature(limitTile));
    expect(contentSignature({ ...extraTile, note: null })).toBe(contentSignature(extraTile));
  });

  it("reports every other change", () => {
    expect(contentSignature({ ...slotTile, state: "working" })).not.toBe(
      contentSignature(slotTile),
    );
    expect(contentSignature({ ...slotTile, title: "b" })).not.toBe(contentSignature(slotTile));
    expect(contentSignature({ ...limitTile, usedPct: 11 })).not.toBe(contentSignature(limitTile));
    expect(contentSignature({ ...limitTile, stale: true })).not.toBe(contentSignature(limitTile));
    expect(contentSignature({ ...extraTile, used: "2 €" })).not.toBe(contentSignature(extraTile));
    expect(contentSignature({ kind: "empty" })).toBe(contentSignature({ kind: "empty" }));
  });
});

describe("Deck slot promotion (Plan 7)", () => {
  const types = (cmds: DeckCommand[]) =>
    cmds.map((c) => ("session" in c ? `${c.type}:${c.session.key.sessionId}` : c.type));

  it("a press acts on the session the key showed, also when a promotion swapped the slot after the last frame", () => {
    const { d } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
    const calm = session("calm", { hostSessionId: "local_calm" });
    d.update(hubState({ sessions: [calm] }), [], T0);
    // the key has not accepted an image yet: it showed nothing, so a press does nothing
    expect(d.press(slot(1), "short", T0)).toEqual([]);
    d.tick(T0);
    const rem = { ...waiting("rem", T0 + 1_000), hostSessionId: "local_rem" };
    d.update(hubState({ sessions: [calm, rem] }), [], T0 + 1_000);
    // rem took the slot in update; its image waits for the next flush
    expect(types(d.press(slot(1), "short", T0 + 1_050))).toEqual(["jump:calm"]);
    expect(types(d.press(slot(1), "long", T0 + 1_100))).toEqual(["seen:calm"]);
    d.tick(T0 + 1_250);
    expect(types(d.press(slot(1), "long", T0 + 1_300))).toEqual(["seen:rem"]);
  });

  it("a /clear successor that looks identical is what the key shows: a press reaches it", () => {
    const { d, sends } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
    const proj = { title: "proj", cwd: "/home/h/proj" };
    const a = session("a", { ...proj, hostSessionId: "local_a" });
    d.update(hubState({ sessions: [a] }), [], T0);
    d.tick(T0);
    const frames = sends.length;
    const successor = session("a2", { ...proj, hostSessionId: "local_a2" });
    d.update(hubState({ sessions: [successor] }), [removal(a, "clear")], T0 + 1_000);
    d.tick(T0 + 1_000);
    // same title, state and badge: byte-identical tile, so no new frame is sent
    expect(sends.length).toBe(frames);
    expect(types(d.press(slot(1), "short", T0 + 1_100))).toEqual(["jump:a2"]);
  });

  it("a refused frame is sent again, so the key does not stay without a session", () => {
    const { d, rejectKey } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
    rejectKey(slot(1));
    d.update(hubState({ sessions: [session("a")] }), [], T0);
    d.tick(T0);
    // nothing reached the key: it showed nothing, a press does nothing
    expect(d.press(slot(1), "short", T0 + 100)).toEqual([]);
    rejectKey("none");
    d.tick(T0 + 250);
    expect(types(d.press(slot(1), "long", T0 + 300))).toEqual(["seen:a"]);
  });

  it("a key the surface keeps refusing is resent with a growing delay, not every tick", () => {
    const { d, sentTo, rejectKey } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
    rejectKey(slot(1));
    d.update(hubState({ sessions: [session("a")] }), [], T0);
    for (let t = 0; t <= 20_000; t += 250) d.tick(T0 + t);
    // 0, 250, 750, 1750, 3750, 7750, 15750 ms: 250 ms doubling up to the 8 s cap
    expect(sentTo(slot(1))).toBe(7);
  });

  it("an accepted frame resets the delay of a key that was refused before", () => {
    const { d, sentTo, rejectKey } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
    rejectKey(slot(1));
    d.update(hubState({ sessions: [session("a")] }), [], T0);
    // refused at 0, 250, 750, 1750: the next retry is 2 s later
    for (let t = 0; t <= 1_750; t += 250) d.tick(T0 + t);
    expect(sentTo(slot(1))).toBe(4);
    rejectKey("none");
    for (let t = 2_000; t <= 3_750; t += 250) d.tick(T0 + t);
    expect(sentTo(slot(1))).toBe(5);
    // a new state frame, refused again: the retry comes after 250 ms again, not after 4 s
    rejectKey(slot(1));
    d.update(hubState({ sessions: [session("a", { state: "working" })] }), [], T0 + 4_000);
    d.tick(T0 + 4_000);
    expect(sentTo(slot(1))).toBe(6);
    d.tick(T0 + 4_250);
    expect(sentTo(slot(1))).toBe(7);
  });

  it("a change during a refusal backoff still goes out as a state frame once the backoff ends", () => {
    const { d, svgOf, sentTo, rejectKey } = deck(1, [layoutKey(slot(1)), layoutKey(slot(2))]);
    const ticking = session("err", { state: "error", episodeSince: T0, episodeSeen: false });
    d.update(hubState({ sessions: [ticking, session("calm")] }), [], T0);
    // one frame per second: slot 1 (the error, first by severity) takes it
    d.tick(T0);
    // slot 2's first frame is refused: its backoff runs until T0 + 1_250
    rejectKey(slot(2));
    d.tick(T0 + 1_000);
    rejectKey("none");
    const limited = session("calm", { state: "throttled", errorType: "rate_limit" });
    d.update(hubState({ sessions: [ticking, limited] }), [], T0 + 1_100);
    const before = sentTo(slot(2));
    d.tick(T0 + 2_000);
    // the new state beats slot 1's pending clock frame
    expect(sentTo(slot(2))).toBe(before + 1);
    expect(svgOf(slot(2))).toContain(">Limited<");
  });

  it("a refused state frame is resent as a state frame once the backoff ends", () => {
    const { d, svgOf, sentTo, rejectKey } = deck(1, [layoutKey(slot(1)), layoutKey(slot(2))]);
    const ticking = session("err", { state: "error", episodeSince: T0, episodeSeen: false });
    const limited = session("calm", { state: "throttled", errorType: "rate_limit" });
    d.update(hubState({ sessions: [ticking, session("calm")] }), [], T0);
    d.tick(T0);
    // the new state of slot 2 is refused: its backoff runs until T0 + 1_250
    d.update(hubState({ sessions: [ticking, limited] }), [], T0 + 500);
    rejectKey(slot(2));
    d.tick(T0 + 1_000);
    rejectKey("none");
    const before = sentTo(slot(2));
    d.tick(T0 + 2_000);
    // slot 1's pending clock frame must not win against the retried state
    expect(sentTo(slot(2))).toBe(before + 1);
    expect(svgOf(slot(2))).toContain(">Limited<");
  });

  it("a slot that changes its session drops the jump flash of the old one", () => {
    const { d, svgOf } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
    const calm = session("calm", { hostSessionId: "local_calm" });
    d.update(hubState({ sessions: [calm] }), [], T0);
    d.tick(T0);
    d.press(slot(1), "short", T0 + 100);
    d.tick(T0 + 250);
    expect(svgOf(slot(1))).toContain(">Open…<");
    d.update(hubState({ sessions: [calm, waiting("rem", T0 + 300)] }), [], T0 + 300);
    d.tick(T0 + 500);
    expect(svgOf(slot(1))).toContain(">rem<");
    expect(svgOf(slot(1))).not.toContain("Open…");
  });

  it("keys reappearing one by one after a page switch do not promote; the next tick takes the calmest slot", () => {
    const keys = [layoutKey("mk2:0:0"), layoutKey(slot(1)), layoutKey(slot(2))];
    const { d, svgOf } = deck(100, keys);
    const watched = session("watched", { state: "working" });
    const idle = session("idle");
    d.update(hubState({ sessions: [watched, idle] }), [], T0);
    d.tick(T0);
    expect(svgOf(slot(1))).toContain(">watched<");
    d.keyDisappeared(slot(1), T0 + 500);
    d.keyDisappeared(slot(2), T0 + 500);
    d.update(hubState({ sessions: [watched, idle, waiting("c", T0 + 1_000)] }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf("mk2:0:0")).toContain("+1");
    d.keyAppeared(layoutKey(slot(1)), T0 + 2_000);
    d.keyAppeared(layoutKey(slot(2)), T0 + 2_000);
    d.tick(T0 + 2_000);
    // idle is calmer than working: the idle slot gives way, not the first key to reappear
    expect(svgOf(slot(1))).toContain(">watched<");
    expect(svgOf(slot(2))).toContain(">c<");
    expect(svgOf("mk2:0:0")).not.toContain("+");
  });

  it("a waiting session takes a visible slot, never the hidden one, even when the tie-break would pick it", () => {
    const keys = [layoutKey("mk2:0:0"), layoutKey(slot(1)), layoutKey(slot(2)), layoutKey(slot(3))];
    const { d, svgOf } = deck(100, keys);
    const abc = [session("a"), session("b"), session("c")];
    d.update(hubState({ sessions: abc }), [], T0);
    d.tick(T0);
    // c sits on the last index: with equal calm the later slot would go first
    d.keyDisappeared(slot(3), T0 + 500);
    d.update(hubState({ sessions: [...abc, waiting("w", T0 + 1_000)] }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf(slot(1))).toContain(">a<");
    expect(svgOf(slot(2))).toContain(">w<");
    d.keyAppeared(layoutKey(slot(3)), T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(svgOf(slot(3))).toContain(">c<");
  });

  describe("Done counts as attention (user decision 2026-10-14, R9; never breathes, R11)", () => {
    const done = (id: string, since: number) =>
      session(id, { state: "done_unseen", episodeSince: since, episodeSeen: false });

    it("an unseen Done stands still: full-opacity frame, no breath frames", () => {
      const { d, svgOf, sentTo } = deck(100, [layoutKey(slot(1))]);
      // finished 1 s ago: a breathing key would send a frame every 300 ms; the clock stays at 1 s
      d.update(hubState({ sessions: [done("fin", T0 - 1_000)] }), [], T0);
      for (const t of [T0, T0 + 300, T0 + 600, T0 + 900]) d.tick(t);
      expect(sentTo(slot(1))).toBe(1);
      expect(svgOf(slot(1))).toMatch(/id="vt-frame"[^>]*stroke="#30D6A4"[^>]*stroke-opacity="1"/);
    });

    it("an unseen Done takes the slot of a calm session and shows a thick frame", () => {
      const { d, svgOf } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
      const calm = session("calm", { state: "working" });
      d.update(hubState({ sessions: [calm] }), [], T0);
      d.tick(T0);
      expect(svgOf(slot(1))).toContain(">calm<");
      d.update(hubState({ sessions: [calm, done("fin", T0 + 1_000)] }), [], T0 + 1_000);
      d.tick(T0 + 1_000);
      expect(svgOf(slot(1))).toContain(">fin<");
      expect(svgOf(slot(1))).toMatch(/id="vt-frame"[^>]*stroke="#30D6A4"[^>]*stroke-width="6"/);
      expect(svgOf("mk2:0:0")).not.toContain("+");
    });

    it("after 30 s an unseen Done still holds its slot and thick frame; a new alarm does not displace it", () => {
      const { d, svgOf } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
      const fin = done("fin", T0);
      d.update(hubState({ sessions: [fin] }), [], T0);
      for (let t = T0; t <= T0 + 40_000; t += 1_000) d.tick(t);
      expect(svgOf(slot(1))).toContain(">fin<");
      expect(svgOf(slot(1))).toMatch(/id="vt-frame"[^>]*stroke="#30D6A4"[^>]*stroke-opacity="1"/);
      // no 30 s window like breathing had: Done needs attention until it is seen
      d.update(hubState({ sessions: [fin, waiting("w", T0 + 40_000)] }), [], T0 + 40_000);
      d.tick(T0 + 40_000);
      expect(svgOf(slot(1))).toContain(">fin<");
      expect(svgOf("mk2:0:0")).toContain("+1");
    });

    it("an unseen Done without a slot counts as +N until it is seen", () => {
      const { d, svgOf } = deck(100, [layoutKey("mk2:0:0"), layoutKey(slot(1))]);
      const w = waiting("w", T0);
      d.update(hubState({ sessions: [w, done("fin", T0 + 1_000)] }), [], T0 + 1_000);
      d.tick(T0 + 1_000);
      expect(svgOf(slot(1))).toContain(">w<");
      expect(svgOf("mk2:0:0")).toContain("+1");
      d.update(hubState({ sessions: [w, session("fin")] }), [], T0 + 2_000);
      d.tick(T0 + 2_000);
      expect(svgOf("mk2:0:0")).not.toContain("+");
    });
  });
});
