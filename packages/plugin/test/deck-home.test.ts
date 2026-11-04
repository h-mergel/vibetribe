import { describe, expect, it } from "vitest";
import type { KeyPlacement } from "../src/deck/keys";
import { homeHealth, inboxView, type TileContext, tileFor } from "../src/deck/tiles";
import { BUNDLED_PROFILE, BUNDLED_PROFILE_DEVICE_TYPE } from "../src/ids";
import { deckHarness, hubState, session, T0, waiting } from "./helpers";

const home = (over: Partial<KeyPlacement> = {}): KeyPlacement => ({
  id: "home",
  role: "home",
  device: "dev1",
  row: 0,
  column: 0,
  deviceType: BUNDLED_PROFILE_DEVICE_TYPE,
  ...over,
});

const ok = { health: "ok", lastAt: 1, error: null } as const;

describe("home key", () => {
  it("draws the circle of the hub state, with the count, on a visible key", () => {
    const { d, svgOf } = deckHarness({ keys: [home()] });
    d.update(
      hubState({ sessions: [waiting("a", T0), session("b", { state: "working" })] }),
      [],
      T0,
    );
    d.tick(T0);
    const svg = svgOf("home");
    expect(svg).toContain('id="vt-home-glyph-0"');
    expect(svg).toMatch(/id="vt-count"[^>]*>1</);
    expect(svg).toContain('fill="#3D8EF5"');
  });

  it("calm and empty before any session", () => {
    const { d, svgOf } = deckHarness({ keys: [home()] });
    d.update(hubState(), [], T0);
    d.tick(T0);
    expect(svgOf("home")).not.toContain("vt-count");
  });

  it("a breathing top dot gets frames like a breathing slot; once calm, the images stop", () => {
    const { d, sentTo } = deckHarness({ keys: [home()] });
    d.update(hubState({ sessions: [waiting("a", T0)] }), [], T0);
    for (let t = T0; t < T0 + 1_200; t += 250) d.tick(t);
    expect(sentTo("home")).toBeGreaterThanOrEqual(3);
    const done = session("a", { state: "done_unseen", episodeSince: T0, episodeSeen: false });
    d.update(hubState({ sessions: [done] }), [], T0 + 2_000);
    d.tick(T0 + 2_000);
    const after = sentTo("home");
    for (let t = T0 + 2_250; t < T0 + 4_000; t += 250) d.tick(t);
    expect(sentTo("home")).toBe(after);
  });

  it("hub trouble frames the tile: the same alert the status key shows", () => {
    const { d, svgOf } = deckHarness({ keys: [home()] });
    d.update(
      hubState({ sources: { ingress: { health: "ok", lastAt: 1, error: "no token here" } } }),
      [],
      T0,
    );
    d.tick(T0);
    expect(svgOf("home")).toContain('id="vt-frame"');
    expect(svgOf("home")).toContain('stroke="#FF5C33"');
  });

  it("short press: switches to the bundled profile on that device", () => {
    const { d } = deckHarness({ keys: [home()] });
    d.update(hubState(), [], T0);
    expect(d.press("home", "short", T0)).toEqual([
      { type: "switch_profile", keyId: "home", device: "dev1", profile: BUNDLED_PROFILE },
    ]);
  });

  it("the back key returns to the previous profile, on any device", () => {
    const { d, svgOf } = deckHarness({ keys: [home({ back: true, deviceType: 99 })] });
    d.update(hubState(), [], T0);
    d.tick(T0);
    expect(svgOf("home")).toContain('id="vt-back-glyph"');
    expect(svgOf("home")).not.toContain("vt-home-glyph");
    expect(d.press("home", "short", T0)).toEqual([
      { type: "switch_profile", keyId: "home", device: "dev1" },
    ]);
  });

  it("a device without a matching profile asks for the alert instead of switching", () => {
    const { d } = deckHarness({ keys: [home({ deviceType: 7 })] });
    d.update(hubState(), [], T0);
    expect(d.press("home", "short", T0)).toEqual([
      { type: "no_profile", keyId: "home", device: "dev1" },
    ]);
  });

  it("two devices press and return independently", () => {
    const keys = [
      home({ id: "open1" }),
      home({ id: "back1", column: 1, back: true }),
      home({ id: "open2", device: "dev2" }),
      home({ id: "back2", device: "dev2", column: 1, back: true }),
    ];
    const { d } = deckHarness({ keys });
    d.update(hubState(), [], T0);
    const profile = BUNDLED_PROFILE;
    expect(d.press("open1", "short", T0)).toEqual([
      { type: "switch_profile", keyId: "open1", device: "dev1", profile },
    ]);
    expect(d.press("open2", "short", T0)).toEqual([
      { type: "switch_profile", keyId: "open2", device: "dev2", profile },
    ]);
    expect(d.press("back2", "short", T0)).toEqual([
      { type: "switch_profile", keyId: "back2", device: "dev2" },
    ]);
    expect(d.press("back1", "short", T0)).toEqual([
      { type: "switch_profile", keyId: "back1", device: "dev1" },
    ]);
  });

  it("next to two breathing slots the deck stays within the frame budget and all three keys move", () => {
    const slotKey = (column: number): KeyPlacement => ({
      id: `slot${column}`,
      role: "slot",
      device: "dev1",
      row: 1,
      column,
    });
    const { d, sentTo } = deckHarness({ keys: [home(), slotKey(0), slotKey(1)] });
    d.update(hubState({ sessions: [waiting("a", T0), waiting("b", T0)] }), [], T0);
    for (let t = T0; t < T0 + 4_000; t += 250) {
      d.tick(t);
      expect(d.mirror(t).sentLastSecond).toBeLessThanOrEqual(10);
    }
    for (const id of ["home", "slot0", "slot1"]) expect(sentTo(id)).toBeGreaterThan(2);
  });

  it("counts exactly what the inbox counts, seen requests included", () => {
    const state = hubState({
      sessions: [
        waiting("a", T0),
        session("seen", { state: "error", episodeSince: T0, episodeSeen: true }),
        session("done", { state: "done_unseen", episodeSince: T0, episodeSeen: false }),
        session("work", { state: "working" }),
      ],
    });
    const inbox = inboxView(state, new Set());
    const ctx: TileContext = { now: T0, animated: new Set(), slotIds: [], inbox };
    const tile = tileFor(home(), -1, state, ctx);
    expect(tile).toMatchObject({ kind: "home", waiting: inbox.summary.waitingCount });
    expect(inbox.summary.waitingCount).toBe(3);
  });

  it("a long press does nothing", () => {
    const { d } = deckHarness({ keys: [home()] });
    d.update(hubState(), [], T0);
    expect(d.press("home", "long", T0)).toEqual([]);
  });
});

describe("homeHealth", () => {
  it("ok when every source is fine or not configured", () => {
    expect(homeHealth(hubState())).toBe("ok");
    expect(homeHealth(hubState({ sources: { "sessions:win": ok } }))).toBe("ok");
  });

  it("stale and down follow the worst source; an alert counts as down", () => {
    const stale = { health: "stale", lastAt: 1, error: null } as const;
    const missing = { health: "missing", lastAt: null, error: null } as const;
    expect(homeHealth(hubState({ sources: { usage: stale } }))).toBe("stale");
    expect(homeHealth(hubState({ sources: { usage: stale, "sessions:win": missing } }))).toBe(
      "missing",
    );
    expect(
      homeHealth(hubState({ sources: { setup: { health: "ok", lastAt: 1, error: "x" } } })),
    ).toBe("missing");
  });
});
