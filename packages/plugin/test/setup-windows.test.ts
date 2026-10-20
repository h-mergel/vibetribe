import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { windowsSetup } from "../src/setup/windows";

/** A temporary profile and a fake Stream Deck node: never the real one. */
function setup(source = "// reporter") {
  const home = mkdtempSync(join(tmpdir(), "vt-pi-home-"));
  const nodePath = join(mkdtempSync(join(tmpdir(), "vt-pi-node-")), "node.exe");
  writeFileSync(nodePath, "node");
  const lines: string[] = [];
  const s = windowsSetup({
    home,
    reporterSource: source,
    nodePath,
    nodeVersion: "24.13.1",
    log: (l) => lines.push(l),
    gitBash: () => null,
    now: () => new Date(Date.UTC(2026, 9, 18)),
  });
  return { s, home, lines };
}

describe("windowsSetup", () => {
  it("installs the hooks with a copy of the plugin's node and reads them back as installed", () => {
    const { s, home } = setup();
    expect(s.state()).toBe("missing");
    expect(s.install()).toEqual({ ok: true, text: "Hooks installed for Claude Code on Windows." });
    expect(s.state()).toBe("installed");
    expect(readFileSync(join(home, ".vibetribe", "node-24.13.1.exe"), "utf8")).toBe("node");
    expect(readFileSync(join(home, ".vibetribe", "reporter.mjs"), "utf8")).toBe("// reporter");
  });

  it("removes the hooks again", () => {
    const { s, home } = setup();
    s.install();
    expect(s.uninstall()).toEqual({ ok: true, text: "Hooks removed from Claude Code on Windows." });
    expect(s.state()).toBe("missing");
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings).toEqual({});
  });

  it("reports a broken settings.json as text and changes nothing", () => {
    const { s, home, lines } = setup();
    mkdirSync(join(home, ".claude"));
    writeFileSync(join(home, ".claude", "settings.json"), "{ nope");
    const result = s.install();
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/settings\.json is not valid JSON .*nothing was changed\.$/);
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe("{ nope");
    expect(lines.at(-1)).toMatch(/^setup failed: /);
  });

  it("reports an unexpected failure as text instead of throwing", () => {
    const { s, home } = setup();
    writeFileSync(join(home, ".vibetribe"), "a file where the folder belongs");
    const result = s.install();
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/^Setup failed: Error: (EEXIST|ENOTDIR)/);
  });
});
