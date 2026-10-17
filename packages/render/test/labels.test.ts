import { describe, expect, it } from "vitest";
import { clampNum, clockParts, isInactiveNote, splitEuro } from "../src/labels";

const clock = (wait: number): string => clockParts(wait).join(" ");

describe("clockParts", () => {
  it("shows seconds in the first minute, then minutes, then h:mm, from 10 h whole hours", () => {
    expect(clock(0)).toBe("0 s");
    expect(clock(42)).toBe("42 s");
    expect(clock(59.9)).toBe("59 s");
    expect(clock(60)).toBe("1 min");
    expect(clock(3599)).toBe("59 min");
    expect(clock(3600)).toBe("1:00 h");
    expect(clock(3900)).toBe("1:05 h");
    expect(clock(35_999)).toBe("9:59 h");
    expect(clock(36_000)).toBe("10 h");
    expect(clock(360_000)).toBe("100 h");
  });

  it("clamps negative waits", () => {
    expect(clock(-5)).toBe("0 s");
  });
});

describe("clampNum and splitEuro", () => {
  it("caps counts at 99+", () => {
    expect(clampNum(99)).toBe("99");
    expect(clampNum(100)).toBe("99+");
  });

  it("finds the currency sign in front or behind", () => {
    expect(splitEuro("€12.40")).toEqual(["12.40", "€", true]);
    expect(splitEuro("12,40 €")).toEqual(["12,40", "€", false]);
    expect(splitEuro("$5")).toEqual(["5", "$", true]);
    expect(splitEuro("12.40")).toEqual(["12.40", "", false]);
  });
});

describe("isInactiveNote", () => {
  it("is true for every reason an extra tile can be inactive", () => {
    for (const n of ["Disabled", "No credit", "Limit hit", "Inactive"])
      expect(isInactiveNote(n)).toBe(true);
    for (const n of ["Sign in", "No data", "As of 14:32", null, undefined])
      expect(isInactiveNote(n)).toBe(false);
  });
});
