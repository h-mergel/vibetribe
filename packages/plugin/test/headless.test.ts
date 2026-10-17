import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FALLBACK_PORTS } from "@vibetribe/hub";
import { DEFAULT_PORT } from "@vibetribe/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { RunningVibeTribe } from "../src/compose";
import { HEADLESS_PORT, headlessConfig, startHeadless } from "../src/headless";
import { freePort } from "./helpers";

describe("headlessConfig", () => {
  it("defaults to 43799", () => {
    expect(headlessConfig({}).port).toBe(HEADLESS_PORT);
    expect(headlessConfig({}).warning).toBeNull();
  });

  it("falls back to 43799 (not the real hub port) on an invalid VIBETRIBE_PORT", () => {
    const c = headlessConfig({ VIBETRIBE_PORT: "banana" });
    expect(c.port).toBe(43799);
    expect(c.warning).toMatch(/43799/);
  });

  it.each([DEFAULT_PORT, ...FALLBACK_PORTS])("refuses port %i of the real hub", (port) => {
    expect(() => headlessConfig({ VIBETRIBE_PORT: String(port) })).toThrow(`port ${port} belongs`);
  });

  it("takes a valid custom port, the token and VIBETRIBE_MAX_FRAMES like the plugin", () => {
    const c = headlessConfig({
      VIBETRIBE_PORT: "43801",
      VIBETRIBE_TOKEN: "abc",
      VIBETRIBE_MAX_FRAMES: "4",
    });
    expect([c.port, c.token, c.maxFramesPerSecond]).toEqual([43801, "abc", 4]);
    expect(headlessConfig({ VIBETRIBE_MAX_FRAMES: "x" }).maxFramesPerSecond).toBe(10);
    expect(headlessConfig({}).token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("takes VIBETRIBE_VARIANT like the plugin, default comfortable", () => {
    expect(headlessConfig({}).variant).toBe("comfortable");
    expect(headlessConfig({ VIBETRIBE_VARIANT: "compact" }).variant).toBe("compact");
  });
});

describe("startHeadless", () => {
  let dir = "";
  let app: RunningVibeTribe | null = null;
  afterEach(async () => {
    await app?.stop();
    app = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const io = (cwd: string) => {
    const logs: string[] = [];
    const printed: string[] = [];
    return {
      cwd,
      logs,
      printed,
      log: (l: string) => logs.push(l),
      print: (t: string) => printed.push(t),
    };
  };

  it("writes a 0600 token file per port after listening and prints the simulate command", async () => {
    dir = mkdtempSync(join(tmpdir(), "vt-headless-"));
    const sink = io(dir);
    const port = await freePort();
    app = await startHeadless({ VIBETRIBE_PORT: String(port), VIBETRIBE_TOKEN: "tok" }, sink);
    expect(app?.port).toBe(port);
    const file = join(dir, "out", `headless-token-${port}`);
    expect(readFileSync(file, "utf8")).toBe("tok");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const banner = sink.printed.join("");
    expect(banner).toContain(`http://127.0.0.1:${port}/debug/keys`);
    expect(banner).toContain(`pnpm hub:simulate`);
    expect(banner).toContain(`--url http://127.0.0.1:${port}`);
    expect(banner).toContain(`--token-file ${file}`);
  });

  it("on a taken port prints the error, returns null and writes no token file or banner", async () => {
    dir = mkdtempSync(join(tmpdir(), "vt-headless-"));
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const taken = (blocker.address() as { port: number }).port;
    try {
      const sink = io(dir);
      app = await startHeadless({ VIBETRIBE_PORT: String(taken), VIBETRIBE_TOKEN: "tok" }, sink);
      expect(app).toBeNull();
      expect(sink.logs.join("\n")).toContain(`Port ${taken} in use`);
      expect(sink.printed).toEqual([]);
      expect(existsSync(join(dir, "out"))).toBe(false);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
