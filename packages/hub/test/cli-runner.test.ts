import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeRunner, parseClaudeVersion, refreshEnv } from "../src/usage/cli";

afterEach(() => vi.useRealTimers());

class FakeChild extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
    return true;
  }
}

function fakeSpawn() {
  const calls: { file: string; args: string[]; opts: SpawnOptions }[] = [];
  const child = new FakeChild();
  const spawn = (file: string, args: string[], opts: SpawnOptions) => {
    calls.push({ file, args, opts });
    return child;
  };
  return { spawn, calls, child };
}

describe("claudeRunner", () => {
  it("spawns without shell, stdin ignored, neutral cwd and stripped env", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "secret");
    vi.stubEnv("anthropic_auth_token", "secret");
    const { spawn, calls, child } = fakeSpawn();
    const p = claudeRunner("C:\\claude.exe", spawn)(["-p", "x"]);
    child.emit("close", 0);
    expect(await p).toBe(true);
    vi.unstubAllEnvs();
    expect(calls).toHaveLength(1);
    const { file, args, opts } = calls[0] ?? { file: "", args: [], opts: {} };
    expect(file).toBe("C:\\claude.exe");
    expect(args).toEqual(["-p", "x"]);
    expect(opts.cwd).toBe(tmpdir());
    expect(opts.stdio).toEqual(["ignore", "ignore", "ignore"]);
    expect(opts.shell).toBe(false);
    expect(opts.windowsHide).toBe(true);
    const env = opts.env as Record<string, string>;
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain("ANTHROPIC_AUTH_TOKEN");
  });

  it("resolves false on a non-zero exit and on a spawn error", async () => {
    const a = fakeSpawn();
    const pa = claudeRunner("c", a.spawn)([]);
    a.child.emit("close", 1);
    expect(await pa).toBe(false);
    const b = fakeSpawn();
    const pb = claudeRunner("c", b.spawn)([]);
    b.child.emit("error", new Error("ENOENT"));
    expect(await pb).toBe(false);
  });

  it("resolves false when spawn throws synchronously", async () => {
    const run = claudeRunner("c", () => {
      throw new Error("boom");
    });
    expect(await run([])).toBe(false);
  });

  it("kills the child and resolves false after the 120 s timeout", async () => {
    vi.useFakeTimers();
    const { spawn, child } = fakeSpawn();
    const p = claudeRunner("c", spawn)([]);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(child.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(child.killed).toBe(true);
    expect(await p).toBe(false);
  });
});

describe("refreshEnv", () => {
  it("strips case-insensitively but keeps ANTHROPIC_BASE_URL", () => {
    expect(
      refreshEnv({
        anthropic_api_key: "k",
        Claude_Code_Oauth_Token: "o",
        ANTHROPIC_BASE_URL: "http://proxy",
        PATH: "p",
      }),
    ).toEqual({ ANTHROPIC_BASE_URL: "http://proxy", PATH: "p" });
  });
});

describe("parseClaudeVersion", () => {
  it("accepts a leading semver and falls back otherwise", () => {
    expect(parseClaudeVersion("2.1.300 (Claude Code)\n")).toBe("2.1.300");
    expect(parseClaudeVersion("garbage; rm -rf")).toBeNull();
    expect(parseClaudeVersion("")).toBeNull();
  });
});
