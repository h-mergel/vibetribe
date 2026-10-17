import { execFileSync, type SpawnOptions, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { RunCommand } from "./refresh";

/** First real executable from `where.exe claude` output; .cmd shims cannot run without a shell. */
export function pickClaudeExe(whereOutput: string): string | null {
  return (
    whereOutput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().endsWith(".exe")) ?? null
  );
}

/** Leading semver of `claude --version` output, or null (the version ends up in a header). */
export function parseClaudeVersion(output: string): string | null {
  return /^\d+\.\d+\.\d+/.exec(output.trim())?.[0] ?? null;
}

const OVERRIDES = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]);

/**
 * The refresh must use the CLI's own login, never an API key or token from the hub's environment.
 * Windows env names are case-insensitive, so are the overrides. ANTHROPIC_BASE_URL stays on purpose.
 */
export function refreshEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !OVERRIDES.has(k.toUpperCase())));
}

export function findClaudeExe(): string | null {
  try {
    return pickClaudeExe(
      execFileSync("where.exe", ["claude"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

/**
 * `claude --version` with stdin ignored and a 10 s timeout. Resolves the stdout; rejects on spawn
 * failure, timeout (the child is killed) or non-zero exit.
 */
export function runClaudeVersion(exe: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let out = "";
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude --version exited with ${code}`));
    });
  });
}

export interface RunnerChild {
  once(event: "error", listener: (err: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type SpawnFn = (file: string, args: string[], opts: SpawnOptions) => RunnerChild;

const RUN_TIMEOUT_MS = 120_000;

/**
 * Runs claude.exe directly: no shell (so the timeout reaches claude itself), stdin closed (a CLI
 * waiting on stdin would hang), neutral working dir. True = exit code 0.
 */
export function claudeRunner(
  exe: string,
  spawnImpl: SpawnFn = (f, a, o) => spawn(f, a, o),
): RunCommand {
  return (args) =>
    new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      let child: ReturnType<SpawnFn>;
      try {
        child = spawnImpl(exe, args, {
          cwd: tmpdir(),
          env: refreshEnv(process.env),
          shell: false,
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: true,
        });
      } catch {
        return done(false);
      }
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // already gone
        }
        done(false);
      }, RUN_TIMEOUT_MS);
      child.once("error", () => done(false));
      child.once("close", (code) => done(code === 0));
    });
}
