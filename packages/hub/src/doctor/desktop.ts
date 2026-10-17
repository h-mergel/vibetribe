import { dirname, relative } from "node:path";
import { desktopSessionRoots, parseLastFocusedAt, scanDesktopSessions } from "../focus/desktop";
import { desktopConfigFiles, firstDesktopConfig, pinnedIds, pinnedOrderOf } from "../pins/desktop";
import type { DirPort } from "../sessions/sources";
import { type CheckResult, changed, codeOf, hoursBetween, ok, skipped } from "./check";

export interface DesktopCheckPorts {
  /** Claude Desktop's possible folders in the hub's order (`desktopDirs`) */
  dirs: readonly string[];
  /** folders are shown relative to it: no user name in the output */
  home: string;
  fs: DirPort;
  now: number;
}

async function checkConfig(p: DesktopCheckPorts): Promise<CheckResult[]> {
  let config: { path: string; text: string } | null;
  try {
    config = await firstDesktopConfig(desktopConfigFiles(p.dirs), p.fs.read);
  } catch (err) {
    const why = `config unreadable right now (${codeOf(err)})`;
    return [skipped("desktop folder", why), skipped("desktop pins", why)];
  }
  if (config === null)
    return [
      changed("desktop folder", `no claude_desktop_config.json in ${p.dirs.length} known folders`),
      skipped("desktop pins", "no config"),
    ];
  const folder = ok("desktop folder", relative(p.home, dirname(config.path)));
  let raw: unknown;
  try {
    raw = JSON.parse(config.text);
  } catch {
    return [folder, skipped("desktop pins", "config is being written")];
  }
  const order = pinnedOrderOf(raw);
  if (order === null)
    return [
      folder,
      changed(
        "desktop pins",
        'no list at preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder',
      ),
    ];
  const pins = pinnedIds(order).length;
  if (pins < order.length)
    return [
      folder,
      changed("desktop pins", `${order.length - pins} of ${order.length} entries unusable`),
    ];
  return [folder, ok("desktop pins", `${pins} pinned`)];
}

async function checkSessionFiles(p: DesktopCheckPorts): Promise<CheckResult> {
  const name = "desktop session files";
  const paths = await scanDesktopSessions(desktopSessionRoots(p.dirs), p.fs);
  if (paths.size === 0)
    return changed(name, "no local_<uuid>.json in claude-code-sessions/<workspace>/<account>/");
  let focused = 0;
  let newest = 0;
  for (const path of paths.values()) {
    const at = await p.fs.read(path).then(parseLastFocusedAt, () => null);
    if (at === null) continue;
    focused++;
    newest = Math.max(newest, at);
  }
  if (focused === 0)
    return changed(name, `none of ${paths.size} files has a numeric lastFocusedAt`);
  return ok(
    name,
    `${paths.size} files, ${focused} with lastFocusedAt, newest ${hoursBetween(newest, p.now)} ago`,
  );
}

/**
 * Claude Desktop's undocumented files as pins and "seen" read them: which folder holds the config,
 * whether its pin list still has its shape, and whether session files with `lastFocusedAt` lie three
 * levels below claude-code-sessions. Only reads; never throws.
 */
export async function checkDesktop(p: DesktopCheckPorts): Promise<CheckResult[]> {
  return [...(await checkConfig(p)), await checkSessionFiles(p)];
}
