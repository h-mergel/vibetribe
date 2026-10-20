import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { timestamp } from "../src/setup/fsops";
import { install, type SetupEnv, SetupError, uninstall } from "../src/setup/install";

function setupEnv(over: Partial<SetupEnv> = {}): SetupEnv & { lines: string[] } {
  const home = mkdtempSync(join(tmpdir(), "vt-setup-"));
  const lines: string[] = [];
  return {
    home,
    platform: "win32",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    reporterSource: "// reporter bundle",
    wsl: false,
    windowsHome: null,
    now: new Date(Date.UTC(2026, 9, 10, 18, 30, 5)),
    randomToken: () => "a".repeat(64),
    log: (l) => lines.push(l),
    gitBash: () => null,
    lines,
    ...over,
  };
}

const settingsPath = (home: string) => join(home, ".claude", "settings.json");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeSettings = (home: string, raw: string) => {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(settingsPath(home), raw);
};
/** nothing written: settings untouched, no backup, and no ~/.vibetribe (no config, token or reporter) */
function expectUntouched(home: string, raw: string) {
  expect(readFileSync(settingsPath(home), "utf8")).toBe(raw);
  expect(readdirSync(join(home, ".claude"))).toEqual(["settings.json"]);
  expect(existsSync(join(home, ".vibetribe"))).toBe(false);
}

describe("timestamp", () => {
  it("formats YYYYMMDDHHmmss in UTC", () => {
    expect(timestamp(new Date(Date.UTC(2026, 9, 10, 8, 5, 3)))).toBe("20261010080503");
  });
});

describe("install on windows", () => {
  it("copies the reporter, creates token and config, and installs hooks + statusline with backup", () => {
    const e = setupEnv();
    writeSettings(
      e.home,
      JSON.stringify({ model: "opus", statusLine: { type: "command", command: "ccusage" } }),
    );
    install(e);
    const dir = join(e.home, ".vibetribe");
    expect(readFileSync(join(dir, "reporter.mjs"), "utf8")).toBe("// reporter bundle");
    expect(readFileSync(join(dir, "token"), "utf8")).toBe("a".repeat(64));
    expect(readJson(join(dir, "config.json"))).toEqual({
      hubUrl: null,
      tokenPath: join(dir, "token"),
      previousStatusline: { command: "ccusage" },
    });
    const s = readJson(settingsPath(e.home));
    expect(s.model).toBe("opus");
    expect(s.hooks.Stop[0].hooks[0].command).toBe("C:/Program Files/nodejs/node.exe");
    expect(s.hooks.Stop[0].hooks[0].args[0]).toBe(
      `${join(dir, "reporter.mjs").replaceAll("\\", "/")}`,
    );
    expect(s.statusLine.command).toContain("statusline");
    expect(existsSync(`${settingsPath(e.home)}.vibetribe-20261010183005.bak`)).toBe(true);
  });

  it("is idempotent: a second run changes nothing and writes no second backup", () => {
    const e = setupEnv();
    install(e);
    const first = readFileSync(settingsPath(e.home), "utf8");
    install({ ...e, now: new Date(Date.UTC(2026, 9, 10, 19, 0, 0)) });
    expect(readFileSync(settingsPath(e.home), "utf8")).toBe(first);
    expect(readdirSync(join(e.home, ".claude")).filter((f) => f.includes(".bak"))).toHaveLength(0);
    expect(readJson(join(e.home, ".vibetribe", "config.json")).previousStatusline).toBeNull();
  });

  it("records Git Bash as the shell of a displaced statusline on Windows", () => {
    const e = setupEnv({ gitBash: () => "C:\\dev\\tools\\Git\\bin\\bash.exe" });
    writeSettings(
      e.home,
      JSON.stringify({ statusLine: { type: "command", command: "~/.claude/statusline.sh" } }),
    );
    install(e);
    expect(readJson(join(e.home, ".vibetribe", "config.json")).previousStatusline).toEqual({
      command: "~/.claude/statusline.sh",
      shell: "C:/dev/tools/Git/bin/bash.exe",
    });
    expect(e.lines.some((l) => l.startsWith("node: C:/Program Files/nodejs/node.exe"))).toBe(true);
  });

  it("keeps the recorded foreign statusline (with shell) when installing a second time", () => {
    const e = setupEnv({ gitBash: () => "C:\\dev\\tools\\Git\\bin\\bash.exe" });
    writeSettings(
      e.home,
      JSON.stringify({
        statusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 1 },
      }),
    );
    install(e);
    const config = join(e.home, ".vibetribe", "config.json");
    const recorded = {
      command: "~/.claude/statusline.sh",
      padding: 1,
      shell: "C:/dev/tools/Git/bin/bash.exe",
    };
    expect(readJson(config).previousStatusline).toEqual(recorded);
    install({ ...e, now: new Date(Date.UTC(2026, 9, 10, 19, 0, 0)) });
    expect(readJson(config).previousStatusline).toEqual(recorded);
  });

  it("keeps an existing token", () => {
    const e = setupEnv();
    mkdirSync(join(e.home, ".vibetribe"));
    writeFileSync(join(e.home, ".vibetribe", "token"), "existing");
    install(e);
    expect(readFileSync(join(e.home, ".vibetribe", "token"), "utf8")).toBe("existing");
  });

  it("aborts without writing when settings.json is not valid JSON", () => {
    const e = setupEnv();
    writeSettings(e.home, "{ // comment\n}");
    expect(() => install(e)).toThrow(SetupError);
    expectUntouched(e.home, "{ // comment\n}");
  });

  it.each(["null", "[]", '"x"', "5"])("aborts without writing when settings.json is %s", (raw) => {
    const e = setupEnv();
    writeSettings(e.home, raw);
    expect(() => install(e)).toThrow(SetupError);
    expectUntouched(e.home, raw);
  });

  it.each([
    ["hooks is an array", { hooks: [] }],
    ["a hook event is not an array", { hooks: { Stop: {} } }],
    ["statusLine is a string", { statusLine: "ccusage" }],
    ["statusLine has no command", { statusLine: { type: "command" } }],
  ])("aborts with SetupError and writes nothing when %s", (_name, value) => {
    const e = setupEnv();
    const raw = JSON.stringify(value);
    writeSettings(e.home, raw);
    expect(() => install(e)).toThrow(SetupError);
    expect(() => install(e)).toThrow(/nothing was changed\.?$/);
    expectUntouched(e.home, raw);
  });
});

