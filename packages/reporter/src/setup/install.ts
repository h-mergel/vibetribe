import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, type ReporterConfig, vibetribeDir } from "../config";
import { copyFileAtomic, writeJsonAtomic, writeJsonWithBackup } from "./fsops";
import {
  applyHooks,
  applyStatusline,
  isOurStatusline,
  type ReporterCommand,
  removeHooks,
  removeStatusline,
  type Settings,
  SettingsShapeError,
} from "./settings";

export interface SetupEnv {
  home: string;
  platform: string;
  /** Linux only: running inside WSL */
  wsl: boolean;
  nodePath: string;
  /** path of the running reporter bundle, copied to ~/.vibetribe/reporter.mjs */
  selfPath: string;
  /** WSL only: the Windows home as a Linux path, e.g. /mnt/c/Users/Heinrich */
  windowsHome: string | null;
  now: Date;
  randomToken?: () => string;
  log: (line: string) => void;
  gitBash: () => string | null;
}

export class SetupError extends Error {}

const slashes = (p: string): string => p.replaceAll("\\", "/");
const settingsPath = (home: string): string => join(home, ".claude", "settings.json");
const oneLine = (s: string): string => s.replace(/\s+/g, " ");

function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * null = no settings.json; an empty file or one with only a BOM is `{}`.
 * Anything else that is not a JSON object aborts: we must not overwrite it.
 */
function readSettings(path: string): Settings | null {
  if (!existsSync(path)) return null;
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SetupError(
      `${path} is not valid JSON (${oneLine(String(err))}). Fix it first; nothing was changed.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new SetupError(`${path} is not a JSON object. Fix it first; nothing was changed.`);
  return parsed as Settings;
}

/** WSL reuses the Windows token (must exist and not be empty); elsewhere `ensureToken` creates it. */
function tokenPathOf(e: SetupEnv, dir: string): string {
  if (e.platform !== "linux") return join(dir, "token");
  if (!e.windowsHome)
    throw new SetupError("WSL: Windows home not found. Pass --windows-home /mnt/c/Users/<name>.");
  const winToken = join(e.windowsHome, ".vibetribe", "token");
  if (!existsSync(winToken))
    throw new SetupError(`WSL: ${winToken} missing. Run setup on Windows first.`);
  if (readFileSync(winToken, "utf8").trim() === "")
    throw new SetupError(`WSL: ${winToken} token empty, run setup on Windows first.`);
  return winToken;
}

/** Windows: create the token (owner-only), keep an existing one, replace an empty one. */
function ensureToken(e: SetupEnv, tokenPath: string): void {
  if (e.platform === "linux") return;
  const token = (e.randomToken ?? randomHex)();
  try {
    writeFileSync(tokenPath, token, { mode: 0o600, flag: "wx" });
    e.log(`created token ${tokenPath}`);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  if (readFileSync(tokenPath, "utf8").trim() !== "") return;
  writeFileSync(tokenPath, token, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  e.log(`token ${tokenPath} was empty, created a new one`);
}

/**
 * Input problems (platform, ~/.claude, settings.json content and shape, WSL token) are decided
 * before the first write. Later failures (disk, permissions) can still leave a partial
 * ~/.vibetribe, but never a partly written settings.json.
 */
export function install(e: SetupEnv): void {
  if (e.platform === "linux" && !e.wsl)
    throw new SetupError(
      "VibeTribe v1 supports Windows and WSL only (WSL_DISTRO_NAME is not set).",
    );
  const claudeDir = join(e.home, ".claude");
  if (existsSync(claudeDir) && !statSync(claudeDir).isDirectory())
    throw new SetupError(`${claudeDir} is not a directory; nothing was changed.`);
  const path = settingsPath(e.home);
  const before = readSettings(path) ?? {};
  const dir = vibetribeDir(e.home);
  const reporter = join(dir, "reporter.mjs");
  const tokenPath = tokenPathOf(e, dir);

  const cmd: ReporterCommand = { node: slashes(e.nodePath), reporter: slashes(reporter) };
  let settings: Settings;
  let previous: ReturnType<typeof applyStatusline>["previous"];
  try {
    ({ settings, previous } = applyStatusline(applyHooks(before, cmd), cmd));
  } catch (err) {
    if (err instanceof SettingsShapeError)
      throw new SetupError(`${path}: ${err.message}; nothing was changed.`);
    throw err;
  }
  const existing = loadConfig(e.home);
  // a recorded previous statusline is only valid while ours is still the installed one
  const recorded =
    previous ?? (isOurStatusline(before.statusLine) ? existing.previousStatusline : null);
  // detected on every run: Git may have been installed or moved since the statusline was recorded
  const gitBash = recorded && e.platform === "win32" ? e.gitBash() : null;
  if (recorded && gitBash) recorded.shell = slashes(gitBash);
  // without Git Bash the default shell runs it, as the warning below says; a stale path would not
  else if (recorded && e.platform === "win32") delete recorded.shell;

  // first write: from here on the user's machine changes
  mkdirSync(dir, { recursive: true });
  if (resolve(e.selfPath) !== resolve(reporter)) copyFileAtomic(e.selfPath, reporter);
  ensureToken(e, tokenPath);
  e.log(`node: ${cmd.node} (run setup again if this node installation moves)`);
  if (recorded && e.platform === "win32" && !gitBash)
    e.log("warning: Git Bash not found; the previous statusline will run via the default shell");
  const config: ReporterConfig = {
    hubUrl: existing.hubUrl,
    tokenPath,
    previousStatusline: recorded,
  };
  writeJsonAtomic(join(dir, "config.json"), config, 0o600);

  if (JSON.stringify(settings) === JSON.stringify(before)) {
    e.log(`${path}: unchanged`);
    return;
  }
  const backup = writeJsonWithBackup(path, settings, e.now);
  e.log(`${path}: hooks and statusline installed${backup ? ` (backup ${backup})` : ""}`);
}

export function uninstall(e: SetupEnv): void {
  const path = settingsPath(e.home);
  const before = readSettings(path);
  if (!before) {
    e.log(`${path}: not found, nothing to do`);
    return;
  }
  const previous = loadConfig(e.home).previousStatusline;
  const settings = removeStatusline(removeHooks(before), previous);
  if (JSON.stringify(settings) === JSON.stringify(before)) {
    e.log(`${path}: no VibeTribe entries`);
    return;
  }
  if ("statusLine" in before && !("statusLine" in settings))
    e.log("no previous statusline recorded – statusLine removed");
  const backup = writeJsonWithBackup(path, settings, e.now);
  e.log(`${path}: VibeTribe entries removed${backup ? ` (backup ${backup})` : ""}`);
}
