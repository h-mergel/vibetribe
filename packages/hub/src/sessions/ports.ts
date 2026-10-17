import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { type DirPort, isGone } from "./sources";

export const nodeDirPort: DirPort = {
  list: (dir) => readdir(dir),
  read: (path) => readFile(path, "utf8"),
};

export function isProcessAlive(
  pid: number,
  kill: (pid: number, signal: number) => unknown = process.kill.bind(process),
): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type Exec = (file: string, args: string[]) => Promise<string>;

const runEncoded = (file: string, args: string[], encoding: BufferEncoding): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(file, args, { encoding, windowsHide: true, timeout: 15_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  );

/** Runs a Windows helper (PowerShell, wsl.exe) with a 15 s timeout; utf8 output. */
export const run: Exec = (file, args) => runEncoded(file, args, "utf8");

/** PowerShell 5.1 ConvertTo-Json of Win32_Process rows: an array, a single object, or nothing. */
export function parseCimRows(json: string): Map<number, number> {
  const out = new Map<number, number>();
  if (!json.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return out;
  }
  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    const r = (row ?? {}) as { ProcessId?: unknown; CreationDate?: unknown };
    const ms =
      typeof r.CreationDate === "string"
        ? /\/Date\((\d+)\)\//.exec(r.CreationDate)?.[1]
        : undefined;
    if (typeof r.ProcessId === "number" && ms) out.set(r.ProcessId, Number(ms));
  }
  return out;
}

/** One PowerShell call for all new pids (probe G: ~1 s per call, so never per poll). */
export async function windowsCreationTimes(
  pids: number[],
  exec: Exec = run,
): Promise<Map<number, number>> {
  if (pids.length === 0) return new Map();
  // Math.trunc keeps the filter digits-only whatever the caller passes
  const filter = pids.map((p) => `ProcessId=${Math.trunc(p)}`).join(" OR ");
  return parseCimRows(
    await exec("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress`,
    ]),
  );
}

/** Output of `wsl.exe -l --running --quiet` after utf16le decoding. */
export function parseRunningDistros(text: string): string[] {
  return text
    .replace(/[﻿\0]/g, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wslIsRunning(distro: string, cacheMs = 5_000): () => Promise<boolean> {
  let cached: { at: number; value: boolean } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value;
    let value = false;
    try {
      value = parseRunningDistros(
        await runEncoded("wsl.exe", ["-l", "--running", "--quiet"], "utf16le"),
      ).includes(distro);
    } catch {
      value = false;
    }
    cached = { at: Date.now(), value };
    return value;
  };
}

const USER_RETRY_MS = 60_000;

/**
 * The Linux user. The distro is checked first on every call, even for the override and the cached
 * value: `wsl.exe -d … whoami` or touching \\wsl.localhost would boot a stopped distro.
 * Successes are cached; after a failure the lookup is not repeated for 60 s.
 */
export function wslUser(
  distro: string,
  isRunning: () => Promise<boolean>,
  deps: { env?: NodeJS.ProcessEnv; exec?: Exec; now?: () => number } = {},
): () => Promise<string | null> {
  const exec = deps.exec ?? run;
  const now = deps.now ?? Date.now;
  let user: string | null = (deps.env ?? process.env).VIBETRIBE_WSL_USER || null;
  let retryAt = 0;
  return async () => {
    if (!(await isRunning())) return null;
    if (user) return user;
    if (now() < retryAt) return null;
    try {
      user = (await exec("wsl.exe", ["-d", distro, "whoami"])).trim() || null;
    } catch {
      user = null;
    }
    if (!user) retryAt = now() + USER_RETRY_MS;
    return user;
  };
}

/** Credential files to read; the WSL one only while the distro runs (reading it would boot it). */
export async function credentialPaths(p: {
  home: string;
  distro: string;
  isRunning: () => Promise<boolean>;
  user: () => Promise<string | null>;
}): Promise<string[]> {
  const paths = [win32.join(p.home, ".claude", ".credentials.json")];
  if (!(await p.isRunning())) return paths;
  const u = await p.user();
  if (u) {
    paths.push(`\\\\wsl.localhost\\${p.distro}\\home\\${u}\\.claude\\.credentials.json`);
  }
  return paths;
}

export function wslListProc(distro: string): () => Promise<string[]> {
  return () => readdir(`\\\\wsl.localhost\\${distro}\\proc`);
}

export function wslReadStat(
  distro: string,
  read: (path: string) => Promise<string> = (p) => readFile(p, "utf8"),
): (pid: number) => Promise<string | null> {
  return async (pid) => {
    try {
      return await read(`\\\\wsl.localhost\\${distro}\\proc\\${pid}\\stat`);
    } catch (err) {
      if (isGone(err)) return null;
      throw err;
    }
  };
}
