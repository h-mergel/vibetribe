import { join } from "node:path";
import { DESKTOP_SESSION_ID, isObj } from "@vibetribe/protocol";

/** A pinned Code session as the sidebar stores it: `code:` and Desktop's own id. */
const PINNED_CODE_SESSION = new RegExp(`^code:(${DESKTOP_SESSION_ID})$`);

/** claude_desktop_config.json in each of Claude Desktop's possible folders, in the same order. */
export const desktopConfigFiles = (dirs: readonly string[]): string[] =>
  dirs.map((dir) => join(dir, "claude_desktop_config.json"));

/**
 * `preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder` of the parsed config; null when the
 * path or the list is missing.
 */
export function pinnedOrderOf(raw: unknown): unknown[] | null {
  const prefs = isObj(raw) && isObj(raw.preferences) ? raw.preferences.epitaxyPrefs : undefined;
  const slice = isObj(prefs) ? prefs["dframe-local-slice"] : undefined;
  const order = isObj(slice) ? slice.pinnedOrder : undefined;
  return Array.isArray(order) ? order : null;
}

/** The Desktop ids of the entries in the form `code:local_<uuid>`, in order, each once. */
export function pinnedIds(order: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of order) {
    const id = typeof entry === "string" ? PINNED_CODE_SESSION.exec(entry)?.[1] : undefined;
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The Code sessions pinned in Claude Desktop's sidebar, as Desktop ids in sidebar order (`pinnedOrderOf`).
 * Undocumented app state: any other shape yields no pins, never an error. null for text that is
 * no JSON: the app may be writing the file just now.
 */
export function parseDesktopPins(text: string): string[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const order = pinnedOrderOf(raw);
  return order === null ? [] : pinnedIds(order);
}

/**
 * The first config file that exists (`paths` in order) with its text; null when none exists. Any
 * other read error (locked) is thrown.
 */
export async function firstDesktopConfig(
  paths: readonly string[],
  read: (path: string) => Promise<string>,
): Promise<{ path: string; text: string } | null> {
  for (const path of paths) {
    try {
      return { path, text: await read(path) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
    }
  }
  return null;
}

/**
 * The pins of the first config file that exists (`paths` in order); [] when none exists, null when
 * that one cannot be read or parsed right now (locked, half written). Never throws.
 */
export async function readDesktopPins(
  paths: readonly string[],
  read: (path: string) => Promise<string>,
): Promise<string[] | null> {
  let config: { text: string } | null;
  try {
    config = await firstDesktopConfig(paths, read);
  } catch {
    return null;
  }
  return config === null ? [] : parseDesktopPins(config.text);
}
