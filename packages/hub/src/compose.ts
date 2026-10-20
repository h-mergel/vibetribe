import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PORT_FILE } from "@vibetribe/protocol";
import type { BackgroundPorts } from "./background/keeper";
import { codeOf, skipped } from "./doctor/check";
import { checkDesktop } from "./doctor/desktop";
import { checkPortFile } from "./doctor/hub";
import { writeFileAtomic } from "./files";
import { DesktopFocus, desktopSessionRoots } from "./focus/desktop";
import { desktopConfigFiles, readDesktopPins } from "./pins/desktop";
import { fetchRemoteSessions } from "./remote/api";
import { REMOTE_SOURCE } from "./remote/names";
import { type HubConfig, parsePort } from "./runtime";
import {
  credentialPaths,
  isProcessAlive,
  nodeDirPort,
  type WslAccess,
  windowsCreationTimes,
  wslAccess,
  wslDefaultDistro,
  wslListProc,
  wslReadStat,
} from "./sessions/ports";
import { type SessionSource, WindowsSessionSource, WslSessionSource } from "./sessions/sources";
import { claudeRunner, findClaudeExe, parseClaudeVersion, runClaudeVersion } from "./usage/cli";
import { TokenRefresher } from "./usage/refresh";
import { fetchUsage, parseUsageCache, pickCredentials } from "./usage/usage";

/**
 * Where the hub listens when DEFAULT_PORT cannot be bound. WSL's mirrored networking reserves a
 * 4096-port block on the Windows side that moves between WSL starts (seen: 40525–44620 and
 * 44620–48715). These ports lie below Windows' dynamic range (49152–65535) and 6000 apart, so one
 * such block covers at most one of them.
 */
export const FALLBACK_PORTS: readonly number[] = [37710, 31710, 25710];

/** %USERPROFILE%\.vibetribe: the token setup wrote and the port file the reporters read. */
const vibetribeDir = (home: string): string => join(home, ".vibetribe");

/** The claude-code version in the User-Agent header until `claude --version` has answered. */
export const FALLBACK_VERSION = "2.1.287";
const LOG_MAX_BYTES = 1_000_000;
const LOG_KEEP = 5;

/** %APPDATA%, or its default under the profile. */
export const roamingDirOf = (env: NodeJS.ProcessEnv, home: string): string =>
  env.APPDATA ?? join(home, "AppData", "Roaming");

/** %APPDATA%\vibetribe — the only place the hub and the plugin write to (spec §11.1). */
export function dataDirOf(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(roamingDirOf(env, home), "vibetribe");
}

/** Claude Desktop's MSIX package; the app's %APPDATA% lives inside it. */
const DESKTOP_PACKAGE = "Claude_pzs8sxrjxfjjc";

/**
 * Claude Desktop's folder: %LOCALAPPDATA%\Claude-Data\<package> since its October 2026 update,
 * before that inside the package's LocalCache (MSIX), else %APPDATA%\Claude.
 */
export const desktopDirs = (env: NodeJS.ProcessEnv, home: string): string[] => {
  const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  return [
    join(local, "Claude-Data", DESKTOP_PACKAGE.toLowerCase()),
    join(local, "Packages", DESKTOP_PACKAGE, "LocalCache", "Roaming", "Claude"),
    join(roamingDirOf(env, home), "Claude"),
  ];
};

/**
 * VIBETRIBE_WSL_DISTRO (`none` switches WSL off without asking wsl.exe), else WSL's default
 * distribution; null without WSL.
 */
export async function wslDistro(
  env: NodeJS.ProcessEnv = process.env,
  findDefault: () => Promise<string | null> = () => wslDefaultDistro(),
): Promise<string | null> {
  const wanted = env.VIBETRIBE_WSL_DISTRO;
  if (wanted === "none") return null;
  return wanted || findDefault();
}

/**
 * Plain rotating log: <name>.log, <name>.1.log … <name>.4.log, 1 MB each. Never logs tokens.
 * Every failure is swallowed: logging must never stop the hub or the plugin.
 */
export function createFileLog(dir: string, name: string): (line: string) => void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // without a log directory the caller still runs; append() fails silently below
  }
  const file = join(dir, `${name}.log`);
  return (line: string): void => {
    try {
      if (existsSync(file) && statSync(file).size > LOG_MAX_BYTES) {
        for (let i = LOG_KEEP - 1; i >= 1; i--) {
          const from = i === 1 ? file : join(dir, `${name}.${i - 1}.log`);
          if (existsSync(from)) renameSync(from, join(dir, `${name}.${i}.log`));
        }
      }
    } catch {
      // a failing rotation must not stop appending
    }
    try {
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // nothing left to report to
    }
  };
}

