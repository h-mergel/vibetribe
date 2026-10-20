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

/** Runs a Windows helper (PowerShell, wsl.exe) with a 15 s timeout, decoding its stdout. */
const runDecoded = (
  file: string,
  args: string[],
  decode: (out: Buffer) => string,
): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      { encoding: "buffer", windowsHide: true, timeout: 15_000 },
      (err, stdout) => (err ? reject(err) : resolve(decode(stdout))),
    ),
  );

export const run: Exec = (file, args) => runDecoded(file, args, (out) => out.toString("utf8"));

/**
 * wsl.exe lists in UTF-16LE, or in UTF-8 when WSL_UTF8=1 is set; UTF-16 of these ASCII lines
 * always holds NUL bytes.
 */
export function decodeWslOutput(out: Buffer): string {
  return out.toString(out.includes(0) ? "utf16le" : "utf8");
}

const runWsl = (args: string[]): Promise<string> => runDecoded("wsl.exe", args, decodeWslOutput);

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

/** Output of `wsl.exe -l --running --quiet`, decoded (`decodeWslOutput`). */
export function parseRunningDistros(text: string): string[] {
  return text
    .replace(/[﻿\0]/g, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The default distribution from `wsl.exe -l -v` (decoded): the row marked `*`. The marker and the
 * name column do not depend on the Windows language; distribution names hold no spaces. Docker
 * Desktop's own distributions run no Claude Code: as the default they count as none.
 */
export function parseDefaultDistro(text: string): string | null {
  for (const line of parseRunningDistros(text)) {
    const m = /^\*\s+(\S+)/.exec(line);
    if (m?.[1]) return m[1].startsWith("docker-desktop") ? null : m[1];
  }
  return null;
}

/**
 * Asks wsl.exe for the default distribution without starting it; null without WSL, without a
 * distribution, or when wsl.exe does not answer within 15 s (it can be slow right after login).
 */
export async function wslDefaultDistro(
  list: () => Promise<string> = () => runWsl(["-l", "-v"]),
): Promise<string | null> {
  try {
    return parseDefaultDistro(await list());
  } catch {
    return null;
  }
}

export function wslIsRunning(distro: string, cacheMs = 5_000): () => Promise<boolean> {
  let cached: { at: number; value: boolean } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value;
    let value = false;
    try {
      value = parseRunningDistros(await runWsl(["-l", "--running", "--quiet"])).includes(distro);
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

/** One WSL distribution as the hub reaches it: never booted by a lookup. */
export interface WslAccess {
  distro: string;
  isRunning: () => Promise<boolean>;
  user: () => Promise<string | null>;
}

export function wslAccess(distro: string, env: NodeJS.ProcessEnv): WslAccess {
  const isRunning = wslIsRunning(distro);
  return { distro, isRunning, user: wslUser(distro, isRunning, { env }) };
}

/** Credential files to read; the WSL one only while the distro runs (reading it would boot it). */
export async function credentialPaths(home: string, wsl: WslAccess | null): Promise<string[]> {
  const paths = [win32.join(home, ".claude", ".credentials.json")];
  if (!wsl || !(await wsl.isRunning())) return paths;
  const u = await wsl.user();
  if (u) {
    paths.push(`\\\\wsl.localhost\\${wsl.distro}\\home\\${u}\\.claude\\.credentials.json`);
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
