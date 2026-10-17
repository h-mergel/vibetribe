import type { SessionView } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { frameDemand, Motion, WORKING_TICK_MS } from "../src/deck/motion";
import { view } from "./helpers";

const T0 = 1_000_000;
const waiting = (id: string, since: number): SessionView =>
  view({
    key: { host: "win", sessionId: id },
    state: "needs_permission",
    episodeSince: since,
    episodeSeen: false,
  });
const working = (id: string): SessionView =>
  view({ key: { host: "win", sessionId: id }, state: "working" });
const none = new Set<string>();

describe("frameDemand", () => {
  it("counts breathing keys, calm clocks under one minute and working keys", () => {
    const a = waiting("a", T0);
    const b = waiting("b", T0 - 10_000);
    const old = waiting("old", T0 - 120_000);
    const w = working("w");
    expect(
      frameDemand({ shown: [a, b, old, w], animated: new Set([a.id]), inboxClock: null }, T0),
    ).toEqual({ breathing: 1, secondClocks: 1, working: 1 });
  });

  it("counts the inbox clock as a key of its own, also when its session breathes", () => {
    const a = waiting("a", T0);
    expect(frameDemand({ shown: [a], animated: new Set([a.id]), inboxClock: a }, T0)).toEqual({
      breathing: 1,
      secondClocks: 1,
      working: 0,
    });
    const old = waiting("old", T0 - 120_000);
    expect(frameDemand({ shown: [], animated: none, inboxClock: old }, T0).secondClocks).toBe(0);
  });
});

describe("Motion", () => {
  it("advances the working dot every 2 s while the budget allows", () => {
    const m = new Motion(10);
    const input = { shown: [working("w")], animated: none, inboxClock: null };
    expect(m.frame(T0, input).tick).toBe(0);
    expect(m.frame(T0 + WORKING_TICK_MS - 1, input).tick).toBe(0);
    expect(m.frame(T0 + WORKING_TICK_MS, input).tick).toBe(1);
    expect(m.frame(T0 + 2 * WORKING_TICK_MS, input).tick).toBe(2);
    expect(m.frame(T0 + 3 * WORKING_TICK_MS, input).tick).toBe(0);
  });

  it("holds the dot first when breathing and clocks fill the budget, then steps clocks by 2 s", () => {
    const m = new Motion(10);
    const a = waiting("a", T0);
    const b = waiting("b", T0);
    const c1 = waiting("c1", T0 - 5_000);
    const busy = {
      shown: [a, b, c1, working("w")],
      animated: new Set([a.id, b.id]),
      inboxClock: null,
    };
    m.frame(T0, busy);
    // 2 x 4 breathing + 1 clock = 9 = budget (10 minus 1 for state changes): dots stand still
    expect(m.frame(T0 + 4_000, busy)).toEqual({ tick: 0, clockStepS: 1 });
    const c2 = waiting("c2", T0 - 6_000);
    expect(m.frame(T0 + 4_000, { ...busy, shown: [...busy.shown, c2] }).clockStepS).toBe(2);
    // budget free again: the held dot moves on at once
    expect(
      m.frame(T0 + 5_000, { shown: [working("w")], animated: none, inboxClock: null }).tick,
    ).toBe(1);
  });

  it("restarts the dot timer after a clock jump backwards", () => {
    const m = new Motion(10);
    const input = { shown: [working("w")], animated: none, inboxClock: null };
    m.frame(T0, input);
    expect(m.frame(T0 - 60_000, input).tick).toBe(0);
    expect(m.frame(T0 - 60_000 + WORKING_TICK_MS, input).tick).toBe(1);
  });
});
