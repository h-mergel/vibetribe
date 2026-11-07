import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vibetribeDir } from "../config";
import { parseSettings, settingsPath } from "./install";
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
  let settings: string | null;
  try {
    const path = settingsPath(home);
    settings = existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return "missing";
  }
  let copy: string | null;
  try {
    copy = readFileSync(reporterCopyPath(home), "utf8");
  } catch {
    copy = null;
  }
  return stateOfFiles(settings, copy, reporterSource, exists);
}

export const reporterCopyPath = (home: string): string => join(vibetribeDir(home), "reporter.mjs");

/** The state from the two files' contents, for callers that read them another way; null: no file. */
export function stateOfFiles(
  settings: string | null,
  copy: string | null,
  reporterSource: string,
  exists: (path: string) => boolean,
): SetupState {
  let commands: string[] | null;
  try {
    commands = settings === null ? null : ourHookCommands(parseSettings(settings, "settings"));
  } catch {
    return "missing";
  }
  if (!commands) return "missing";
  return copy === reporterSource && commands.every((c) => exists(c)) ? "installed" : "outdated";
}
