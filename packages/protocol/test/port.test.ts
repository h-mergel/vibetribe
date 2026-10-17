import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, parsePortNumber } from "../src/port";

describe("parsePortNumber", () => {
  it("takes decimal ports in 1..65535", () => {
    expect(parsePortNumber("1")).toBe(1);
    expect(parsePortNumber("37710")).toBe(37710);
    expect(parsePortNumber("65535")).toBe(65535);
    expect(parsePortNumber(String(DEFAULT_PORT))).toBe(43710);
  });

  it.each([
    "",
    "0",
    "65536",
    "-1",
    "12.5",
    "1e3",
    "0x10",
    " 37710",
    "37710\n",
    "abc",
    "9".repeat(400),
  ])("refuses %j", (raw) => {
    expect(parsePortNumber(raw)).toBeNull();
  });
});
