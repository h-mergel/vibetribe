import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureToken, install, type SetupEnv } from "../src/setup/install";
import { setupState } from "../src/setup/state";

const SOURCE = "// reporter bundle v2";

/** A Windows home and a fake node binary outside it, as the plugin passes them. */
function windows(over: Partial<SetupEnv> = {}): SetupEnv {
  const home = mkdtempSync(join(tmpdir(), "vt-state-"));
  const node = join(mkdtempSync(join(tmpdir(), "vt-node-")), "node.exe");
  writeFileSync(node, "node 24.13.1");
  return {
    home,
    platform: "win32",
    wsl: false,
    nodePath: node,
    copyNode: { version: "24.13.1" },
    reporterSource: SOURCE,
    windowsHome: null,
    now: new Date(Date.UTC(2026, 9, 18, 9, 0, 0)),
    randomToken: () => "b".repeat(64),
    log: () => {},
    gitBash: () => null,
    ...over,
  };
}

const settingsOf = (home: string) =>
  JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));

describe("install with a copied node", () => {
  it("copies the node binary under its version next to the reporter and lets every hook and the statusline run the copy", () => {
    const e = windows();
    install(e);
    const dir = join(e.home, ".vibetribe");
    const copy = join(dir, "node-24.13.1.exe").replaceAll("\\", "/");
    expect(readFileSync(join(dir, "node-24.13.1.exe"), "utf8")).toBe("node 24.13.1");
    expect(readFileSync(join(dir, "reporter.mjs"), "utf8")).toBe(SOURCE);
    const settings = settingsOf(e.home);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(copy);
    expect(settings.statusLine.command.startsWith(`"${copy}" `)).toBe(true);
  });

  it("never touches an existing copy of the same version: a running hook locks it", () => {
    const e = windows();
    install(e);
    writeFileSync(e.nodePath, "node 24.13.1, rebuilt");
    install(e);
    expect(readFileSync(join(e.home, ".vibetribe", "node-24.13.1.exe"), "utf8")).toBe(
      "node 24.13.1",
    );
  });

  it("moves the hooks to a new version, keeps the copy running sessions still use and removes the others it can", () => {
    const e = windows();
    install(e);
    const dir = join(e.home, ".vibetribe");
    // a copy still in use: on Windows it cannot be removed; a folder stands in for it here
    mkdirSync(join(dir, "node-20.20.0.exe", "in-use"), { recursive: true });
    writeFileSync(join(dir, "node-18.0.0.exe"), "node 18.0.0");
    writeFileSync(e.nodePath, "node 24.14.0");
    install({ ...e, copyNode: { version: "24.14.0" } });
    expect(
      readdirSync(dir)
        .filter((n) => n.startsWith("node"))
        .sort(),
    ).toEqual(["node-20.20.0.exe", "node-24.13.1.exe", "node-24.14.0.exe"]);
    expect(settingsOf(e.home).hooks.Stop[0].hooks[0].command).toBe(
      join(dir, "node-24.14.0.exe").replaceAll("\\", "/"),
    );
  });

  it("keeps the old copy when setup stops at an invalid settings.json", () => {
    const e = windows();
    install(e);
    writeFileSync(join(e.home, ".claude", "settings.json"), "{ nope");
    expect(() => install({ ...e, copyNode: { version: "24.14.0" } })).toThrow(/not valid JSON/);
    expect(readdirSync(join(e.home, ".vibetribe")).filter((n) => n.startsWith("node"))).toEqual([
      "node-24.13.1.exe",
    ]);
  });
});

describe("ensureToken", () => {
  it("creates the folder and the token, then keeps and returns it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "vt-token-")), ".vibetribe", "token");
    const lines: string[] = [];
    expect(
      ensureToken(
        path,
        (l) => lines.push(l),
        () => "c".repeat(64),
      ),
    ).toBe("c".repeat(64));
    expect(
      ensureToken(
        path,
        (l) => lines.push(l),
        () => "d".repeat(64),
      ),
    ).toBe("c".repeat(64));
    expect(readFileSync(path, "utf8")).toBe("c".repeat(64));
    expect(lines).toEqual([`created token ${path}`]);
  });
});

describe("setupState", () => {
  it("is missing without settings.json, installed after setup", () => {
    const e = windows();
    expect(setupState(e.home, SOURCE)).toBe("missing");
    install(e);
    expect(setupState(e.home, SOURCE)).toBe("installed");
  });

  it("is outdated when the reporter copy differs from the bundle", () => {
    const e = windows();
    install(e);
    expect(setupState(e.home, "// reporter bundle v3")).toBe("outdated");
    rmSync(join(e.home, ".vibetribe", "reporter.mjs"));
    expect(setupState(e.home, SOURCE)).toBe("outdated");
  });

  it("is outdated when the node the hooks run is gone", () => {
    const e = windows({ copyNode: undefined });
    install(e);
    expect(setupState(e.home, SOURCE)).toBe("installed");
    rmSync(e.nodePath);
    expect(setupState(e.home, SOURCE)).toBe("outdated");
  });

  it("is missing when one hook event or the statusline lacks our entry", () => {
    const e = windows();
    install(e);
    const path = join(e.home, ".claude", "settings.json");
    const settings = settingsOf(e.home);
    writeFileSync(path, JSON.stringify({ ...settings, statusLine: { command: "ccusage" } }));
    expect(setupState(e.home, SOURCE)).toBe("missing");
    const { PreCompact: _gone, ...hooks } = settings.hooks;
    writeFileSync(path, JSON.stringify({ ...settings, hooks }));
    expect(setupState(e.home, SOURCE)).toBe("missing");
  });

  it("is missing when settings.json is no JSON object", () => {
    const e = windows();
    mkdirSync(join(e.home, ".claude"));
    writeFileSync(join(e.home, ".claude", "settings.json"), "{ nope");
    expect(setupState(e.home, SOURCE)).toBe("missing");
  });
});
