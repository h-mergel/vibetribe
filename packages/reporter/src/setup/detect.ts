import { execFileSync } from "node:child_process";
import { win32 } from "node:path";
import type { Env } from "../env";

export type Exec = (file: string, args: string[], cwd?: string) => string;

export const execText: Exec = (file, args, cwd) =>
  execFileSync(file, args, {
    encoding: "utf8",
    timeout: 5000,
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** WSL as the hooks see it: they report only with WSL_DISTRO_NAME set (`detectHost`). */
export const isWsl = (env: Env): boolean => Boolean(env.WSL_DISTRO_NAME);

/**
 * Windows: Git Bash, which Claude Code runs statuslines through. CLAUDE_CODE_GIT_BASH_PATH wins;
 * otherwise `<root>\bin\bash.exe` for the first `where git` hit (`<root>\cmd\git.exe`) that has one.
 */
export function detectGitBash(deps: {
  platform: string;
  env: Env;
  exists: (path: string) => boolean;
  exec: Exec;
}): string | null {
  if (deps.platform !== "win32") return null;
  const fromEnv = deps.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (fromEnv && deps.exists(fromEnv)) return fromEnv;
  try {
    for (const git of deps.exec("where.exe", ["git"]).split(/\r?\n/)) {
      if (git.trim() === "") continue;
      const bash = win32.join(win32.dirname(win32.dirname(git.trim())), "bin", "bash.exe");
      if (deps.exists(bash)) return bash;
    }
  } catch {
    /* no git on PATH */
  }
  return null;
}

/** WSL: the Windows %USERPROFILE% as a Linux path; null elsewhere or on failure. */
export function detectWindowsHome(deps: { platform: string; env: Env; exec: Exec }): string | null {
  if (deps.platform !== "linux" || !isWsl(deps.env)) return null;
  try {
    const win = deps.exec("cmd.exe", ["/c", "echo %USERPROFILE%"], "/mnt/c").trim();
    if (win === "" || win.includes("%")) return null;
    return deps.exec("wslpath", ["-u", win]).trim() || null;
  } catch {
    return null;
  }
}
