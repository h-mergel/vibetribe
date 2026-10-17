import { describe, expect, it } from "vitest";
import { FRAME_PRIORITY, FrameScheduler, planFrames } from "../src/scheduler";

function setup(max = 10) {
  const sent: string[] = [];
  const s = new FrameScheduler((ctx, img) => sent.push(`${ctx}=${img}`), max);
  return { s, sent };
}

describe("FrameScheduler", () => {
  it("never sends more than the budget per rolling second", () => {
    const { s, sent } = setup(10);
    for (let i = 0; i < 15; i++) s.submit(`k${i}`, "img", FRAME_PRIORITY.working);
    expect(s.flush(0)).toBe(10);
    expect(s.flush(500)).toBe(0);
    expect(s.flush(1_000)).toBe(5);
    expect(sent).toHaveLength(15);
  });

  it("sends state changes before breathing, clocks and working frames", () => {
    const { s, sent } = setup(2);
    s.submit("work", "w", FRAME_PRIORITY.working);
    s.submit("clock", "c", FRAME_PRIORITY.clock);
    s.submit("state", "s", FRAME_PRIORITY.state);
    s.flush(0);
    expect(sent).toEqual(["state=s", "clock=c"]);
  });

  it("skips images identical to the last sent one", () => {
    const { s, sent } = setup();
    s.submit("k", "a", FRAME_PRIORITY.state);
    s.flush(0);
    s.submit("k", "a", FRAME_PRIORITY.state);
    expect(s.pendingCount).toBe(0);
    expect(s.flush(2_000)).toBe(0);
    expect(sent).toEqual(["k=a"]);
  });

  it("latest image per key wins and keeps the higher priority", () => {
    const { s, sent } = setup(1);
    s.submit("other", "o", FRAME_PRIORITY.clock);
    s.submit("k", "1", FRAME_PRIORITY.state);
    s.submit("k", "2", FRAME_PRIORITY.working);
    s.flush(0);
    expect(sent).toEqual(["k=2"]);
  });

  it("forget makes the next identical image send again (key reappeared)", () => {
    const { s, sent } = setup();
    s.submit("k", "a", FRAME_PRIORITY.state);
    s.flush(0);
    s.forget("k");
    s.submit("k", "a", FRAME_PRIORITY.state);
    s.flush(2_000);
    expect(sent).toEqual(["k=a", "k=a"]);
  });

  it("keeps a frame pending when send throws, so it is retried", () => {
    const sent: string[] = [];
    let failing = true;
    const s = new FrameScheduler((ctx, img) => {
      if (failing) throw new Error("socket closed");
      sent.push(`${ctx}=${img}`);
    });
    s.submit("k", "a", FRAME_PRIORITY.state);
    expect(() => s.flush(0)).toThrow("socket closed");
    expect(s.pendingCount).toBe(1);
    s.submit("k", "a", FRAME_PRIORITY.state);
    expect(s.pendingCount).toBe(1);
    failing = false;
    expect(s.flush(10)).toBe(1);
    expect(sent).toEqual(["k=a"]);
  });

  it("a low-priority frame whose send threw does not use up the low budget", () => {
    const sent: string[] = [];
    let failing = true;
    const s = new FrameScheduler((ctx, img) => {
      if (failing) throw new Error("socket closed");
      sent.push(`${ctx}=${img}`);
    }, 10);
    s.setReserve(9); // one clock or working frame per second
    s.submit("k", "a", FRAME_PRIORITY.clock);
    expect(() => s.flush(0)).toThrow("socket closed");
    failing = false;
    expect(s.flush(100)).toBe(1);
    expect(sent).toEqual(["k=a"]);
  });

  it("keeps headroom for state and breathing: clock and working frames cannot use the reserve", () => {
    const { s, sent } = setup(10);
    s.setReserve(4);
    for (let i = 0; i < 20; i++) s.submit(`c${i}`, "img", FRAME_PRIORITY.clock);
    expect(s.flush(0)).toBe(6);
    s.submit("b", "x", FRAME_PRIORITY.breathe);
    s.submit("s", "y", FRAME_PRIORITY.state);
    s.submit("w", "z", FRAME_PRIORITY.working);
    expect(s.flush(10)).toBe(2);
    expect(sent.slice(-2)).toEqual(["s=y", "b=x"]);
    // later windows: the clock backlog drains only at max - reserve per second
    expect(s.flush(1_000)).toBe(6);
  });

  it("without a reserve all priorities share the whole budget (default)", () => {
    const { s } = setup(10);
    for (let i = 0; i < 20; i++) s.submit(`c${i}`, "img", FRAME_PRIORITY.clock);
    expect(s.flush(0)).toBe(10);
  });

  it("ignores send timestamps from the future after the clock jumped backwards", () => {
    const { s } = setup(2);
    s.submit("a", "1", FRAME_PRIORITY.state);
    s.submit("b", "1", FRAME_PRIORITY.state);
    expect(s.flush(100_000)).toBe(2);
    s.submit("c", "1", FRAME_PRIORITY.state);
    expect(s.flush(40_000)).toBe(1);
  });
});

describe("planFrames", () => {
  it("lets everything run while breathing, clocks and dots fit into the budget", () => {
    expect(planFrames({ breathing: 2, secondClocks: 1, working: 2 })).toEqual({
      workingTicks: true,
      clockStepS: 1,
    });
    expect(planFrames({ breathing: 0, secondClocks: 0, working: 20 })).toEqual({
      workingTicks: true,
      clockStepS: 1,
    });
  });

  it("stops the working dots first when the budget is exceeded", () => {
    expect(planFrames({ breathing: 2, secondClocks: 2, working: 1 })).toEqual({
      workingTicks: false,
      clockStepS: 1,
    });
  });

  it("moves second clocks to 2 s steps when stopping the dots is not enough", () => {
    expect(planFrames({ breathing: 2, secondClocks: 3, working: 0 })).toEqual({
      workingTicks: false,
      clockStepS: 2,
    });
  });

  it("follows the configured maximum", () => {
    expect(planFrames({ breathing: 2, secondClocks: 3, working: 4 }, 20).workingTicks).toBe(true);
  });
});
