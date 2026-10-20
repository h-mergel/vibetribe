import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, type ReporterConfig, vibetribeDir } from "../config";
import { copyFileAtomic, writeJsonAtomic, writeJsonWithBackup, writeTextIfChanged } from "./fsops";
import {
  applyHooks,
  applyStatusline,
  isOurStatusline,
  ourHookCommands,
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
  /**
   * Windows: the hooks run a copy of `nodePath`, ~/.vibetribe/node-<version>.exe, instead of
   * `nodePath` itself (Stream Deck's Node moves to a new folder with its updates). `version` is
   * that Node's `process.versions.node`.
   */
  copyNode?: { version: string };
  /** the reporter bundle's text, written to ~/.vibetribe/reporter.mjs */
  reporterSource: string;
  /** WSL only: the Windows home as a Linux path, e.g. /mnt/c/Users/<name> */
  windowsHome: string | null;
  now: Date;
  randomToken?: () => string;
  log: (line: string) => void;
  gitBash: () => string | null;
}

export class SetupError extends Error {}

const slashes = (p: string): string => p.replaceAll("\\", "/");
export const settingsPath = (home: string): string => join(home, ".claude", "settings.json");
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
export function readSettings(path: string): Settings | null {
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

/**
 * Windows: creates the hub token (owner-only) with its folder, keeps an existing one, replaces an
 * empty one; returns the token. Never logs its value.
 */
export function ensureToken(
  tokenPath: string,
  log: (line: string) => void,
  randomToken: () => string = randomHex,
): string {
  mkdirSync(dirname(tokenPath), { recursive: true });
  const token = randomToken();
  try {
    writeFileSync(tokenPath, token, { mode: 0o600, flag: "wx" });
    log(`created token ${tokenPath}`);
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const existing = readFileSync(tokenPath, "utf8").trim();
  if (existing !== "") return existing;
  writeFileSync(tokenPath, token, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  log(`token ${tokenPath} was empty, created a new one`);
  return token;
}

const NODE_COPY = /^node-.+\.exe$/;

/**
 * Removes the copies no settings entry points at. The previous one stays: Claude Code sessions
 * started before this setup keep running it. A copy a running hook still uses cannot be removed on
 * Windows either; it stays until a later setup.
 */
function removeOtherNodes(dir: string, keep: string[]): void {
  for (const name of readdirSync(dir)) {
    if (!NODE_COPY.test(name) || keep.includes(name)) continue;
    try {
      rmSync(join(dir, name));
    } catch {
      // in use or not ours to remove: the next setup tries again
    }
  }
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
  const nodeCopy = e.copyNode ? `node-${e.copyNode.version}.exe` : null;
  const node = nodeCopy ? join(dir, nodeCopy) : e.nodePath;
  const previousCopies = (ourHookCommands(before) ?? []).map((c) =>
    c.slice(c.lastIndexOf("/") + 1),
  );

  const cmd: ReporterCommand = { node: slashes(node), reporter: slashes(reporter) };
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
  writeTextIfChanged(reporter, e.reporterSource);
  // a copy that exists is never replaced: Windows locks it while a hook runs it
  if (nodeCopy && !existsSync(node)) copyFileAtomic(e.nodePath, node);
  if (e.platform !== "linux") ensureToken(tokenPath, e.log, e.randomToken);
  e.log(
    e.copyNode
      ? `node: ${cmd.node} (copy of ${slashes(e.nodePath)})`
      : `node: ${cmd.node} (run setup again if this node installation moves)`,
  );
  if (recorded && e.platform === "win32" && !gitBash)
    e.log("warning: Git Bash not found; the previous statusline will run via the default shell");
  const config: ReporterConfig = {
    hubUrl: existing.hubUrl,
    tokenPath,
    previousStatusline: recorded,
  };
  writeJsonAtomic(join(dir, "config.json"), config, 0o600);

  if (JSON.stringify(settings) === JSON.stringify(before)) e.log(`${path}: unchanged`);
  else {
    const backup = writeJsonWithBackup(path, settings, e.now);
    e.log(`${path}: hooks and statusline installed${backup ? ` (backup ${backup})` : ""}`);
  }
  if (nodeCopy) removeOtherNodes(dir, [nodeCopy, ...previousCopies]);
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
