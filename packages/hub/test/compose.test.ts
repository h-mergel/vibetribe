import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT } from "@vibetribe/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { GUARDED_PORTS } from "../../../test/real-ports-guard.mjs";
import {
  backgroundFilePorts,
  createFileLog,
  dataDirOf,
  FALLBACK_PORTS,
  readHubToken,
  windowsHubConfig,
  wslDistro,
} from "../src/compose";
import { runClaudeVersion } from "../src/usage/cli";

let dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "vt-compose-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("createFileLog", () => {
  it("creates the directory, appends timestamped lines and rotates at 1 MB keeping 5 files", () => {
    const dir = join(temp(), "logs");
    const log = createFileLog(dir, "plugin");
    log("hello");
    expect(readFileSync(join(dir, "plugin.log"), "utf8")).toMatch(/^\d{4}-\d\d-\d\dT.* hello\n$/);
    writeFileSync(join(dir, "plugin.log"), "x".repeat(1_000_001));
    for (let i = 0; i < 6; i++) {
      log(`round ${i}`);
      writeFileSync(join(dir, "plugin.log"), "x".repeat(1_000_001));
    }
    expect(readdirSync(dir).sort()).toEqual([
      "plugin.1.log",
      "plugin.2.log",
      "plugin.3.log",
      "plugin.4.log",
      "plugin.log",
    ]);
    expect(statSync(join(dir, "plugin.1.log")).size).toBe(1_000_001);
  });

  it("never throws when the directory cannot be created", () => {
    const file = join(temp(), "not-a-dir");
    writeFileSync(file, "");
    expect(() => createFileLog(join(file, "logs"), "hub")("x")).not.toThrow();
  });
});

describe("readHubToken and dataDirOf", () => {
  it("reads and trims the token, null when missing or empty", () => {
    const home = temp();
    expect(readHubToken(home)).toBeNull();
    const dir = join(home, ".vibetribe");
    mkdirSync(dir);
    writeFileSync(join(dir, "token"), "  abc \n");
    expect(readHubToken(home)).toBe("abc");
    writeFileSync(join(dir, "token"), " \n");
    expect(readHubToken(home)).toBeNull();
  });

  it("prefers APPDATA and falls back to the roaming path under home", () => {
    expect(dataDirOf({ APPDATA: "C:\\A" }, "C:\\H")).toBe(join("C:\\A", "vibetribe"));
    expect(dataDirOf({}, "C:\\H")).toBe(join("C:\\H", "AppData", "Roaming", "vibetribe"));
  });
});

describe("runClaudeVersion", () => {
  it("runs the executable with --version and resolves its stdout", async () => {
    // node itself: a real child process, but never claude.exe
    expect(await runClaudeVersion(process.execPath)).toMatch(/^v\d+\./);
  });

  it("rejects when the executable does not exist", async () => {
    await expect(runClaudeVersion(join(temp(), "missing-claude"))).rejects.toThrow();
  });
});