describe("install on wsl", () => {
  it("uses the token from the Windows home", () => {
    const winHome = mkdtempSync(join(tmpdir(), "vt-win-"));
    mkdirSync(join(winHome, ".vibetribe"));
    writeFileSync(join(winHome, ".vibetribe", "token"), "wintoken");
    const e = setupEnv({
      platform: "linux",
      wsl: true,
      nodePath: "/usr/bin/node",
      windowsHome: winHome,
    });
    install(e);
    expect(readJson(join(e.home, ".vibetribe", "config.json")).tokenPath).toBe(
      join(winHome, ".vibetribe", "token"),
    );
    expect(existsSync(join(e.home, ".vibetribe", "token"))).toBe(false);
  });

  it("fails clearly when setup has not run on Windows yet, writing nothing", () => {
    const e = setupEnv({
      platform: "linux",
      wsl: true,
      nodePath: "/usr/bin/node",
      windowsHome: mkdtempSync(join(tmpdir(), "vt-win-")),
    });
    expect(() => install(e)).toThrow(/Windows/);
    expect(existsSync(join(e.home, ".vibetribe"))).toBe(false);
    expect(existsSync(join(e.home, ".claude"))).toBe(false);
  });
});

describe("backups", () => {
  it("never overwrites a backup written in the same second", () => {
    const e = setupEnv();
    writeSettings(e.home, JSON.stringify({ model: "opus" }));
    install(e);
    uninstall(e);
    const backups = readdirSync(join(e.home, ".claude"))
      .filter((f) => f.includes(".bak"))
      .sort();
    expect(backups).toEqual([
      "settings.json.vibetribe-20261010183005-1.bak",
      "settings.json.vibetribe-20261010183005.bak",
    ]);
    expect(readJson(join(e.home, ".claude", backups[1] as string))).toEqual({ model: "opus" });
  });
});

describe("uninstall", () => {
  it("removes only VibeTribe entries and restores the previous statusline", () => {
    const e = setupEnv();
    const foreign = { matcher: "Bash", hooks: [{ type: "command", command: "python3 x.py" }] };
    writeSettings(
      e.home,
      JSON.stringify({
        hooks: { PreToolUse: [foreign] },
        statusLine: { type: "command", command: "ccusage", padding: 0 },
      }),
    );
    install(e);
    uninstall({ ...e, now: new Date(Date.UTC(2026, 9, 10, 19, 0, 0)) });
    expect(readJson(settingsPath(e.home))).toEqual({
      hooks: { PreToolUse: [foreign] },
      statusLine: { type: "command", command: "ccusage", padding: 0 },
    });
  });

  it("does nothing without settings.json", () => {
    const e = setupEnv();
    uninstall(e);
    expect(existsSync(settingsPath(e.home))).toBe(false);
  });

  it.each(["null", "[]", "{ nope"])("aborts without writing when settings.json is %s", (raw) => {
    const e = setupEnv();
    writeSettings(e.home, raw);
    expect(() => uninstall(e)).toThrow(SetupError);
    expectUntouched(e.home, raw);
  });
});

