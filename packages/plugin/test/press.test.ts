import { describe, expect, it } from "vitest";
import { LONG_PRESS_MS, PressTracker } from "../src/deck/press";
import { svgDataUrl } from "../src/image";
import { svgFromDataUrl } from "./helpers";

describe("PressTracker", () => {
  it("classifies by hold time, 600 ms is long", () => {
    const t = new PressTracker();
    t.down("k", 1_000);
    expect(t.up("k", 1_000 + LONG_PRESS_MS - 1)).toBe("short");
    t.down("k", 2_000);
    expect(t.up("k", 2_000 + LONG_PRESS_MS)).toBe("long");
  });

  it("ignores an up without a down, and a cancelled key", () => {
    const t = new PressTracker();
    expect(t.up("k", 1)).toBeNull();
    t.down("k", 1);
    t.cancel("k");
    expect(t.up("k", 5_000)).toBeNull();
    t.down("a", 1);
    t.down("b", 1);
    expect(t.up("a", 10)).toBe("short");
    expect(t.up("a", 20)).toBeNull();
    expect(t.up("b", 2_000)).toBe("long");
  });
});

describe("PressTracker clock", () => {
  it("treats a backwards clock (now < down time) as a short press", () => {
    const t = new PressTracker();
    t.down("k", 10_000);
    expect(t.up("k", 5_000)).toBe("short");
    expect(t.up("k", 6_000)).toBeNull();
  });
});

describe("svgDataUrl", () => {
  it("encodes the documented data URL form and round-trips, keeping xmlns and umlauts", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Größe & "Co"</text></svg>';
    const url = svgDataUrl(svg);
    expect(url.startsWith("data:image/svg+xml,%3Csvg%20xmlns%3D")).toBe(true);
    expect(url).not.toMatch(/[<>"#]/);
    expect(svgFromDataUrl(url)).toBe(svg);
    expect(svgFromDataUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
