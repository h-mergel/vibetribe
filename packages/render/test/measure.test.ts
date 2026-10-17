import { describe, expect, it } from "vitest";
import { extractElements, layoutIssues, type PlacedElement } from "../scripts/measure-lib";
import { glyph } from "../src/glyphs";
import { svgDoc, text } from "../src/svg";

describe("extractElements", () => {
  it("returns texts with their size, symbol groups with nested groups, and the overflow pill", () => {
    const svg = svgDoc(
      text("vt-badge", 134, 127, "APP", 18, 700, "#fff", "end") +
        glyph("dots", "#fff", { x: 10, y: 10 }) +
        '<rect id="vt-overflow-pill" x="1" y="1" width="2" height="2"/>',
    );
    const els = extractElements(svg);
    expect(els.map((e) => [e.id, e.size])).toEqual([
      ["vt-badge", 18],
      ["vt-glyph", null],
      ["vt-overflow-pill", null],
    ]);
    // the glyph group ends after its nested vt-work-tick group
    expect(els[1]?.fragment.endsWith("</g></g>")).toBe(true);
  });

  it("returns nothing for an svg without elements", () => {
    expect(extractElements(svgDoc(""))).toEqual([]);
  });
});

describe("layoutIssues", () => {
  const el = (id: string, x: number, y: number, w: number, h: number, size: number | null = 18) =>
    ({ id, fragment: "", size, box: { x, y, width: w, height: h } }) satisfies PlacedElement;

  it("accepts elements inside [10, 134] with half a pixel tolerance", () => {
    expect(layoutIssues([el("a", 9.6, 10, 124.8, 20), el("b", 10, 100, 10, 34.4)])).toEqual([]);
  });

  it("flags elements outside the safe area and texts below 18 px", () => {
    expect(layoutIssues([el("a", 9, 20, 10, 10), el("b", 20, 40, 10, 10, 16)])).toEqual([
      "a outside [10, 134]: x=9.0 y=20.0 r=19.0 b=30.0",
      "b below 18 px",
    ]);
  });

  it("flags overlaps beyond 2 px, but not the overflow count in its pill", () => {
    expect(layoutIssues([el("a", 10, 10, 20, 20), el("b", 28, 10, 20, 20)])).toEqual([]);
    expect(layoutIssues([el("a", 10, 10, 20, 20), el("b", 20, 10, 20, 20)])).toEqual([
      "a overlaps b",
    ]);
    expect(
      layoutIssues([
        el("vt-overflow", 100, 12, 20, 20),
        el("vt-overflow-pill", 95, 10, 30, 26, null),
      ]),
    ).toEqual([]);
  });
});
