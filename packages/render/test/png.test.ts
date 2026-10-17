import { describe, expect, it } from "vitest";
import type { SlotTile } from "../src/model";
import { boxOf, renderPixels, svgToPng } from "../src/png";
import { render } from "../src/render";
import { svgDoc, text } from "../src/svg";

describe("svgToPng", () => {
  it("produces a 144x144 PNG, or the requested width", () => {
    const png = svgToPng(render({ kind: "inbox", top: null, waiting: 0 }));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(144);
    expect(png.readUInt32BE(20)).toBe(144);
    expect(svgToPng(render({ kind: "empty" }), 72).readUInt32BE(16)).toBe(72);
  });

  it("rasterizes text, so the font is actually found", () => {
    const withText = renderPixels(svgDoc(text("t", 72, 80, "Test", 24, 700, "#FFFFFF", "middle")));
    expect(withText.equals(renderPixels(svgDoc("")))).toBe(false);
  });

  it("measures the box of a single fragment", () => {
    const short = boxOf(text("t", 72, 80, "ii", 18, 400, "#fff", "middle"));
    const long = boxOf(text("t", 72, 80, "WWWWWW", 18, 400, "#fff", "middle"));
    expect(short?.width).toBeGreaterThan(0);
    expect(long?.width).toBeGreaterThan((short?.width ?? 0) * 5);
    expect(long?.width).toBeLessThan(144);
    // baseline 80, 18 px: the box ends just below the baseline
    expect((long?.y ?? 0) + (long?.height ?? 0)).toBeLessThanOrEqual(81);
    expect(boxOf("<g/>")).toBeNull();
  });

  it("rasterizes a tile whose title contains XML-illegal control characters", () => {
    const tile: SlotTile = { kind: "slot", title: "Opti\x1bmierung", state: "idle", badge: "APP" };
    for (const variant of ["comfortable", "compact"] as const)
      expect(() => svgToPng(render(tile, { variant }))).not.toThrow();
  });
});
