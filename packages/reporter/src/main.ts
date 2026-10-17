import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { hubUrlOf, loadConfig, readToken } from "./config";
import { detectHost } from "./host";
import { runHook } from "./roles/hook";
import { type RunPrevious, runStatusline } from "./roles/statusline";
import { makePost } from "./send";

const HOOK_TIMEOUT_MS = 300;
const PREVIOUS_TIMEOUT_MS = 5_000;
const STDIN_TIMEOUT_MS = 1_000;
const USAGE = "usage: reporter.mjs hook | statusline | setup [--uninstall] [--windows-home <path>]";

/** Claude Code closes stdin after the JSON; if it does not, use what arrived within the budget. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const done = () => {
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(data);
    };
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

/**
 * Runs the user's previous statusline command through the shell Claude Code would use (Git Bash on
 * Windows, recorded by setup; otherwise the platform default). On timeout the partial output is
 * returned.
 */
const runPrevious: RunPrevious = (command, stdin, shell) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: shell ?? true,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let out = "";
    const timer = setTimeout(() => {
      // kill() reaches only the shell; a grandchild (`sleep 20 | cat`) can keep our stdout pipe
      // open. Let go of the pipes and unref the child so the reporter exits now.
      child.kill();
      child.stdout.destroy();
      child.stdin.destroy();
      child.unref();
      resolve(out);
    }, PREVIOUS_TIMEOUT_MS);
    // A command that ignores stdin closes its end first; the write then fails with EPIPE.
    child.stdin.on("error", () => {
      /* the output is what matters, not whether all of stdin was taken */
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
    child.stdin.end(stdin);
  });

interface SetupFlags {
  uninstall: boolean;
  windowsHome: string | null;
}

/** null = unknown flag, or --windows-home without a value */
function parseSetupFlags(flags: string[]): SetupFlags | null {
  const out: SetupFlags = { uninstall: false, windowsHome: null };
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "--uninstall") out.uninstall = true;
    else if (flag === "--windows-home") {
      const value = flags[++i];
      if (value === undefined || value.startsWith("--")) return null;
      out.windowsHome = value;
    } else return null;
  }
  return out;
}

/** Loaded on demand: the hook and statusline paths never touch the setup code. */
async function runSetup(flags: SetupFlags, home: string): Promise<number> {
  const { install, uninstall, SetupError } = await import("./setup/install");
  const { detectGitBash, detectWindowsHome, execText, isWsl } = await import("./setup/detect");
  const { platform, env } = process;
  const base = {
    home,
    platform,
    wsl: isWsl(env),
    nodePath: process.execPath,
    selfPath: process.argv[1] ?? "",
    now: new Date(),
    log: (line: string) => process.stdout.write(`${line}\n`),
    gitBash: () => detectGitBash({ platform, env, exists: existsSync, exec: execText }),
  };
  try {
    if (flags.uninstall) uninstall({ ...base, windowsHome: null });
    else {
      const windowsHome = flags.windowsHome ?? detectWindowsHome({ platform, env, exec: execText });
      install({ ...base, windowsHome });
    }
    return 0;
  } catch (err) {
    if (err instanceof SetupError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function main(argv: string[]): Promise<number> {
  const role = argv[0];
  const home = homedir();
  if (role === "hook" || role === "statusline") {
    const config = loadConfig(home);
    const post = makePost(hubUrlOf(config), readToken(config.tokenPath), HOOK_TIMEOUT_MS);
    const host = detectHost(process.platform, process.env, hostname());
    const stdin = await readStdin();
    if (role === "hook") {
      await runHook({ stdin, env: process.env, host, now: Date.now(), post });
      return 0;
    }
    const out = await runStatusline({
      stdin,
      env: process.env,
      host,
      now: Date.now(),
      post,
      previous: config.previousStatusline,
      runPrevious,
    });
    process.stdout.write(out);
    return 0;
  }
  if (role === "setup") {
    const flags = parseSetupFlags(argv.slice(1));
    if (flags) return runSetup(flags, home);
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

const role = process.argv[2];
main(process.argv.slice(2)).then(
  // exitCode instead of exit(): lets a pending stdout pipe flush (asynchronous on Windows)
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // hook and statusline must never fail Claude Code, nor print
    if (role === "hook" || role === "statusline") {
      process.exitCode = 0;
      return;
    }
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  },
);
