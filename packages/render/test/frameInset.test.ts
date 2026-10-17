import { describe, expect, it } from "vitest";
import type { Tile } from "../src/model";
import { VARIANTS } from "../src/model";
import { render } from "../src/render";
import { SAFE } from "../src/theme";

/**
 * A deliberate deviation from the handoff: the hardware bezel hides the outer pixels of a key, so
 * every frame sits with its outer edge 2 px inside the tile (the handoff draws it at 0–1 px). The
 * outer corner radius stays as in the handoff, and the inner edge keeps at least 1 px off the safe
 * area where texts and symbols start.
 */
const slot = { kind: "slot", title: "Refactor hub", badge: "WIN" } as const;
const TILES: Record<string, { tile: Tile; outerRadius: number }> = {
  thick: { tile: { ...slot, state: "needs_input", frame: "thick" }, outerRadius: 18 },
  "thick (status alert)": {
    tile: { kind: "status", rows: [{ source: "WIN", health: "ok" }], alert: "Port in use" },
    outerRadius: 18,
  },
  thin: { tile: { ...slot, state: "needs_input", frame: "thin" }, outerRadius: 17.5 },
  dashed: { tile: { ...slot, state: "no_signal" }, outerRadius: 17 },
};

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  sw: number;
}

function frameOf(svg: string): Frame {
  const el = /<rect id="vt-frame"[^>]*\/>/.exec(svg)?.[0] ?? "";
  const num = (name: string): number => Number(new RegExp(` ${name}="([^"]*)"`).exec(el)?.[1]);
  return {
    x: num("x"),
    y: num("y"),
    width: num("width"),
    height: num("height"),
    rx: num("rx"),
    sw: num("stroke-width"),
  };
}

describe.each(VARIANTS)("frame inset for the hardware bezel, R12 (%s)", (variant) => {
  it.each(Object.entries(TILES))("%s: outer edge at 2 px, clear of the safe area", (_, t) => {
    const f = frameOf(render(t.tile, { variant }));
    const half = f.sw / 2;
    for (const [pos, size] of [
      [f.x, f.width],
      [f.y, f.height],
    ] as const) {
      expect(pos - half).toBe(2);
      expect(pos + size + half).toBe(142);
      expect(pos + half).toBeLessThanOrEqual(SAFE.min - 1);
    }
    expect(f.rx + half).toBe(t.outerRadius);
  });
});

describe("thick stroke width per variant", () => {
  it.each([
    ["comfortable", 6],
    ["compact", 7],
  ] as const)("%s: %i px", (variant, width) => {
    const tile = { ...slot, state: "needs_input", frame: "thick" } as const;
    expect(frameOf(render(tile, { variant })).sw).toBe(width);
  });
});
