import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vibetribeDir } from "../config";
import { readSettings, settingsPath } from "./install";
import { ourHookCommands } from "./settings";

/**
 * `missing`: settings.json lacks some of our hooks or our statusline (or cannot be read);
 * `outdated`: they are in place, but ~/.vibetribe/reporter.mjs is not `reporterSource` or a hook's
 * node is gone; `installed`: setup would change nothing that matters.
 */
export type SetupState = "missing" | "outdated" | "installed";

/** Read-only: what setup would find on this host. */
export function setupState(
  home: string,
  reporterSource: string,
  exists: (path: string) => boolean = existsSync,
): SetupState {
  let commands: string[] | null;
  try {
    const settings = readSettings(settingsPath(home));
    commands = settings ? ourHookCommands(settings) : null;
  } catch {
    return "missing";
  }
  if (!commands) return "missing";
  let copy: string | null;
  try {
    copy = readFileSync(join(vibetribeDir(home), "reporter.mjs"), "utf8");
  } catch {
    copy = null;
  }
  return copy === reporterSource && commands.every((c) => exists(c)) ? "installed" : "outdated";
}
