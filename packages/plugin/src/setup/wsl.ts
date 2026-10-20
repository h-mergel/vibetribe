import { execFile } from "node:child_process";
import type { SetupResult } from "./windows";

export type WslMode = "install" | "remove";

/** How a process ended; `code` null: it could not start or ran into the timeout. */
export interface ProcessOutcome {
  code: number | null;
  stderr: string;
}

export type RunProcess = (file: string, args: string[]) => Promise<ProcessOutcome>;

/** The oldest Node the reporter bundle is built for (`target` in reporter/build.mjs) and was run on. */
export const WSL_MIN_NODE = 20;

/**
 * Runs inside the distribution with the user's login PATH: $1 is the Windows reporter copy
 * (forward slashes, wsl.exe drops backslashes), $2 the mode. The reporter in WSL needs a Linux
 * node; its setup copies itself to ~/.vibetribe and finds the token through the Windows home.
 * Exit 3: wslpath failed; 127: no node on the login PATH; 4: node too old.
 */
export const WSL_SETUP_SCRIPT =
  'r=$(wslpath -u "$1") || exit 3; command -v node >/dev/null 2>&1 || exit 127; ' +
  `node -e "process.exit(parseInt(process.versions.node) < ${WSL_MIN_NODE} ? 1 : 0)" || exit 4; ` +
  'if [ "$2" = remove ]; then exec node "$r" setup --uninstall; fi; ' +
  'exec node "$r" setup --windows-home "$(dirname "$(dirname "$r")")"';

const TIMEOUT_MS = 60_000;

export function wslSetupArgs(distro: string, reporterPath: string, mode: WslMode): string[] {
  const reporter = reporterPath.replaceAll("\\", "/");
  return ["-d", distro, "--cd", "~", "-e", "sh", "-lc", WSL_SETUP_SCRIPT, "sh", reporter, mode];
}

/**
 * The line of stderr that explains a failure: the last one that is neither part of a stack trace
 * nor Node's version footer.
 */
export function reasonOf(stderr: string): string | null {
  const lines = stderr
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("at ") && !l.startsWith("Node.js v"));
  return lines.at(-1) ?? null;
}

export function wslSetupResult(distro: string, mode: WslMode, out: ProcessOutcome): SetupResult {
  const where = `WSL (${distro})`;
  const fail = (text: string): SetupResult => ({ ok: false, text });
  switch (out.code) {
    case 0:
      return {
        ok: true,
        text: mode === "install" ? `Hooks installed in ${where}.` : `Hooks removed from ${where}.`,
      };
    case null:
      return fail(`wsl.exe did not answer. Is ${where} working?`);
    case 3:
      return fail(`${where} cannot reach the Windows files. Set up Windows first.`);
    case 4:
      return fail(
        `Node.js in ${where} is older than ${WSL_MIN_NODE}. Install Node.js ${WSL_MIN_NODE} or later there, then try again.`,
      );
    case 127:
      return fail(
        `Node.js is not on the login PATH in ${where} (~/.profile; nvm or fnm set up only in ~/.bashrc does not count). Install Node.js ${WSL_MIN_NODE} or later there, then try again.`,
      );
    default:
      return fail(
        reasonOf(out.stderr) ??
          (out.code > 255
            ? `wsl.exe could not run the setup in ${where} (exit ${out.code}).`
            : `Setup in ${where} failed (exit ${out.code}).`),
      );
  }
}

/** Boots the distribution if it is stopped, which is why it only ever runs on the user's click. */
export async function wslSetup(
  distro: string,
  reporterPath: string,
  mode: WslMode,
  run: RunProcess,
): Promise<SetupResult> {
  return wslSetupResult(
    distro,
    mode,
    await run("wsl.exe", wslSetupArgs(distro, reporterPath, mode)),
  );
}

/** execFile without a shell; never rejects. */
export const runProcess: RunProcess = (file, args) =>
  new Promise((resolve) =>
    execFile(
      file,
      args,
      { encoding: "utf8", windowsHide: true, timeout: TIMEOUT_MS },
      (err, _stdout, stderr) => {
        const code = err ? (typeof err.code === "number" && !err.killed ? err.code : null) : 0;
        resolve({ code, stderr });
      },
    ),
  );
