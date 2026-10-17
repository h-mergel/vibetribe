import { describe, expect, it } from "vitest";
import { escapeXml, n, svgDoc, text } from "../src/svg";

describe("escapeXml", () => {
  it("escapes markup characters", () => {
    expect(escapeXml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&apos;");
  });

  it("strips characters that are illegal in XML", () => {
    expect(escapeXml("Opti\x1bmierung")).toBe("Optimierung");
    expect(escapeXml("a\x00b\x0bc\x7fd￾e￿f")).toBe("abcdef");
    expect(escapeXml("a\uD800b\uDC00c")).toBe("abc");
  });

  it("keeps tabs, newlines and valid surrogate pairs", () => {
    expect(escapeXml("a\tb\nc\u{1F600}")).toBe("a\tb\nc\u{1F600}");
  });
});

describe("text and svgDoc", () => {
  it("writes id, rounded coordinates, font and an anchor other than start", () => {
    expect(text("vt-x", 10, 20.555, "a<b", 18, 700, "#fff")).toBe(
      '<text id="vt-x" x="10" y="20.56" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#fff">a&lt;b</text>',
    );
    expect(text("vt-x", 134, 20, "a", 18, 400, "#fff", "end")).toContain(' text-anchor="end">');
    expect(n(1 / 3)).toBe(0.33);
  });

  it("outlines only regular text in its own colour when stroke-text is set (comfortable)", () => {
    expect(text("vt-x", 10, 20, "a", 18, 400, "#fff", "end", 0.7)).toContain(
      ' text-anchor="end" stroke="#fff" stroke-width="0.7">',
    );
    expect(text("vt-x", 10, 20, "a", 18, 700, "#fff", "start", 0.7)).not.toContain("stroke");
    expect(text("vt-x", 10, 20, "a", 18, 400, "#fff")).not.toContain("stroke");
  });

  it("wraps the body in a 144 px document with a square ground", () => {
    const doc = svgDoc("<g/>");
    expect(doc).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect id="vt-ground" x="0" y="0" width="144" height="144" fill="#0E1116"/><g/></svg>',
    );
  });
});
