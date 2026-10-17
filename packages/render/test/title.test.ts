import { describe, expect, it } from "vitest";
import { drawableText, tileTitle } from "../src/title";

describe("drawableText", () => {
  it("keeps Latin (with accents), Greek, Cyrillic, digits and punctuation", () => {
    expect(drawableText("Überprüfung · café-2 Ωμέγα Привет")).toBe(
      "Überprüfung · café-2 Ωμέγα Привет",
    );
    expect(drawableText("Łódź")).toBe("Łódź");
  });

  it("composes decomposed accents first", () => {
    expect(drawableText("cafe\u0301")).toBe("café");
  });

  it("removes characters DejaVu Sans cannot draw", () => {
    expect(drawableText("日本語のプロジェクト")).toBe("");
    expect(drawableText("Plan 日本 v2")).toBe("Plan  v2");
    expect(drawableText("ไทย")).toBe("");
  });
});

describe("tileTitle", () => {
  it("returns a drawable title unchanged", () => {
    expect(tileTitle("Mobile Entwicklung Northwind", "/home/h/northwind")).toBe(
      "Mobile Entwicklung Northwind",
    );
  });

  it("drops undrawable characters but keeps the rest of a mixed title", () => {
    expect(tileTitle("Plan 日本 v2", "/home/h/plan")).toBe("Plan  v2");
  });

  it("falls back to the folder name when nothing readable is left", () => {
    expect(tileTitle("日本語のプロジェクト", "/home/h/nihongo-app")).toBe("nihongo-app");
    expect(tileTitle("日本語", "C:\\dev\\tokyo\\")).toBe("tokyo");
  });

  it("returns the empty remainder when the folder is not readable either", () => {
    expect(tileTitle("日本語", "/home/h/日本")).toBe("");
    expect(tileTitle("", "")).toBe("");
  });
});