const posix = process.platform !== "win32";

describe("install: exact bytes and path hygiene", () => {
  it("backs up the original byte for byte (tabs, CRLF, odd spacing)", () => {
    const e = setupEnv();
    const raw = '{\r\n\t"model" :   "opus",\r\n\t"x":[1,\t2]\r\n}\r\n  ';
    writeSettings(e.home, raw);
    install(e);
    const backup = `${settingsPath(e.home)}.vibetribe-20261010183005.bak`;
    expect(readFileSync(backup, "utf8")).toBe(raw);
  });

  it("writes no backslash into hook args or the statusline command", () => {
    // a backslash in the home name stands in for a Windows-style path on this POSIX host
    const e = setupEnv({
      home: mkdtempSync(join(tmpdir(), "vt\\win-")),
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
    });
    install(e);
    const s = readJson(settingsPath(e.home));
    const hook = s.hooks.Stop[0].hooks[0];
    expect(hook.command).not.toContain("\\");
    expect(hook.args[0]).not.toContain("\\");
    expect(s.statusLine.command).not.toContain("\\");
  });

  it("strips a leading UTF-8 BOM before parsing and writes none", () => {
    const e = setupEnv();
    writeSettings(e.home, `\uFEFF${JSON.stringify({ model: "opus" })}`);
    install(e);
    const written = readFileSync(settingsPath(e.home), "utf8");
    expect(written.charCodeAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(written).model).toBe("opus");
  });

  it("treats an empty settings.json as {}", () => {
    const e = setupEnv();
    writeSettings(e.home, "");
    install(e);
    expect(readJson(settingsPath(e.home)).hooks.Stop).toBeDefined();
  });
});

describe("install: token", () => {
  it.skipIf(!posix)("creates the token with mode 0600 and never logs its value", () => {
    const e = setupEnv({ randomToken: () => "s3cr3t-token-value" });
    install(e);
    const token = join(e.home, ".vibetribe", "token");
    expect(statSync(token).mode & 0o777).toBe(0o600);
    expect(e.lines.join("\n")).not.toContain("s3cr3t-token-value");
  });

  it("generates a 64-char hex token by default", () => {
    const e = setupEnv({ randomToken: undefined });
    install(e);
    expect(readFileSync(join(e.home, ".vibetribe", "token"), "utf8")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("regenerates an empty or whitespace-only token on Windows", () => {
    const e = setupEnv();
    mkdirSync(join(e.home, ".vibetribe"));
    writeFileSync(join(e.home, ".vibetribe", "token"), " \n");
    install(e);
    expect(readFileSync(join(e.home, ".vibetribe", "token"), "utf8")).toBe("a".repeat(64));
  });

  it("fails on WSL when the Windows token is empty, writing nothing", () => {
    const winHome = mkdtempSync(join(tmpdir(), "vt-win-"));
    mkdirSync(join(winHome, ".vibetribe"));
    writeFileSync(join(winHome, ".vibetribe", "token"), "\n");
    const e = setupEnv({ platform: "linux", wsl: true, windowsHome: winHome });
    expect(() => install(e)).toThrow(/token empty, run setup on Windows first/);
    expect(existsSync(join(e.home, ".vibetribe"))).toBe(false);
  });
});

describe("install: platform and files", () => {
  it("fails on WSL without a Windows home, writing nothing", () => {
    const e = setupEnv({ platform: "linux", wsl: true, windowsHome: null });
    expect(() => install(e)).toThrow(SetupError);
    expect(existsSync(join(e.home, ".vibetribe"))).toBe(false);
    expect(existsSync(join(e.home, ".claude"))).toBe(false);
  });

  it("refuses a ~/.claude that is not a directory, writing nothing", () => {
    const e = setupEnv();
    writeFileSync(join(e.home, ".claude"), "a file");
    expect(() => install(e)).toThrow(SetupError);
    expect(() => install(e)).toThrow(/not a directory; nothing was changed/);
    expect(readFileSync(join(e.home, ".claude"), "utf8")).toBe("a file");
    expect(existsSync(join(e.home, ".vibetribe"))).toBe(false);
  });

  it("refuses Linux without WSL", () => {
    const e = setupEnv({ platform: "linux", wsl: false, windowsHome: "/mnt/c/Users/x" });
    expect(() => install(e)).toThrow(/supports Windows and WSL only/);
    expect(existsSync(join(e.home, ".vibetribe"))).toBe(false);
  });

  it("warns when a displaced statusline will run without Git Bash on Windows", () => {
    const e = setupEnv({ gitBash: () => null });
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "ccusage" } }));
    install(e);
    expect(e.lines.some((l) => /Git Bash.*default shell/.test(l))).toBe(true);
  });

  it("does not warn about Git Bash when nothing was displaced", () => {
    const e = setupEnv({ gitBash: () => null });
    install(e);
    expect(e.lines.some((l) => /Git Bash/.test(l))).toBe(false);
  });

  it("leaves no temp file behind and does not rewrite an unchanged config", () => {
    const e = setupEnv();
    install(e);
    const dir = join(e.home, ".vibetribe");
    expect(readdirSync(dir).sort()).toEqual(["config.json", "reporter.mjs", "token"]);
    const config = join(dir, "config.json");
    const old = new Date(Date.UTC(2020, 0, 1));
    utimesSync(config, old, old);
    install(e);
    expect(statSync(config).mtimeMs).toBe(old.getTime());
    expect(readdirSync(dir).sort()).toEqual(["config.json", "reporter.mjs", "token"]);
  });
});

