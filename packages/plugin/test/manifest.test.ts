import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_UUIDS, PLUGIN_UUID } from "../src/ids";
import { PREFER_PINNED_KEY } from "../src/settings";
import { freePort } from "./helpers";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const dir = join(pkg, `${PLUGIN_UUID}.sdPlugin`);
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
  UUID: string;
  SDKVersion: number;
  CodePath: string;
  Icon: string;
  CategoryIcon: string;
  Nodejs: { Version: string };
  Version: string;
  Software: { MinimumVersion: string };
  OS: { Platform: string }[];
  Actions: {
    UUID: string;
    Icon: string;
    Controllers: string[];
    SupportedInMultiActions: boolean;
    States: { Image: string }[];
    UserTitleEnabled: boolean;
    PropertyInspectorPath?: string;
  }[];
};

describe("manifest", () => {
  it("names the plugin and exactly the actions the code registers", () => {
    expect(manifest.UUID).toBe(PLUGIN_UUID);
    expect(manifest.SDKVersion).toBe(3);
    expect(manifest.Nodejs.Version).toBe("24");
    expect(manifest.CodePath).toBe("bin/plugin.js");
    expect(new Set(manifest.Actions.map((a) => a.UUID))).toEqual(
      new Set(Object.values(ACTION_UUIDS)),
    );
    expect(manifest.Actions).toHaveLength(Object.keys(ACTION_UUIDS).length);
    expect(new Set(manifest.Actions.map((a) => a.UUID)).size).toBe(manifest.Actions.length);
    expect(manifest.Version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(manifest.Software.MinimumVersion).toBe("7.1");
    expect(manifest.OS.some((o) => o.Platform === "windows")).toBe(true);
    for (const a of manifest.Actions) {
      expect(a.Controllers).toEqual(["Keypad"]);
      expect(a.SupportedInMultiActions).toBe(false);
      expect(a.UserTitleEnabled).toBe(false);
      expect(existsSync(join(dir, `${a.Icon}.svg`))).toBe(true);
      for (const s of a.States) expect(existsSync(join(dir, `${s.Image}.svg`))).toBe(true);
    }
    expect(existsSync(join(dir, `${manifest.CategoryIcon}.svg`))).toBe(true);
    expect(existsSync(join(dir, `${manifest.Icon}.svg`))).toBe(true);
  });
});

describe("property inspector", () => {
  it("only the session slot has one: a local page that saves the preference for pinned sessions", () => {
    const inspected = manifest.Actions.filter((a) => a.PropertyInspectorPath !== undefined);
    expect(inspected.map((a) => a.UUID)).toEqual([ACTION_UUIDS.slot]);
    const html = readFileSync(join(dir, inspected[0]?.PropertyInspectorPath ?? ""), "utf8");
    expect(html).toContain("Prefer pinned sessions");
    expect(html).toContain("window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent) =>");
    expect(html).toContain(`const KEY = "${PREFER_PINNED_KEY}";`);
    // unticked only when saved as false: the same default as the plugin
    expect(html).toContain("box.checked = settings[KEY] !== false;");
    expect(html).toContain('event: "setGlobalSettings"');
    // works offline: nothing loads from elsewhere, the only URL is the Stream Deck socket
    expect(html).not.toMatch(/\b(src|href)\s*=/);
    expect(html.match(/\w+:\/\/[\w.]+/g)).toEqual(["ws://127.0.0.1"]);
  });
});

describe("bundle", () => {
  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        const b = spawn(process.execPath, ["build.mjs"], { cwd: pkg });
        let stderr = "";
        b.stderr.setEncoding("utf8").on("data", (c: string) => {
          stderr += c;
        });
        b.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
      }),
    60_000,
  );

  it("is one ESM file with the SDK inside, without resvg, plus the PNG icons at 256 and 512", () => {
    const js = readFileSync(join(dir, "bin", "plugin.js"), "utf8");
    expect(js).toContain(`"${PLUGIN_UUID}"`);
    expect(js).toContain('"setImage"');
    // ws (CommonJS inside the SDK) must find a working require for node built-ins
    expect(js.startsWith('import { createRequire as __createRequire } from "node:module";')).toBe(
      true,
    );
    expect(js).not.toContain("resvg");
    expect(js).not.toMatch(/from\s+["']@vibetribe/);
    expect(JSON.parse(readFileSync(join(dir, "bin", "package.json"), "utf8"))).toEqual({
      type: "module",
    });
    for (const [name, width] of [
      [`${manifest.Icon}.png`, 256],
      [`${manifest.Icon}@2x.png`, 512],
    ] as const) {
      const png = readFileSync(join(dir, name));
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      // IHDR width at byte 16
      expect(png.readUInt32BE(16)).toBe(width);
    }
  });
});

const until = async (check: () => boolean, ms: number, what: string): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("bundle at runtime", () => {
  const children: ChildProcess[] = [];
  const scratch: string[] = [];
  afterEach(() => {
    for (const c of children.splice(0)) c.kill();
    for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** Runs bin/plugin.js of `pluginDir` with scratch profile dirs, a free hub port and no Stream Deck. */
  async function run(pluginDir: string) {
    const root = mkdtempSync(join(tmpdir(), "vibetribe-smoke-"));
    scratch.push(root);
    const hubPort = await freePort();
    const sdPort = await freePort(); // nothing listens there: the SDK connect is refused
    const child = spawn(
      process.execPath,
      [
        join(pluginDir, "bin", "plugin.js"),
        "-port",
        String(sdPort),
        "-pluginUUID",
        "x",
        "-registerEvent",
        "registerPlugin",
        "-info",
        JSON.stringify({
          application: {
            platform: "windows",
            version: "7.6.0",
            language: "de",
            platformVersion: "10",
          },
          plugin: { uuid: PLUGIN_UUID, version: "0.1.0.0" },
          devicePixelRatio: 2,
          colors: {},
          devices: [],
        }),
      ],
      {
        env: {
          ...process.env,
          APPDATA: root,
          LOCALAPPDATA: root,
          HOME: root,
          USERPROFILE: root,
          VIBETRIBE_PORT: String(hubPort),
          VIBETRIBE_WSL_DISTRO: "nonexistent",
        },
      },
    );
    children.push(child);
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      stderr += c;
    });
    const exit = new Promise<number | null>((r) => child.on("close", (code) => r(code)));
    const logText = (): string => {
      try {
        return readFileSync(join(root, "vibetribe", "logs", "plugin.log"), "utf8");
      } catch {
        return "";
      }
    };
    return { child, exit, hubPort, stderr: () => stderr, logText };
  }

  it("starts: the hub listens and nothing complains about a dynamic require", async () => {
    const p = await run(dir);
    await until(() => p.logText().includes("hub listening"), 10_000, "hub listening");
    p.child.kill();
    expect(p.stderr()).not.toContain("Dynamic require");
    expect(p.logText()).not.toContain("Dynamic require");
  }, 20_000);

  it("exits non-zero and frees the hub port when the SDK connection fails during startup", async () => {
    const p = await run(dir);
    const code = await Promise.race([
      p.exit,
      new Promise<string>((r) => setTimeout(() => r("still running"), 10_000)),
    ]);
    expect(code).toBe(1);
    expect(p.logText()).toContain("startup failed");
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.on("error", reject);
      s.listen(p.hubPort, "127.0.0.1", () => s.close(() => resolve()));
    });
  }, 20_000);
});
