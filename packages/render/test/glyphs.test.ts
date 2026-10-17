import { describe, expect, it } from "vitest";
import { glyph } from "../src/glyphs";
import { C } from "../src/theme";

describe("glyph", () => {
  it("draws a filled 22 px diamond exactly like the reference (comfortable Approve)", () => {
    expect(glyph("diamond", C.permission, { x: 14, y: 16, size: 22, filled: true })).toBe(
      '<g id="vt-glyph" data-glyph="diamond" transform="translate(14 16)"><g fill="#FFB524"><polygon points="11,0.39 21.61,11 11,21.61 0.39,11"/></g><line fill="none" stroke="#0E1116" stroke-width="2.67" x1="11" y1="5.89" x2="11" y2="11.94"/><circle cx="11" cy="15.4" r="1.65" fill="#0E1116"/></g>',
    );
  });

  it("draws the seen state as outline with the mark in the accent", () => {
    const g = glyph("check", C.done, { id: "vt-calm" });
    expect(g).toContain(
      '<g fill="none" stroke="#30D6A4" stroke-width="3.4"><circle cx="14" cy="14" r="11.8"/></g>',
    );
    expect(g).toContain('id="vt-calm"');
  });

  it("scales arc radii but not arc rotation and flags", () => {
    expect(glyph("bubble", C.input, { size: 14, filled: true })).toContain(
      "A 2.5 2.5 0 0 1 13.5 2.75",
    );
  });

  it("lights one of the three working dots", () => {
    const g = glyph("dots", C.working, { tick: 4 });
    expect(g).toContain('data-tick="1"');
    expect(g.match(/fill-opacity="1"/g)).toHaveLength(1);
  });

  it("never uses scale(), only translate", () => {
    for (const size of [15, 18, 20, 22, 24, 28, 36, 40])
      expect(glyph("hourglass", C.throttled, { size })).not.toMatch(/scale\(|rotate\(/);
  });
});
