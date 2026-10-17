import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_HUB_URL, hubUrlOf, loadConfig, readToken, vibetribeDir } from "../src/config";

const files = (map: Record<string, string>) => (p: string) => {
  const v = map[p];
  if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return v;
};

describe("loadConfig", () => {
  const home = "/home/h";
  const cfgPath = join(vibetribeDir(home), "config.json");

  it("returns defaults without a config file", () => {
    expect(loadConfig(home, files({}))).toEqual({
      hubUrl: null,
      tokenPath: join(home, ".vibetribe", "token"),
      previousStatusline: null,
    });
  });

  it("reads hubUrl, tokenPath and previous statusline", () => {
    const cfg = {
      hubUrl: "http://127.0.0.1:9",
      tokenPath: "/mnt/c/Users/H/.vibetribe/token",
      previousStatusline: { command: "ccusage", padding: 0 },
    };
    expect(loadConfig(home, files({ [cfgPath]: JSON.stringify(cfg) }))).toEqual(cfg);
  });

  it("round-trips padding, refreshInterval and shell of the previous statusline", () => {
    const previousStatusline = {
      command: "ccusage",
      padding: 2,
      refreshInterval: 5,
      shell: "C:/Git/bin/bash.exe",
    };
    const cfg = {
      hubUrl: "http://127.0.0.1:9",
      tokenPath: "/mnt/c/Users/H/.vibetribe/token",
      previousStatusline,
    };
    const loaded = loadConfig(home, files({ [cfgPath]: JSON.stringify(cfg) }));
    expect(loaded.previousStatusline).toEqual(previousStatusline);
    expect(loaded.previousStatusline?.refreshInterval).toBe(5);
    expect(loaded.previousStatusline?.shell).toBe("C:/Git/bin/bash.exe");
  });

  it("drops a wrong-typed shell and refreshInterval", () => {
    const raw = { command: "ccusage", shell: 42, refreshInterval: "5" };
    const loaded = loadConfig(
      home,
      files({ [cfgPath]: JSON.stringify({ previousStatusline: raw }) }),
    );
    expect(loaded.previousStatusline).toStrictEqual({ command: "ccusage" });
  });

  it("falls back to defaults for invalid JSON or wrong field types", () => {
    expect(loadConfig(home, files({ [cfgPath]: "{nope" })).hubUrl).toBeNull();
    expect(
      loadConfig(
        home,
        files({ [cfgPath]: JSON.stringify({ hubUrl: 3, previousStatusline: { command: 1 } }) }),
      ),
    ).toEqual({
      hubUrl: null,
      tokenPath: join(home, ".vibetribe", "token"),
      previousStatusline: null,
    });
  });

  it("takes the default URL an earlier setup wrote as no explicit hub", () => {
    const written = JSON.stringify({ hubUrl: DEFAULT_HUB_URL, tokenPath: "/t" });
    expect(loadConfig(home, files({ [cfgPath]: written })).hubUrl).toBeNull();
    expect(DEFAULT_HUB_URL).toBe("http://127.0.0.1:43710");
  });
});

describe("hubUrlOf", () => {
  const tokenPath = "/mnt/c/Users/H/.vibetribe/token";
  const portFile = "/mnt/c/Users/H/.vibetribe/port";
  const config = (hubUrl: string | null) => ({ hubUrl, tokenPath, previousStatusline: null });

  it("an explicit hubUrl wins over the port file", () => {
    expect(hubUrlOf(config("http://127.0.0.1:9"), files({ [portFile]: "37710" }))).toBe(
      "http://127.0.0.1:9",
    );
  });

  it("follows the port the hub wrote next to the token", () => {
    expect(hubUrlOf(config(null), files({ [portFile]: "37710\r\n" }))).toBe(
      "http://127.0.0.1:37710",
    );
  });

  it.each([
    ["missing", {}],
    ["empty", { [portFile]: "" }],
    ["out of range", { [portFile]: "70000" }],
    ["not a number", { [portFile]: "37710x" }],
  ])("falls back to 43710 when the port file is %s", (_name, map) => {
    expect(hubUrlOf(config(null), files(map))).toBe(DEFAULT_HUB_URL);
  });
});

describe("readToken", () => {
  it("trims the token and returns null when missing or empty", () => {
    expect(readToken("/t", files({ "/t": "abc123\n" }))).toBe("abc123");
    expect(readToken("/t", files({ "/t": "  " }))).toBeNull();
    expect(readToken("/t", files({}))).toBeNull();
  });
});
