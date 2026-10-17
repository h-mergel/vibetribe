import { afterEach, describe, expect, it, vi } from "vitest";
import { PARENT_CHECK_MS, watchParent } from "../src/parent";

afterEach(() => {
  vi.useRealTimers();
});

describe("watchParent", () => {
  it("checks every 5 s, ignores a live parent and reports a gone one exactly once", () => {
    vi.useFakeTimers();
    let alive = true;
    const checked: number[] = [];
    let gone = 0;
    watchParent(
      4242,
      (pid) => {
        checked.push(pid);
        return alive;
      },
      () => gone++,
    );
    expect(PARENT_CHECK_MS).toBe(5_000);
    vi.advanceTimersByTime(4_999);
    expect(checked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(gone).toBe(0);
    alive = false;
    vi.advanceTimersByTime(5_000);
    expect(gone).toBe(1);
    expect(checked).toEqual([4242, 4242]);
    vi.advanceTimersByTime(20_000);
    expect(gone).toBe(1);
    expect(checked).toHaveLength(2);
  });

  it("stop() cancels the watch", () => {
    vi.useFakeTimers();
    let gone = 0;
    const stop = watchParent(
      1,
      () => false,
      () => gone++,
    );
    stop();
    vi.advanceTimersByTime(20_000);
    expect(gone).toBe(0);
  });
});
