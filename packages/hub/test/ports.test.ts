import { describe, expect, it } from "vitest";
import { parseCimRows, parseRunningDistros } from "../src/sessions/ports";

describe("parseCimRows (PowerShell 5.1 ConvertTo-Json)", () => {
  it("parses an array, a single object and empty output", () => {
    const two =
      '[{"ProcessId":100,"CreationDate":"\\/Date(1791624889863)\\/"},{"ProcessId":7,"CreationDate":"\\/Date(5)\\/"}]';
    expect(parseCimRows(two)).toEqual(
      new Map([
        [100, 1_791_624_889_863],
        [7, 5],
      ]),
    );
    expect(parseCimRows('{"ProcessId":100,"CreationDate":"\\/Date(42)\\/"}')).toEqual(
      new Map([[100, 42]]),
    );
    expect(parseCimRows("")).toEqual(new Map());
    expect(parseCimRows("  \r\n")).toEqual(new Map());
  });

  it("skips rows without a date and survives garbage", () => {
    expect(parseCimRows('[{"ProcessId":1},{"ProcessId":2,"CreationDate":null}]')).toEqual(
      new Map(),
    );
    expect(parseCimRows("not json")).toEqual(new Map());
  });
});

describe("parseRunningDistros (wsl -l --running --quiet, decoded)", () => {
  it("splits lines, trims and drops empties and NULs", () => {
    expect(parseRunningDistros("Ubuntu\r\ndocker-desktop\r\n\r\n")).toEqual([
      "Ubuntu",
      "docker-desktop",
    ]);
    expect(parseRunningDistros("﻿Ubuntu\0\r\n")).toEqual(["Ubuntu"]);
    expect(parseRunningDistros("")).toEqual([]);
  });
});
