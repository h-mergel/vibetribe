/**
 * `pnpm e2e:live --spend-tokens` (in WSL, opt-in): one real, tiny Claude Code turn on Haiku per
 * host with a CLI, in a throwaway folder, with the installed hooks, against the running hub. It
 * checks that claude ran Haiku without an API key and, through /debug/state.json, that the hooks
 * arrive, the deck shows the turn as Done, the session file has its shape and the session leaves
 * the deck at its end, and prints the cost.
 * Never part of `pnpm check` or CI; touches no project. A run killed before claude ends leaves
 * its session on the deck until the hub drops it as gone.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  type CheckResult,
  changed,
  formatResult,
  hasDrift,
  refreshEnv,
  skipped,
} from "@vibetribe/hub";
import { formatCost, parseTurnResult, RunObserver, type TurnResult } from "./e2e-observe";
import {
  findHub,
  hubState,
  portFileText,
  sessionFiles,
  windowsClaudeExe,
  windowsHome,
} from "./windows-side";

/** A host with a claude CLI: where it runs the turn and where its session files lie. */
interface Host {
  name: string;
  exe: string;
  tempRoot: string;
  sessionsDir: string;
}

const PROMPT = "Reply with the single word: ok";

/** Haiku, one cheap tool, no MCP, no skills, no transcript; the user settings keep the hooks. */
const claudeArgs = (sessionId: string): string[] => [
  "-p",
  "--model",
  "haiku",
  "--session-id",
  sessionId,
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--setting-sources",
  "user",
  "--strict-mcp-config",
  "--tools",
  "Read",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--max-budget-usd",
  "0.05",
  "--system-prompt",
  "Reply with exactly: ok",
];

/**
 * The child's environment on the WSL side: no API key, no model override, nothing that marks it as
 * started by another claude. A Windows claude.exe started from WSL gets the Windows environment.
 */
function childEnv(): NodeJS.ProcessEnv {
  const {
    CLAUDECODE: _code,
    CLAUDE_CODE_ENTRYPOINT: _entry,
    ANTHROPIC_MODEL: _model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: _haiku,
    ...env
  } = refreshEnv(process.env);
  return env;
}

/** Runs `step` every 250 ms until it returns true or `ms` passed. */
async function until(step: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await step()) return true;
    await sleep(250);
  }
  return false;
}

async function runTurn(host: Host, hubPort: number): Promise<CheckResult[]> {
  const sessionId = randomUUID();
  const observer = new RunObserver(sessionId);
  const run: { turn: TurnResult | null; exit: number | null } = { turn: null, exit: null };
  const started = Date.now();
  /** one look at the new session files and the hub; true while the hub lists the session */
  const look = async (): Promise<boolean> => {
    observer.sawFiles(await sessionFiles(host.sessionsDir, started), host.name);
    const state = await hubState(hubPort);
    return state !== null && observer.sawHub(state);
  };
  const cwd = mkdtempSync(join(host.tempRoot, "vibetribe-e2e-"));
  const results: CheckResult[] = [];
  try {
    const child = spawn(host.exe, claudeArgs(sessionId), {
      cwd,
      env: childEnv(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    const closed = new Promise<void>((resolve) =>
      child.once("close", (code) => {
        run.exit = code;
        resolve();
      }),
    );
    // a failed spawn or a broken pipe must end in the result lines, not in an uncaught error
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    try {
      createInterface({ input: child.stdout }).on("line", (line) => {
        observer.sawLine(line);
        run.turn = parseTurnResult(line) ?? run.turn;
      });
      const message = { type: "user", message: { role: "user", content: PROMPT } };
      child.stdin.write(`${JSON.stringify(message)}\n`);
      await until(async () => {
        await look();
        return run.turn !== null || run.exit !== null;
      }, 120_000);
      await until(async () => {
        await look();
        return observer.states.includes("done_unseen");
      }, 10_000);
    } finally {
      child.stdin.end();
      await Promise.race([closed, sleep(10_000)]);
      child.kill();
    }
    const gone = await until(async () => !(await look()), 10_000);
    results.push(...observer.verdict(host.name, { turn: run.turn, exit: run.exit, gone }));
    process.stdout.write(`${formatCost(host.name, run.turn)}\n`);
  } finally {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      results.push(changed(`${host.name} cleanup`, `folder left behind: ${basename(cwd)}`));
    }
  }
  return results;
}

/** The WSL claude on PATH (not a Windows one under /mnt); null when there is none. */
function wslClaude(): string | null {
  const dirs = (process.env.PATH ?? "").split(":").filter((d) => d && !d.startsWith("/mnt/"));
  return dirs.map((d) => join(d, "claude")).find((p) => existsSync(p)) ?? null;
}

/** The hosts to run a turn on; a host without a CLI is a skipped result. */
function hostsOf(win: string): (Host | CheckResult)[] {
  const winExe = windowsClaudeExe();
  const linuxExe = wslClaude();
  return [
    winExe === null
      ? skipped("windows", "no claude.exe on the Windows PATH")
      : {
          name: "windows",
          exe: winExe,
          tempRoot: join(win, "AppData", "Local", "Temp"),
          sessionsDir: join(win, ".claude", "sessions"),
        },
    linuxExe === null
      ? skipped("wsl", "no claude CLI on the WSL PATH")
      : {
          name: "wsl",
          exe: linuxExe,
          tempRoot: tmpdir(),
          sessionsDir: join(homedir(), ".claude", "sessions"),
        },
  ];
}

async function main(argv: readonly string[]): Promise<CheckResult[]> {
  if (process.env.CI) throw new Error("it spends tokens and never runs in CI");
  if (!argv.includes("--spend-tokens"))
    throw new Error("it spends tokens: run `pnpm e2e:live --spend-tokens` to start it");
  const win = windowsHome();
  const port = await findHub(portFileText(win));
  if (port === null) throw new Error("no hub running - start Stream Deck first");
  const results: CheckResult[] = [];
  for (const host of hostsOf(win))
    results.push(...("outcome" in host ? [host] : await runTurn(host, port)));
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (results) => {
      for (const r of results) process.stdout.write(`${formatResult(r)}\n`);
      process.exitCode = hasDrift(results) ? 1 : 0;
    },
    (err) => {
      process.stderr.write(`e2e:live: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
