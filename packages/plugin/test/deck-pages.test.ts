import { describe, expect, it } from "vitest";
import { KEYS_SETTLE_MS, type KeyPlacement } from "../src/deck/keys";
import { deckHarness, hubState, session, T0, waiting } from "./helpers";

const INBOX: KeyPlacement = { id: "inbox", role: "inbox", device: "mk2", row: 0, column: 0 };

const page = (name: string, count: number): KeyPlacement[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${name}${i}`,
    role: "slot" as const,
    device: "mk2",
    row: 1 + Math.floor(i / 5),
    column: i % 5,
  }));

function pages(mainCount: number, profileCount: number) {
  const main = page("main", mainCount);
  const profile = page("prof", profileCount);
  const h = deckHarness({ max: 100, keys: [INBOX, ...main] });
  const titleOn = (key: KeyPlacement) => /<text[^>]*>(s\d+)</.exec(h.svgOf(key.id))?.[1] ?? null;
  const titles = (keys: KeyPlacement[]) => keys.map(titleOn);
  const swap = (from: KeyPlacement[], to: KeyPlacement[], now: number) => {
    for (const k of from) h.d.keyDisappeared(k.id, now);
    for (const k of to) h.d.keyAppeared(k, now);
  };
  return { ...h, main, profile, titles, swap };
}

const calm = (count: number) => Array.from({ length: count }, (_, i) => session(`s${i}`));
const withWaiting = (count: number, ids: number[], since: number) =>
  calm(count).map((v, i) => (ids.includes(i) ? waiting(`s${i}`, since) : v));

describe("Deck across two pages with different slot keys", () => {
  it("opening the profile: sessions waiting on the main page take visible keys from calm ones", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(7, 9);
    d.update(hubState({ sessions: calm(16) }), [], T0);
    d.tick(T0);
    const sessions = withWaiting(16, [0, 1, 2], T0 + 100);
    d.update(hubState({ sessions }), [], T0 + 100);
    d.tick(T0 + 100);
    swap(main, profile, T0 + 200);
    d.tick(T0 + 200 + KEYS_SETTLE_MS);
    const shown = titles(profile);
    expect(shown).toEqual(expect.arrayContaining(["s0", "s1", "s2"]));
    expect(shown.filter((t) => t !== null)).toHaveLength(9);
    expect(svgOf("inbox")).not.toContain("+");
  });

  it("back to the main page: sessions waiting on profile keys take visible keys from calm ones", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(5, 9);
    d.update(hubState({ sessions: calm(14) }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    expect(titles(profile).filter((t) => t !== null)).toHaveLength(9);
    const sessions = withWaiting(14, [5, 6, 7, 8], T0 + 2_000);
    d.update(hubState({ sessions }), [], T0 + 2_000);
    d.tick(T0 + 2_000);
    swap(profile, main, T0 + 3_000);
    d.tick(T0 + 3_000 + KEYS_SETTLE_MS);
    expect(titles(main)).toEqual(expect.arrayContaining(["s5", "s6", "s7", "s8"]));
    expect(svgOf("inbox")).not.toContain("+");
  });

  it("a session that starts waiting while its page is hidden comes to a visible key", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(5, 9);
    d.update(hubState({ sessions: calm(14) }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    const sessions = withWaiting(14, [0], T0 + 5_000);
    d.update(hubState({ sessions }), [], T0 + 5_000);
    d.tick(T0 + 5_000);
    expect(titles(profile)).toContain("s0");
    expect(svgOf("inbox")).not.toContain("+");
  });

  it("pinned calm sessions on every visible key do not block a waiting session", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(2, 2);
    const pinned = (i: number) => session(`s${i}`, { hostSessionId: `local_${i}` });
    const pins = ["local_0", "local_1", "local_2", "local_3"];
    const all = [pinned(0), pinned(1), pinned(2), pinned(3)];
    d.update(hubState({ sessions: all, pins }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    expect(titles(profile).filter((t) => t !== null)).toHaveLength(2);
    const sessions = [waiting("s0", T0 + 2_000), pinned(1), pinned(2), pinned(3)];
    d.update(hubState({ sessions, pins }), [], T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(titles(profile)).toContain("s0");
    expect(svgOf("inbox")).not.toContain("+");
  });

  it("calm sessions come back to the same keys in both directions", () => {
    const { d, main, profile, titles, swap } = pages(5, 9);
    const sessions = calm(14);
    d.update(hubState({ sessions }), [], T0);
    d.tick(T0);
    const onMain = titles(main);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    const onProfile = titles(profile);
    swap(profile, main, T0 + 2_000);
    d.tick(T0 + 2_000 + KEYS_SETTLE_MS);
    expect(titles(main)).toEqual(onMain);
    swap(main, profile, T0 + 4_000);
    d.tick(T0 + 4_000 + KEYS_SETTLE_MS);
    expect(titles(profile)).toEqual(onProfile);
  });

  it("a waiting session moves once per switch and displaces exactly one calm session", () => {
    const { d, main, profile, titles, swap } = pages(5, 9);
    d.update(hubState({ sessions: calm(14) }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    const before = titles(profile);
    const sessions = withWaiting(14, [0], T0 + 2_000);
    d.update(hubState({ sessions }), [], T0 + 2_000);
    d.tick(T0 + 2_000);
    const after = titles(profile);
    expect(after.filter((t, i) => t !== before[i])).toEqual(["s0"]);
    for (let t = T0 + 2_250; t < T0 + 4_000; t += 250) d.tick(t);
    expect(titles(profile)).toEqual(after);
  });

  it("a tick while the keys of a switch come and go moves no session", () => {
    const { d, main, profile, titles, swap } = pages(3, 3);
    d.update(hubState({ sessions: withWaiting(6, [0], T0) }), [], T0);
    d.tick(T0);
    swap(main, [], T0 + 100);
    for (const k of profile) d.keyAppeared(k, T0 + 100);
    d.tick(T0 + 100);
    expect(titles(profile)).toEqual(["s3", "s4", "s5"]);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    expect(titles(profile)).toContain("s0");
  });

  it("a key of the leaving page gets no waiting session in the middle of a switch", () => {
    const { d, main, titles } = pages(3, 3);
    d.update(hubState({ sessions: withWaiting(3, [0], T0) }), [], T0);
    d.tick(T0);
    expect(titles(main)).toEqual(["s0", "s1", "s2"]);
    d.keyDisappeared("main0", T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS - 1);
    expect(titles(main.slice(1))).toEqual(["s1", "s2"]);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    expect(titles(main.slice(1))).toContain("s0");
  });

  it("a waiting session comes back to its own key when the switch returns at once", () => {
    const { d, main, titles } = pages(3, 3);
    d.update(hubState({ sessions: calm(3) }), [], T0);
    d.update(hubState({ sessions: withWaiting(3, [1], T0) }), [], T0);
    d.tick(T0);
    d.keyDisappeared("main1", T0 + 100);
    d.keyAppeared(main[1] as KeyPlacement, T0 + 150);
    d.tick(T0 + 150 + KEYS_SETTLE_MS);
    expect(titles(main)).toEqual(["s0", "s1", "s2"]);
  });

  it("a waiting session on a hidden key takes a free visible key", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(2, 3);
    d.update(hubState({ sessions: withWaiting(2, [0], T0) }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    expect(titles(profile)).toEqual(["s0", null, null]);
    expect(svgOf("inbox")).not.toContain("+");
  });

  it("a clock set back during a switch does not hold a waiting session back", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(2, 2);
    d.update(hubState({ sessions: calm(4) }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.update(hubState({ sessions: withWaiting(4, [0], T0 + 100) }), [], T0 + 100);
    d.tick(T0 - 5_000);
    expect(titles(profile)).toContain("s0");
    expect(svgOf("inbox")).not.toContain("+");
  });

  it("after 60 s on the other page waiting sessions are on visible keys too", () => {
    const { d, svgOf, main, profile, titles, swap } = pages(5, 9);
    d.update(hubState({ sessions: calm(14) }), [], T0);
    d.tick(T0);
    swap(main, profile, T0 + 100);
    d.tick(T0 + 100 + KEYS_SETTLE_MS);
    d.update(hubState({ sessions: withWaiting(14, [5, 6], T0 + 2_000) }), [], T0 + 2_000);
    swap(profile, main, T0 + 3_000);
    d.tick(T0 + 64_000);
    d.tick(T0 + 64_250);
    expect(titles(main)).toEqual(expect.arrayContaining(["s5", "s6"]));
    expect(svgOf("inbox")).not.toContain("+");
  });
});