describe("windowsHubConfig", () => {
  const noExe = () => null;
  const neverAnswers = () => new Promise<string>(() => {});

  it("without a token wires the Windows source and usage, closes the ingress with a random token, and does not await the claude lookup", async () => {
    const home = temp();
    const lines: string[] = [];
    const started = Date.now();
    const { config, summary } = await windowsHubConfig({
      log: (l) => lines.push(l),
      home,
      env: { VIBETRIBE_PORT: "nope" },
      token: null,
      findExe: () => "C:\\bin\\claude.exe",
      runVersion: neverAnswers,
    });
    // the version lookup never resolves; the config must still come back at once
    expect(Date.now() - started).toBeLessThan(100);
    expect(config.tokenMissing).toBe(true);
    expect(config.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(config.port).toBe(43710);
    expect(config.fallbackPorts).toEqual(FALLBACK_PORTS);
    expect(config.sources.map((s) => s.name)).toEqual(["sessions:win"]);
    expect(config.usage).not.toBeNull();
    expect(summary).toMatch(/^sources sessions:win, sessions:remote, claude /);
    expect(config.remote?.ports.fetchSessions).toBeTypeOf("function");
    expect(summary).toContain("C:\\bin\\claude.exe");
    expect(lines).toEqual(["ignoring invalid VIBETRIBE_PORT, using 43710"]);
  });

  it("builds the WSL source only when asked, for the distribution found later", async () => {
    const { config, wslSource } = await windowsHubConfig({
      log: () => {},
      home: temp(),
      env: {},
      token: "abc",
      findExe: noExe,
    });
    expect(config.sources.map((s) => s.name)).toEqual(["sessions:win"]);
    const wsl = wslSource("Debian");
    expect([wsl.name, wsl.host, wsl.hostKind]).toEqual([
      "sessions:wsl:Debian",
      "wsl:Debian",
      "wsl",
    ]);
  });

  it("wslDistro takes VIBETRIBE_WSL_DISTRO, else WSL's default distribution; none switches WSL off", async () => {
    let asked = 0;
    const found = async () => {
      asked++;
      return "Debian";
    };
    expect(await wslDistro({ VIBETRIBE_WSL_DISTRO: "Ubuntu" }, found)).toBe("Ubuntu");
    expect(await wslDistro({ VIBETRIBE_WSL_DISTRO: "none" }, found)).toBeNull();
    expect(asked).toBe(0);
    expect(await wslDistro({}, found)).toBe("Debian");
    expect(await wslDistro({ VIBETRIBE_WSL_DISTRO: "" }, async () => null)).toBeNull();
  });

  it("uses a given token verbatim", async () => {
    const home = temp();
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env: {},
      token: "abc",
      findExe: noExe,
    });
    expect(config.tokenMissing).toBe(false);
    expect(config.token).toBe("abc");
  });

  it("records the bound port in .vibetribe/port of the home, next to the token", async () => {
    const home = temp();
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env: {},
      token: "abc",
      findExe: noExe,
    });
    await config.savePort?.(37710);
    expect(readFileSync(join(home, ".vibetribe", "port"), "utf8")).toBe("37710");
  });

  it("the fallback ports lie below Windows' dynamic range and so far apart that one 4096-port WSL block covers at most one", () => {
    const all = [DEFAULT_PORT, ...FALLBACK_PORTS].sort((x, y) => x - y);
    expect(new Set(all).size).toBe(all.length);
    for (const port of all) {
      expect(port).toBeGreaterThan(1024);
      expect(port).toBeLessThan(49152);
    }
    const gaps = all.slice(1).map((port, i) => port - (all[i] ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThan(4096);
  });

  it("the test guard refuses exactly the ports of the hub", () => {
    expect(GUARDED_PORTS).toEqual([DEFAULT_PORT, ...FALLBACK_PORTS]);
  });

  it("a rejecting version lookup logs the fallback, leaves no unhandled rejection, and reports no claude path", async () => {
    const lines: string[] = [];
    const { summary } = await windowsHubConfig({
      log: (l) => lines.push(l),
      home: temp(),
      env: {},
      token: "abc",
      findExe: () => "C:\\bin\\claude.exe",
      runVersion: () => Promise.reject(new Error("boom")),
    });
    expect(summary).toContain("claude C:\\bin\\claude.exe");
    // let the rejected lookup settle; an unhandled rejection would fail the run
    await new Promise((r) => setTimeout(r, 0));
    expect(lines).toEqual([expect.stringMatching(/claude --version failed .*boom.*2\.1\.287/)]);
  });

  it("without claude.exe it reports 'not found' and never asks for a version", async () => {
    let asked = false;
    const { summary } = await windowsHubConfig({
      log: () => {},
      home: temp(),
      env: {},
      token: "abc",
      findExe: noExe,
      runVersion: async () => {
        asked = true;
        return "";
      },
    });
    expect(summary).toMatch(/claude not found$/);
    expect(asked).toBe(false);
  });
});

describe("backgroundFilePorts (Plan 7)", () => {
  it("reads null without a file, creates the folder and replaces the file atomically", async () => {
    const path = join(temp(), "vibetribe", "background.json");
    const ports = backgroundFilePorts(path);
    expect(await ports.load()).toBeNull();
    await ports.save('{"v":1,"sessions":[]}');
    await ports.save('{"v":1,"sessions":[1]}');
    expect(await ports.load()).toBe('{"v":1,"sessions":[1]}');
    expect(readdirSync(join(path, ".."))).toEqual(["background.json"]);
  });

  it("windowsHubConfig keeps the file next to the usage cache under the data folder", async () => {
    const home = temp();
    const appdata = join(home, "Roaming");
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env: { APPDATA: appdata },
      token: "t",
      findExe: () => null,
    });
    await config.background?.save("x");
    expect(readFileSync(join(appdata, "vibetribe", "background.json"), "utf8")).toBe("x");
  });

  it("windowsHubConfig writes the usage cache atomically, creating the data folder", async () => {
    const home = temp();
    const appdata = join(home, "Roaming");
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env: { APPDATA: appdata },
      token: "t",
      findExe: () => null,
    });
    const input = { fiveHour: { usedPct: 5, resetsAt: null }, sevenDay: null, extra: null };
    await config.usage?.ports.saveCache(input, 7);
    const dir = join(appdata, "vibetribe");
    expect(JSON.parse(readFileSync(join(dir, "usage-cache.json"), "utf8"))).toEqual({
      input,
      at: 7,
    });
    expect(readdirSync(dir)).toEqual(["usage-cache.json"]);
  });

  it("writes through a temp file: a failed write leaves the old file untouched", async () => {
    const path = join(temp(), "background.json");
    const ports = backgroundFilePorts(path);
    await ports.save("old");
    // a directory where the temp file goes makes the next write fail before the rename
    mkdirSync(`${path}.tmp`);
    await expect(ports.save("new")).rejects.toThrow();
    expect(await ports.load()).toBe("old");
  });

  it("an unreadable file is an error, not an empty list", async () => {
    const dir = temp();
    await expect(backgroundFilePorts(dir).load()).rejects.toThrow();
  });
});