/** The saved background jobs: read once at start (missing file = null), replaced atomically on every change. */
export function backgroundFilePorts(path: string): BackgroundPorts {
  return {
    load: async () => {
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    save: (text) => writeFileAtomic(path, text),
  };
}

/** The ingress token `setup` wrote; null when setup has not run on this Windows user. */
export function readHubToken(home = homedir()): string | null {
  try {
    return readFileSync(join(vibetribeDir(home), "token"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export interface WindowsHubOptions {
  log: (line: string) => void;
  /** The ingress token, read once by the caller; null when setup has not run (ingress then closed). */
  token: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Seam: finds claude.exe; defaults to the real lookup. Tests inject a fake. */
  findExe?: () => string | null;
  /** Seam: asks claude.exe for its version; defaults to runClaudeVersion. Tests inject a fake. */
  runVersion?: (exe: string) => Promise<string>;
}

export interface WindowsHubConfig {
  config: HubConfig;
  /** one line for the start log: sources, claude.exe (the port is known only once bound) */
  summary: string;
  /**
   * The session source of a WSL distribution found after the start (`wslDistro` can take 15 s);
   * from then on its credentials count too. Call once, then hand it to `RunningHub.addSource`.
   */
  wslSource(distro: string): SessionSource;
}

/**
 * Composition of the real Windows adapters (session files, WSL, usage endpoint, CLI refresh);
 * shared by the standalone hub (main.ts) and the Stream Deck plugin. Pure wiring, no loops. The
 * plugin must reach `streamDeck.connect()` quickly: only `where.exe claude` runs here (at most
 * 5 s); `claude --version` and every WSL call run later.
 */
export async function windowsHubConfig(o: WindowsHubOptions): Promise<WindowsHubConfig> {
  const env = o.env ?? process.env;
  const home = o.home ?? homedir();
  const { port, warning } = parsePort(env.VIBETRIBE_PORT);
  if (warning) o.log(warning);

  let wsl: WslAccess | null = null;
  async function readCredentials() {
    const paths = await credentialPaths(home, wsl);
    const texts: string[] = [];
    for (const path of paths) {
      try {
        texts.push(await readFile(path, "utf8"));
      } catch {
        // missing or unreadable: the other file may still hold a token
      }
    }
    return pickCredentials(texts);
  }

  const sources: SessionSource[] = [
    new WindowsSessionSource({
      dir: join(home, ".claude", "sessions"),
      fs: nodeDirPort,
      isAlive: isProcessAlive,
      creationTimes: windowsCreationTimes,
    }),
  ];

  const exe = (o.findExe ?? findClaudeExe)();
  // The version only feeds the User-Agent header: requests before `claude --version` answers carry the fallback.
  let version = FALLBACK_VERSION;
  if (exe) {
    (o.runVersion ?? runClaudeVersion)(exe).then(
      (out) => {
        version = parseClaudeVersion(out) ?? FALLBACK_VERSION;
      },
      (err) => {
        o.log(`claude --version failed (${String(err)}); keeping ${FALLBACK_VERSION}`);
      },
    );
  }
  const cachePath = join(dataDirOf(env, home), "usage-cache.json");
  const portFile = join(vibetribeDir(home), PORT_FILE);
  const dirs = desktopDirs(env, home);
  const focus = new DesktopFocus(desktopSessionRoots(dirs), nodeDirPort);
  const refresher = new TokenRefresher({
    // without claude.exe there is nothing to refresh with; the deck then shows "Sign in"
    run: exe ? claudeRunner(exe) : async () => false,
    readExpiresAt: async () => (await readCredentials())?.expiresAt ?? null,
    log: o.log,
  });

  return {
    summary: `sources ${[...sources.map((s) => s.name), REMOTE_SOURCE].join(", ")}, claude ${exe ?? "not found"}`,
    wslSource: (distro) => {
      wsl = wslAccess(distro, env);
      return new WslSessionSource({
        ...wsl,
        fs: nodeDirPort,
        listProc: wslListProc(distro),
        readStat: wslReadStat(distro),
      });
    },
    config: {
      port,
      fallbackPorts: FALLBACK_PORTS,
      // the reporters read it next to the token, in WSL through /mnt/c
      savePort: (bound) => writeFileAtomic(portFile, String(bound)),
      // a random token keeps the ingress closed when setup never ran (createIngress refuses "")
      token: o.token ?? randomUUID(),
      tokenMissing: o.token === null,
      sources,
      usage: {
        refresher,
        ports: {
          readCredentials,
          fetchUsage: (accessToken) => fetchUsage(accessToken, version),
          loadCache: async () => {
            try {
              return parseUsageCache(await readFile(cachePath, "utf8"));
            } catch {
              return null;
            }
          },
          saveCache: (input, at) => writeFileAtomic(cachePath, JSON.stringify({ input, at })),
        },
      },
      // same read-only credentials as the usage poller; the token never leaves the request
      remote: {
        ports: {
          readCredentials,
          fetchSessions: (accessToken) => fetchRemoteSessions(accessToken, version),
        },
      },
      background: backgroundFilePorts(join(dataDirOf(env, home), "background.json")),
      // Claude Desktop's own state: only ever read
      pins: () => readDesktopPins(desktopConfigFiles(dirs), (path) => readFile(path, "utf8")),
      focus: (ids) => focus.focusedAt(ids),
      // the part of `pnpm drift` that needs neither tokens nor WSL
      drift: async (bound) => [
        ...(await checkDesktop({ dirs, home, fs: nodeDirPort, now: Date.now() })),
        await readFile(portFile, "utf8").then(
          (text) => checkPortFile(text, bound),
          (err) =>
            codeOf(err) === "ENOENT"
              ? checkPortFile(null, bound)
              : skipped("port file", `unreadable right now (${codeOf(err)})`),
        ),
      ],
      log: o.log,
    },
  };
}
