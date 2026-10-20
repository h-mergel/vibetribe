import { describe, expect, it } from "vitest";
import {
  decodeWslOutput,
  parseCimRows,
  parseDefaultDistro,
  parseRunningDistros,
  wslDefaultDistro,
} from "../src/sessions/ports";

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

describe("default WSL distribution (wsl -l -v, decoded)", () => {
  const LIST =
    "  NAME              STATE           VERSION\r\n* Ubuntu-24.04      Stopped         2\r\n  docker-desktop    Running         2\r\n";

  it("takes the row marked with a star, in any language", () => {
    expect(parseDefaultDistro(LIST)).toBe("Ubuntu-24.04");
    expect(parseDefaultDistro(LIST.replace("STATE", "ZUSTAND").replace("Stopped", "Beendet"))).toBe(
      "Ubuntu-24.04",
    );
  });

  it("is null without a marked row: no distribution or a WSL that is not installed", () => {
    expect(
      parseDefaultDistro("  NAME   STATE   VERSION\r\n  docker-desktop  Running  2\r\n"),
    ).toBeNull();
    expect(
      parseDefaultDistro("Windows Subsystem for Linux has no installed distributions.\r\n"),
    ).toBeNull();
    expect(parseDefaultDistro("")).toBeNull();
  });

  it("takes Docker Desktop's distribution as the default for none", () => {
    expect(
      parseDefaultDistro(
        LIST.replace("* Ubuntu-24.04", "  Ubuntu-24.04").replace(
          "  docker-desktop",
          "* docker-desktop",
        ),
      ),
    ).toBeNull();
  });

  it("reads wsl.exe in UTF-16LE and, with WSL_UTF8=1, in UTF-8", () => {
    expect(parseDefaultDistro(decodeWslOutput(Buffer.from(LIST, "utf16le")))).toBe("Ubuntu-24.04");
    expect(parseDefaultDistro(decodeWslOutput(Buffer.from(LIST, "utf8")))).toBe("Ubuntu-24.04");
  });

  it("wslDefaultDistro answers null when wsl.exe fails", async () => {
    expect(await wslDefaultDistro(async () => LIST)).toBe("Ubuntu-24.04");
    expect(await wslDefaultDistro(() => Promise.reject(new Error("ENOENT")))).toBeNull();
  });
});
