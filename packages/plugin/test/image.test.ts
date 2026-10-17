import { describe, expect, it } from "vitest";
import { svgDataUrl } from "../src/image";
import { svgFromDataUrl } from "./helpers";

describe("svgDataUrl / svgFromDataUrl", () => {
  it("round-trips #, %, ', newline and umlauts", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text fill="#0072B2">100% it's\nGröße Ä</text></svg>`;
    const url = svgDataUrl(svg);
    expect(url).not.toMatch(/[<>"#\s]/);
    expect(svgFromDataUrl(url)).toBe(svg);
  });

  it("does not throw on a lone surrogate and replaces it with U+FFFD", () => {
    const svg = "<svg>a\uD800b\uDC00c</svg>";
    let url = "";
    expect(() => {
      url = svgDataUrl(svg);
    }).not.toThrow();
    expect(svgFromDataUrl(url)).toBe("<svg>a�b�c</svg>");
  });

  it("round-trips all of them together", () => {
    const svg = "<svg fill=\"#0072B2\">50%\n'Größe'\uD800</svg>";
    expect(svgFromDataUrl(svgDataUrl(svg))).toBe(svg.replace("\uD800", "�"));
  });

  it("keeps valid surrogate pairs (emoji)", () => {
    expect(svgFromDataUrl(svgDataUrl("<svg>😀</svg>"))).toBe("<svg>😀</svg>");
  });

  it("returns null for other data URLs and for malformed percent sequences", () => {
    expect(svgFromDataUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(svgFromDataUrl("data:image/svg+xml,%E0%A4%A")).toBeNull();
    expect(svgFromDataUrl("data:image/svg+xml,100%")).toBeNull();
  });
});