describe("previousStatusline lifecycle", () => {
  const configOf = (home: string) => readJson(join(home, ".vibetribe", "config.json"));

  it("a re-run records Git Bash for a statusline displaced while Git was missing", () => {
    const e = setupEnv({ gitBash: () => null });
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "ccusage" } }));
    install(e);
    expect(configOf(e.home).previousStatusline).toEqual({ command: "ccusage" });
    install({ ...e, gitBash: () => "C:\\Git\\bin\\bash.exe" });
    expect(configOf(e.home).previousStatusline).toEqual({
      command: "ccusage",
      shell: "C:/Git/bin/bash.exe",
    });
  });

  it("a re-run follows Git Bash to its new place", () => {
    const e = setupEnv({ gitBash: () => "C:\\Git\\bin\\bash.exe" });
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "ccusage" } }));
    install(e);
    install({ ...e, gitBash: () => "D:\\Tools\\Git\\bin\\bash.exe" });
    expect(configOf(e.home).previousStatusline.shell).toBe("D:/Tools/Git/bin/bash.exe");
  });

  it("a re-run without Git Bash drops the recorded shell, as its warning says", () => {
    const e = setupEnv({ gitBash: () => "C:\\Git\\bin\\bash.exe" });
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "ccusage" } }));
    install(e);
    install({ ...e, gitBash: () => null });
    expect(configOf(e.home).previousStatusline).toEqual({ command: "ccusage" });
    expect(e.lines.some((l) => /Git Bash not found/.test(l))).toBe(true);
  });

  it("restores a previous statusline with an empty command on uninstall", () => {
    const e = setupEnv();
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "" } }));
    install(e);
    uninstall(e);
    expect(readJson(settingsPath(e.home)).statusLine).toEqual({ type: "command", command: "" });
  });

  it("does not resurrect a stale previous statusline after the user deleted it", () => {
    const e = setupEnv();
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "X" } }));
    install(e);
    uninstall({ ...e, now: new Date(Date.UTC(2026, 9, 10, 19, 0, 0)) });
    expect(readJson(settingsPath(e.home)).statusLine.command).toBe("X");
    const restored = readJson(settingsPath(e.home));
    delete restored.statusLine;
    writeSettings(e.home, JSON.stringify(restored));
    install({ ...e, now: new Date(Date.UTC(2026, 9, 10, 20, 0, 0)) });
    uninstall({ ...e, now: new Date(Date.UTC(2026, 9, 10, 21, 0, 0)) });
    expect(readJson(settingsPath(e.home)).statusLine).toBeUndefined();
  });
});

describe("uninstall: edge cases", () => {
  it("says so when our statusline is removed without a recorded previous one", () => {
    const e = setupEnv();
    install(e);
    uninstall(e);
    expect(e.lines).toContain("no previous statusline recorded – statusLine removed");
    expect(readJson(settingsPath(e.home)).statusLine).toBeUndefined();
  });

  it("says so when config.json is missing or garbled", () => {
    for (const garbage of [null, "{ nope"]) {
      const e = setupEnv();
      install(e);
      const config = join(e.home, ".vibetribe", "config.json");
      if (garbage === null) rmSync(config);
      else writeFileSync(config, garbage);
      uninstall(e);
      expect(e.lines).toContain("no previous statusline recorded – statusLine removed");
    }
  });

  it("does not say it when a previous statusline is restored", () => {
    const e = setupEnv();
    writeSettings(e.home, JSON.stringify({ statusLine: { type: "command", command: "X" } }));
    install(e);
    uninstall(e);
    expect(e.lines.some((l) => l.includes("no previous statusline"))).toBe(false);
  });

  it("creates no backup and changes no bytes for a foreign-only file, twice", () => {
    const e = setupEnv();
    const raw = '{\n\t"model":   "opus"\n}\n';
    writeSettings(e.home, raw);
    uninstall(e);
    uninstall({ ...e, now: new Date(Date.UTC(2026, 9, 10, 19, 0, 0)) });
    expectUntouched(e.home, raw);
  });
});
