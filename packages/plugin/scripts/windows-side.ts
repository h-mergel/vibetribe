/**
 * The Windows side as WSL sees it, for the developer tools `pnpm drift` and `pnpm e2e:live`: the
 * Windows profile under /mnt/c, the hub's port file and the running hub. Read-only.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type CheckResult,
  changed,
  checkSessionFiles,
  FALLBACK_PORTS,
  type HubState,
  isSameProcess,
  nodeDirPort,
  ok,
  pickClaudeExe,
  type SessionFileText,
  skipped,
  windowsCreationTimes,
} from "@vibetribe/hub";
import { DEFAULT_PORT, PORT_FILE, parsePortNumber } from "@vibetribe/protocol";
import { detectWindowsHome, execText } from "../../reporter/src/setup/detect";
import { PLUGIN_UUID } from "../src/ids";

/** %USERPROFILE% as a Linux path, e.g. /mnt/c/Users/<you>; throws outside WSL or without interop. */
export function windowsHome(): string {
  const home = detectWindowsHome({ platform: process.platform, env: process.env, exec: execText });
  if (home === null) throw new Error("run this in WSL with Windows interop (cmd.exe, wslpath)");
  return home;
}

/** Whether the file was written since `since`; a file that cannot be stat'ed was not. */
function writtenSince(path: string, since: number, mtimeMs: (path: string) => number): boolean {
  try {
    return mtimeMs(path) >= since;
  } catch {
    return false;
  }
}

/** The file's text, or null when it cannot be read. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Every `.json` of a sessions folder with its text; none when the folder is missing. With `since`
 * (ms since epoch) only the files written since then are read.
 */
export async function sessionFiles(
  dir: string,
  since?: number,
  mtimeMs: (path: string) => number = (path) => statSync(path).mtimeMs,
): Promise<SessionFileText[]> {
  const names = await nodeDirPort.list(dir).catch((): string[] => []);
  const out: SessionFileText[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const path = join(dir, name);
    if (since !== undefined && !writtenSince(path, since, mtimeMs)) continue;
    const text = readText(path);
    if (text !== null) out.push({ name, text });
  }
  return out;
}

/** The hub's port file under the Windows profile; null when missing. */
export const portFileText = (home: string): string | null =>
  readText(join(home, ".vibetribe", PORT_FILE));

/**
 * The port a hub answers /health on: the port file's first, then the default and fallback ports.
 * In WSL's mirrored networking 127.0.0.1 reaches the Windows side.
 */
export async function findHub(portFile: string | null): Promise<number | null> {
  const first = portFile === null ? null : parsePortNumber(portFile.trim());
  const candidates = [...new Set([first, DEFAULT_PORT, ...FALLBACK_PORTS])];
  for (const port of candidates) {
    if (port === null) continue;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) return port;
    } catch {
      // nothing listens there
    }
  }
  return null;
}

/** The hub's /debug/state.json; null when it does not answer. */
export async function hubState(port: number): Promise<HubState | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/debug/state.json`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? ((await res.json()) as HubState) : null;
  } catch {
    return null;
  }
}

/** Windows' claude.exe as a Linux path; null when `where claude` finds none. */
export function windowsClaudeExe(): string | null {
  try {
    const exe = pickClaudeExe(execText("cmd.exe", ["/c", "where claude"], "/mnt/c"));
    return exe === null ? null : execText("wslpath", ["-u", exe]).trim() || null;
  } catch {
    return null;
  }
}

/** The Stream Deck plugin folder `pnpm plugin:deploy` copies to. */
export function checkPluginFolder(
  appData: string,
  exists: (path: string) => boolean = existsSync,
): CheckResult {
  const dir = join(appData, "Elgato", "StreamDeck", "Plugins", `${PLUGIN_UUID}.sdPlugin`);
  return exists(join(dir, "manifest.json"))
    ? ok("stream deck plugin", "installed")
    : changed("stream deck plugin", `no manifest.json in Plugins\\${PLUGIN_UUID}.sdPlugin`);
}

/**
 * The Windows session files checked against one PowerShell call for the creation times; skipped
 * (without the error text, which carries pids and stderr) when that call fails.
 */
export async function checkWindowsSessions(
  entries: readonly SessionFileText[],
  creationTimes: (pids: number[]) => Promise<Map<number, number>> = windowsCreationTimes,
): Promise<CheckResult> {
  const name = "session files (Windows)";
  try {
    return await checkSessionFiles(name, entries, async (pids) => {
      const created = await creationTimes([...pids]);
      return new Map(
        [...created].map(([pid, ms]) => [pid, (procStart: string) => isSameProcess(procStart, ms)]),
      );
    });
  } catch {
    return skipped(name, "process list unavailable");
  }
}
