import { describe, expect, it } from "vitest";
import {
  animatedIds,
  BREATH_LEVELS,
  breathLevel,
  breathStep,
  breathStepStart,
  frameWeight,
} from "../src/attention";
import { view } from "./helpers";

const waiting = (id: string, since: number, seen = false) =>
  view({ id, state: "needs_permission", episodeSince: since, episodeSeen: seen });

describe("animatedIds", () => {
  it("breathes during the first 30 s, then only reminder pulses for the oldest", () => {
    const a = waiting("a", 0);
    expect(animatedIds([a], 29_999)).toEqual(new Set(["a"]));
    expect(animatedIds([a], 31_000)).toEqual(new Set());
    // reminder: 30 s + 60 s = 90 s, lasting 3 x 1.2 s
    expect(animatedIds([a], 90_000)).toEqual(new Set(["a"]));
    expect(animatedIds([a], 93_500)).toEqual(new Set(["a"]));
    expect(animatedIds([a], 93_700)).toEqual(new Set());
    expect(animatedIds([a], 150_100)).toEqual(new Set(["a"]));
  });

  it("at most two keys breathe: the newest fresh episodes first", () => {
    const old = waiting("old", 0);
    const mid = waiting("mid", 70_000);
    const n1 = waiting("n1", 85_000);
    const n2 = waiting("n2", 86_000);
    // old is in its reminder pulse (90 s), but two fresh requests take both places
    expect(animatedIds([n2, mid, n1, old], 90_000)).toEqual(new Set(["n2", "n1"]));
  });

  it("a fresh request breathes although two older ones still breathe", () => {
    const a = waiting("a", 0);
    const b = waiting("b", 5_000);
    const c = waiting("c", 10_000);
    expect(animatedIds([a, b, c], 12_000)).toEqual(new Set(["c", "b"]));
  });

  it("the reminder of the oldest takes a place left by fresh episodes", () => {
    const old = waiting("old", 0);
    const fresh = waiting("fresh", 85_000);
    expect(animatedIds([old, fresh], 90_000)).toEqual(new Set(["fresh", "old"]));
  });

  it("an episode far in the future (clock set back) does not breathe; a slight skew does", () => {
    expect(animatedIds([waiting("future", 3_600_000)], 0)).toEqual(new Set());
    expect(animatedIds([waiting("skew", 5_000)], 0)).toEqual(new Set(["skew"]));
  });

  it("orders equal start times by id, so the choice is stable", () => {
    const xs = ["c", "a", "b"].map((id) => waiting(id, 1_000));
    expect(animatedIds(xs, 2_000)).toEqual(new Set(["a", "b"]));
  });

  it("reminds only the oldest episode, not the next-oldest one", () => {
    const old = waiting("old", 0);
    const b = waiting("b", 10_000);
    // 100 s: old is calm (sinceCalm 70 s, off-pulse); b is not oldest, so no reminder
    expect(animatedIds([old, b], 100_000)).toEqual(new Set());
    // 150 s: old pulses (sinceCalm 120 s = 2 x 60 s); b still not oldest
    expect(animatedIds([old, b], 150_000)).toEqual(new Set(["old"]));
    // 160 s: b would pulse (sinceCalm 120 s) if it were treated as oldest; old is off-pulse
    expect(animatedIds([old, b], 160_000)).toEqual(new Set());
  });

  it("hands reminders to the next-oldest episode once the oldest is seen", () => {
    const old = waiting("old", 0, true);
    const b = waiting("b", 10_000);
    expect(animatedIds([old, b], 160_000)).toEqual(new Set(["b"]));
  });

  it("never animates seen episodes or other states (error keeps its static frame)", () => {
    expect(animatedIds([waiting("a", 0, true)], 1_000)).toEqual(new Set());
    expect(
      animatedIds(
        [view({ id: "w", state: "working", episodeSince: 0, episodeSeen: false })],
        1_000,
      ),
    ).toEqual(new Set());
    expect(
      animatedIds([view({ id: "e", state: "error", episodeSince: 0, episodeSeen: false })], 1_000),
    ).toEqual(new Set());
  });

  describe("an unseen done_unseen never breathes (handoff v2, user ruling R11)", () => {
    const done = (id: string, since: number) =>
      view({ id, state: "done_unseen", episodeSince: since, episodeSeen: false });

    it("neither in its first 30 s nor as the reminder pulse of the oldest episode", () => {
      expect(animatedIds([done("d", 0)], 1_000)).toEqual(new Set());
      expect(animatedIds([done("d", 0)], 90_000)).toEqual(new Set());
    });

    it("takes no breathing place from needs_*", () => {
      const a = waiting("a", 0);
      const d = done("d", 5_000);
      const b = waiting("b", 10_000);
      expect(animatedIds([a, d, b], 12_000)).toEqual(new Set(["b", "a"]));
    });

    it("is not the oldest episode for the reminder pulse", () => {
      const old = done("old", 0);
      const a = waiting("a", 10_000);
      expect(animatedIds([old, a], 100_000)).toEqual(new Set(["a"]));
    });
  });
});

describe("breathLevel", () => {
  it("steps through 0.35, 0.675, 1, 0.675 every 300 ms of a 1.2 s period", () => {
    expect([0, 299, 300, 600, 899, 900, 1_200].map((t) => breathLevel(t, 0))).toEqual([
      0.35, 0.35, 0.675, 1, 1, 0.675, 0.35,
    ]);
    expect(BREATH_LEVELS).toEqual([0.35, 0.675, 1, 0.675]);
  });

  it("counts steps from the start of the episode", () => {
    expect(breathStep(10_000, 10_000)).toBe(0);
    expect(breathStep(10_650, 10_000)).toBe(2);
  });

  it("stays on a step for a since in the future", () => {
    expect(BREATH_LEVELS).toContain(breathLevel(0, 500));
  });
});

describe("breathStepStart", () => {
  it("is the start of the current 300 ms step", () => {
    expect(breathStepStart(10_000, 10_000)).toBe(10_000);
    expect(breathStepStart(10_299, 10_000)).toBe(10_000);
    expect(breathStepStart(10_300, 10_000)).toBe(10_300);
    expect(breathStepStart(70_100, 10_000)).toBe(70_000);
    expect(breathStepStart(70_399, 10_000)).toBe(70_300);
  });
});

describe("frameWeight", () => {
  it("thick for unseen alarms, thin once seen, normal otherwise", () => {
    expect(frameWeight(waiting("a", 0))).toBe("thick");
    expect(frameWeight(waiting("a", 0, true))).toBe("thin");
    expect(frameWeight(view({ state: "error", episodeSeen: false, episodeSince: 0 }))).toBe(
      "thick",
    );
    expect(frameWeight(view({ state: "working", episodeSeen: false, episodeSince: 0 }))).toBe(
      "normal",
    );
  });

  it("thick for an unseen done_unseen; calm (normal, no thin) once seen (R9, handoff v2)", () => {
    expect(frameWeight(view({ state: "done_unseen", episodeSeen: false, episodeSince: 0 }))).toBe(
      "thick",
    );
    expect(frameWeight(view({ state: "done_unseen", episodeSeen: true, episodeSince: 0 }))).toBe(
      "normal",
    );
  });
});
