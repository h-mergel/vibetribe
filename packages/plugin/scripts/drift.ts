/**
 * `pnpm drift` (in WSL): checks, read-only and without spending tokens, whether the undocumented
 * interfaces VibeTribe relies on still look the way the code expects. One line per assumption
 * (`ok`, `changed: …`, `skipped: …`), exit code 1 on drift. Never prints titles, ids, contents
 * or tokens. Run it after updates of Claude Desktop, Claude Code, Windows or WSL.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CheckResult,
  checkApis,
  checkCredentials,
  checkDesktop,
  checkHubState,
  checkPortFile,
  checkPorts,
  checkSessionFiles,
  desktopConfigFiles,
  desktopDirs,
  FALLBACK_PORTS,
  FALLBACK_VERSION,
  formatResult,
  hasDrift,
  linuxStartTime,
  nodeDirPort,
  type ProcessCheck,
  parseExcludedRanges,
  parsePortRange,
  pickCredentials,
  readDesktopPins,
  roamingDirOf,
} from "@vibetribe/hub";
import { DEFAULT_PORT } from "@vibetribe/protocol";
import { execText } from "../../reporter/src/setup/detect";
import {
  checkPluginFolder,
  checkWindowsSessions,
  findHub,
  hubState,
  portFileText,
  readText,
  sessionFiles,
  windowsHome,
} from "./windows-side";

/** WSL: a running pid's start time (/proc/<pid>/stat) must be the file's procStart. */
const wslProcesses: ProcessCheck = async (pids) => {
  const out = new Map<number, (procStart: string) => boolean>();
  for (const pid of pids) {
    const start = linuxStartTime(readText(`/proc/${pid}/stat`) ?? "");
    if (start !== null) out.set(pid, (procStart) => procStart === start);
  }
  return out;
};

async function main(): Promise<CheckResult[]> {
  const win = windowsHome();
  const now = Date.now();
  const dirs = desktopDirs({}, win);
  const results = await checkDesktop({ dirs, home: win, fs: nodeDirPort, now });
  const winSessions = await sessionFiles(join(win, ".claude", "sessions"));
  results.push(await checkWindowsSessions(winSessions));
  const wslSessions = await sessionFiles(join(homedir(), ".claude", "sessions"));
  results.push(await checkSessionFiles("session files (WSL)", wslSessions, wslProcesses));

  const texts = [join(win, ".claude"), join(homedir(), ".claude")]
    .map((dir) => readText(join(dir, ".credentials.json")))
    .filter((t) => t !== null);
  const credentials = pickCredentials(texts);
  results.push(checkCredentials(credentials, texts.length, now));
  results.push(...(await checkApis({ credentials, now, version: FALLBACK_VERSION })));

  const range = parsePortRange(readText("/proc/sys/net/ipv4/ip_local_port_range") ?? "");
  let netsh = "";
  try {
    netsh = execText(
      "netsh.exe",
      ["int", "ipv4", "show", "excludedportrange", "protocol=tcp"],
      "/mnt/c",
    );
  } catch {
    // without the excluded ranges only the WSL range counts
  }
  results.push(checkPorts([DEFAULT_PORT, ...FALLBACK_PORTS], range, parseExcludedRanges(netsh)));

  const portFile = portFileText(win);
  const port = await findHub(portFile);
  results.push(checkPortFile(portFile, port));
  const read = async (path: string) => readFileSync(path, "utf8");
  const pins = await readDesktopPins(desktopConfigFiles(dirs), read);
  results.push(...checkHubState(port === null ? null : await hubState(port), pins));
  results.push(checkPluginFolder(roamingDirOf({}, win)));
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (results) => {
      for (const r of results) process.stdout.write(`${formatResult(r)}\n`);
      process.exitCode = hasDrift(results) ? 1 : 0;
    },
    (err) => {
      process.stderr.write(`drift: ${String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
