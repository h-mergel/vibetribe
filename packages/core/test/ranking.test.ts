import { describe, expect, it } from "vitest";
import {
  compareSeverity,
  InboxCycler,
  isAlarm,
  isWaitingState,
  needsAttention,
  waitingInOrder,
} from "../src/ranking";
import type { SessionState } from "../src/types";
import { view } from "./helpers";

describe("isAlarm and isWaitingState", () => {
  it("alarms are permission, input and error; waiting adds done_unseen", () => {
    const states: SessionState[] = [
      "needs_permission",
      "needs_input",
      "error",
      "done_unseen",
      "throttled",
      "working",
      "background",
      "idle",
      "no_signal",
    ];
    expect(states.filter(isAlarm)).toEqual(["needs_permission", "needs_input", "error"]);
    expect(states.filter(isWaitingState)).toEqual([
      "needs_permission",
      "needs_input",
      "error",
      "done_unseen",
    ]);
  });
});

describe("needsAttention", () => {
  it("unseen needs_permission, needs_input, error and done_unseen (R9); nothing seen or calm", () => {
    for (const state of ["needs_permission", "needs_input", "error", "done_unseen"] as const) {
      expect(needsAttention(view({ state, episodeSince: 1, episodeSeen: false }))).toBe(true);
      expect(needsAttention(view({ state, episodeSince: 1, episodeSeen: true }))).toBe(false);
    }
    for (const state of ["throttled", "working", "background", "idle", "no_signal"] as const)
      expect(needsAttention(view({ state, episodeSince: 1, episodeSeen: false }))).toBe(false);
  });
});

describe("compareSeverity", () => {
  it("orders by state rank, then by episode age", () => {
    const list = [
      view({ id: "idle", state: "idle" }),
      view({ id: "done", state: "done_unseen", episodeSince: 5, episodeSeen: false }),
      view({ id: "perm-new", state: "needs_permission", episodeSince: 9, episodeSeen: false }),
      view({ id: "perm-old", state: "needs_permission", episodeSince: 1, episodeSeen: false }),
      view({ id: "work", state: "working" }),
    ];
    expect(list.sort(compareSeverity).map((v) => v.id)).toEqual([
      "perm-old",
      "perm-new",
      "done",
      "work",
      "idle",
    ]);
  });
});

describe("InboxCycler", () => {
  const list = waitingInOrder([
    view({ id: "a", state: "needs_permission", episodeSince: 1 }),
    view({ id: "b", state: "done_unseen", episodeSince: 2 }),
  ]);

  it("cycles within 5 s and marks only the landing session as seen", () => {
    const c = new InboxCycler();
    expect(c.press(0, list)).toBe("a");
    expect(c.press(1_000, list)).toBe("b");
    expect(c.settle(5_999)).toBeNull();
    expect(c.settle(6_000)).toBe("b");
    expect(c.settle(7_000)).toBeNull();
  });

  it("restarts at the top after the window", () => {
    const c = new InboxCycler();
    c.press(0, list);
    c.settle(5_000);
    expect(c.press(10_000, list)).toBe("a");
  });

  it("returns null when nothing waits", () => {
    expect(new InboxCycler().press(0, [])).toBeNull();
  });

  it("reports the session of the current press during its 5 s window", () => {
    const c = new InboxCycler();
    expect(c.current(0)).toBeNull();
    c.press(0, list);
    expect(c.current(0)).toBe("a");
    c.press(1_000, list);
    expect(c.current(5_999)).toBe("b");
    expect(c.current(6_000)).toBeNull();
  });

  it("has no current session once the window passed or after a press without waiting sessions", () => {
    const c = new InboxCycler();
    c.press(0, list);
    c.settle(5_000);
    expect(c.current(5_000)).toBeNull();
    c.press(6_000, list);
    c.press(7_000, []);
    expect(c.current(7_000)).toBeNull();
  });
});
