import { CYCLE_WINDOW_MS } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { InboxOpens } from "../src/jump/inbox-opens";

const T = 1_000_000;
/** a focus port that answers every id with the time given for it */
const port = (focus: Record<string, number>) => async (ids: readonly string[]) =>
  new Map(ids.flatMap((id) => (focus[id] === undefined ? [] : [[id, focus[id]] as const])));

describe("InboxOpens", () => {
  it("drops a focus from the inbox jump up to the end of the cycle window, nothing else", async () => {
    const opens = new InboxOpens(10);
    opens.note("local_x", T);
    const focus = { local_x: 0, local_y: T + 2_000 };
    const filtered = opens.filter(port(focus));
    const at = async (f: number) => {
      focus.local_x = f;
      return (await filtered?.(["local_x", "local_y"]))?.get("local_x");
    };
    expect(await at(T - 1)).toBe(T - 1);
    expect(await at(T)).toBeUndefined();
    expect(await at(T + 2_000)).toBeUndefined();
    expect(await at(T + CYCLE_WINDOW_MS)).toBeUndefined();
    expect(await at(T + CYCLE_WINDOW_MS + 1)).toBe(T + CYCLE_WINDOW_MS + 1);
    expect(await filtered?.(["local_y"])).toEqual(new Map([["local_y", T + 2_000]]));
  });

  it("drops the focus of both the previous and the latest inbox jump to a session", async () => {
    const opens = new InboxOpens(10);
    opens.note("local_x", T);
    opens.note("local_x", T + 60_000);
    const focus = { local_x: 0 };
    const filtered = opens.filter(port(focus));
    const at = async (f: number) => {
      focus.local_x = f;
      return (await filtered?.(["local_x"]))?.get("local_x");
    };
    expect(await at(T + 2_000)).toBeUndefined();
    expect(await at(T + 30_000)).toBe(T + 30_000);
    expect(await at(T + 62_000)).toBeUndefined();
  });

  it("forgets the oldest session beyond its cap", async () => {
    const opens = new InboxOpens(2);
    opens.note("local_a", T);
    opens.note("local_b", T);
    opens.note("local_a", T);
    opens.note("local_c", T);
    const filtered = opens.filter(port({ local_a: T + 1, local_b: T + 1, local_c: T + 1 }));
    expect(await filtered?.(["local_a", "local_b", "local_c"])).toEqual(
      new Map([["local_b", T + 1]]),
    );
  });

  it("without a focus port there is none to filter", () => {
    expect(new InboxOpens(10).filter(null)).toBeNull();
    expect(new InboxOpens(10).filter(undefined)).toBeNull();
  });
});
