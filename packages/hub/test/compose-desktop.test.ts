import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopDirs, windowsHubConfig } from "../src/compose";
import { skipped } from "../src/doctor/check";
import { desktopConfigFiles } from "../src/pins/desktop";

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

describe("Claude Desktop files", () => {
  const noExe = () => null;

  it("looks for Claude Desktop's config in Claude-Data first, then in its MSIX package, then under %APPDATA%\\Claude", () => {
    const data = ["Claude-Data", "claude_pzs8sxrjxfjjc", "claude_desktop_config.json"];
    const msix = ["Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming"];
    const file = ["Claude", "claude_desktop_config.json"];
    const configs = (env: NodeJS.ProcessEnv) => desktopConfigFiles(desktopDirs(env, "C:\\H"));
    expect(configs({ LOCALAPPDATA: "C:\\L", APPDATA: "C:\\A" })).toEqual([
      join("C:\\L", ...data),
      join("C:\\L", ...msix, ...file),
      join("C:\\A", ...file),
    ]);
    expect(configs({})).toEqual([
      join("C:\\H", "AppData", "Local", ...data),
      join("C:\\H", "AppData", "Local", ...msix, ...file),
      join("C:\\H", "AppData", "Roaming", ...file),
    ]);
  });

  it("reads the pins from Claude Desktop's config under the given profile", async () => {
    const home = temp();
    const appdata = join(home, "Roaming");
    mkdirSync(join(appdata, "Claude"), { recursive: true });
    const prefs = { epitaxyPrefs: { "dframe-local-slice": { pinnedOrder: ["code:local_x"] } } };
    writeFileSync(
      join(appdata, "Claude", "claude_desktop_config.json"),
      JSON.stringify({ preferences: prefs }),
    );
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env: { APPDATA: appdata, LOCALAPPDATA: join(home, "Local") },
      token: "t",
      findExe: noExe,
    });
    expect(await config.pins?.()).toEqual(["local_x"]);
  });

  it("reads the focus from Claude Desktop's session files, in its MSIX package and under %APPDATA%\\Claude", async () => {
    const home = temp();
    const env = { APPDATA: join(home, "Roaming"), LOCALAPPDATA: join(home, "Local") };
    const msix = join(
      env.LOCALAPPDATA,
      "Packages",
      "Claude_pzs8sxrjxfjjc",
      "LocalCache",
      "Roaming",
    );
    const write = (claude: string, id: string, lastFocusedAt: number) => {
      const dir = join(claude, "Claude", "claude-code-sessions", "ws", "acct");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ sessionId: id, lastFocusedAt }));
    };
    write(msix, "local_m", 1_000);
    write(env.APPDATA, "local_c", 2_000);
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env,
      token: "t",
      findExe: noExe,
    });
    expect(await config.focus?.(["local_m", "local_c", "local_x"])).toEqual(
      new Map([
        ["local_m", 1_000],
        ["local_c", 2_000],
      ]),
    );
  });

  it("checks Claude Desktop's files and the port file for the hourly self-check", async () => {
    const home = temp();
    const env = { APPDATA: join(home, "Roaming"), LOCALAPPDATA: join(home, "Local") };
    const data = join(env.LOCALAPPDATA, "Claude-Data", "claude_pzs8sxrjxfjjc");
    const account = join(data, "claude-code-sessions", "ws", "acct");
    mkdirSync(account, { recursive: true });
    const prefs = { epitaxyPrefs: { "dframe-local-slice": { pinnedOrder: [] } } };
    writeFileSync(join(data, "claude_desktop_config.json"), JSON.stringify({ preferences: prefs }));
    const session = { sessionId: "local_a", lastFocusedAt: Date.now() };
    writeFileSync(join(account, "local_a.json"), JSON.stringify(session));
    mkdirSync(join(home, ".vibetribe"));
    writeFileSync(join(home, ".vibetribe", "port"), "37710");
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env,
      token: "t",
      findExe: noExe,
    });
    expect((await config.drift?.(37710))?.map((r) => `${r.name}: ${r.outcome}`)).toEqual([
      "desktop folder: ok",
      "desktop pins: ok",
      "desktop session files: ok",
      "port file: ok",
    ]);
    expect((await config.drift?.(31710))?.at(-1)?.outcome).toBe("changed");
  });

  it("skips the port file in the self-check while it cannot be read", async () => {
    const home = temp();
    mkdirSync(join(home, ".vibetribe", "port"), { recursive: true });
    const { config } = await windowsHubConfig({
      log: () => {},
      home,
      env: { APPDATA: join(home, "Roaming"), LOCALAPPDATA: join(home, "Local") },
      token: "t",
      findExe: noExe,
    });
    expect((await config.drift?.(37710))?.at(-1)).toEqual(
      skipped("port file", "unreadable right now (EISDIR)"),
    );
  });
});
