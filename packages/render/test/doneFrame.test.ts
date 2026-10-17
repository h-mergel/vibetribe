import { animatedIds, type SessionView } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { slotTile } from "../src/fromCore";
import type { SlotTile } from "../src/model";
import { VARIANTS } from "../src/model";
import { render } from "../src/render";
import { C } from "../src/theme";

/**
 * An unseen Done is as prominent as Input/Approve in their calm phase (handoff v2): thick frame
 * and tint in the done colour, filled glyph. It never breathes: core `animatedIds` leaves it
 * out, so the frame stays at full opacity.
 */
const done: SessionView = {
  id: "win/d",
  key: { host: "win", sessionId: "d" },
  hostKind: "windows",
  badge: "WIN",
  title: "Refactor hub",
  cwd: "/c/proj",
  state: "done_unseen",
  detail: null,
  errorType: null,
  episodeSince: 0,
  episodeSeen: false,
  background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
  pid: 1,
  entrypoint: "claude-desktop",
  hostSessionId: null,
  bridgeSessionId: null,
};

const frameOf = (svg: string): string => svg.match(/<rect id="vt-frame"[^>]*>/)?.[0] ?? "";

describe.each(VARIANTS)("done_unseen frame (%s)", (variant) => {
  it("an unseen Done gets a static thick frame and tint in the done colour", () => {
    const animated = animatedIds([done], 1_000).has(done.id);
    expect(animated).toBe(false);
    const svg = render(slotTile(done, { now: 1_000, animated }), { variant });
    const f = frameOf(svg);
    expect(f).toContain(`stroke="${C.done}"`);
    expect(f).toContain('stroke-opacity="1"');
    expect(svg).toMatch(new RegExp(`id="vt-tint"[^>]*fill="${C.done}"`));
  });

  it("a Done tile whose model explicitly asks for no frame stays calm", () => {
    const tile: SlotTile = { ...slotTile(done, { now: 0, animated: false }), frame: "normal" };
    const svg = render(tile, { variant });
    expect(svg).not.toContain('id="vt-frame"');
    expect(svg).not.toContain('id="vt-tint"');
  });
});
