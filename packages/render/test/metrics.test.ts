import { describe, expect, it } from "vitest";
import { cleanTitle, fit, isMeasured, layoutTitle, textWidth, wrap } from "../src/metrics";

describe("textWidth", () => {
  it("sums DejaVu Sans advances per weight (values of the reference SVGs)", () => {
    // handoff reference dicht/slot-needs_permission (compact): clock "42" at x 10, unit at 10 + width + 4 = 41.83
    expect(textWidth("42", 20, 700)).toBeCloseTo(27.83, 2);
    expect(textWidth("42", 20, 400)).toBeLessThan(textWidth("42", 20, 700));
    expect(textWidth("", 20, 400)).toBe(0);
  });

  it("counts characters missing from the table as 0.62 em per UTF-16 code unit", () => {
    expect(isMeasured("a")).toBe(true);
    expect(isMeasured("€")).toBe(true);
    expect(isMeasured("日")).toBe(false);
    expect(textWidth("日", 10, 400)).toBeCloseTo(6.2, 5);
    expect(textWidth("\u{1F680}", 10, 400)).toBeCloseTo(12.4, 5);
  });
});

describe("fit", () => {
  it("keeps text that fits and elides the rest with an ellipsis", () => {
    expect(fit("Idle", 100, 18, 700)).toBe("Idle");
    const cut = fit("Approve Approve", 60, 18, 700);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, 18, 700)).toBeLessThanOrEqual(60);
  });

  it("drops trailing spaces before the ellipsis and returns '' when nothing fits", () => {
    expect(fit("ab cdefghijkl", textWidth("ab …", 20, 400), 20, 400)).toBe("ab…");
    expect(fit("WWW", 5, 20, 700)).toBe("");
  });
});

describe("cleanTitle", () => {
  it("removes emoji, joiners and variation selectors and collapses whitespace", () => {
    expect(cleanTitle("🚀 Launch   Checkliste")).toBe("Launch Checkliste");
    expect(cleanTitle("a\u200Db\uFE0Fc")).toBe("abc");
  });

  it("returns a dash for empty titles", () => {
    expect(cleanTitle("   ")).toBe("–");
    expect(cleanTitle(null)).toBe("–");
    expect(cleanTitle("🚀🚀")).toBe("–");
  });
});

describe("wrap (two-line titles)", () => {
  const lines = (s: string, maxW = 124) => wrap(cleanTitle(s), maxW, [20, 18], 400);

  it("keeps head and tail of a long multi-word title", () => {
    expect(lines("Mobile Entwicklung Northwind")).toMatchObject({
      lines: ["Mobile En…", "Northwind"],
      size: 20,
    });
    expect(lines("Mobile Entwicklung Northwind Backend Refactoring").lines).toEqual([
      "Mobile En…",
      "Refactoring",
    ]);
  });

  it("breaks a single long word after - _ / . and elides the rest", () => {
    expect(lines("vibetribe-streamdeck-plugin").lines).toEqual(["vibetribe-", "streamde…"]);
  });

  it("steps down to 18 px only when that saves a cut", () => {
    expect(lines("Überprüfung Änderungsprotokoll")).toMatchObject({
      lines: ["Überprüfung", "Änderungs…"],
      size: 18,
    });
    expect(lines("Refactor hub")).toMatchObject({ lines: ["Refactor", "hub"], size: 20 });
  });

  it("hard-breaks one overlong word with a hyphen, leaving at least 3 letters", () => {
    const r = layoutTitle("x".repeat(60), 124, 20, 400);
    expect(r.hard).toBe(true);
    expect(r.lines[0]?.endsWith("-")).toBe(true);
    expect(r.lines).toHaveLength(2);
    const short = layoutTitle("Datenmigration", textWidth("Datenmigr-", 20, 400), 20, 400);
    expect(short.lines).toEqual(["Datenmigr-", "ation"]);
  });

  it("never returns a line wider than the box", () => {
    for (const s of ["WWWWWWWWWWWWWWWWWWWW", "a/b/c/d/e/f/g/h/i/j/k/l", "A", "x".repeat(60)]) {
      for (const l of lines(s).lines) expect(textWidth(l, 20, 400)).toBeLessThanOrEqual(124);
    }
  });
});
