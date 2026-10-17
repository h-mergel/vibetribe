import { join } from "node:path";
import { DESKTOP_SESSION_ID, isFiniteNumber, isObj } from "@vibetribe/protocol";
import type { DirPort } from "../sessions/sources";

/** One Code session of Claude Desktop: `<root>\<workspace>\<account>\local_<uuid>.json`. */
const SESSION_FILE = new RegExp(`^(${DESKTOP_SESSION_ID})\\.json$`);

/** claude-code-sessions in each of Claude Desktop's possible folders: the roots of its session files. */
export const desktopSessionRoots = (dirs: readonly string[]): string[] =>
  dirs.map((dir) => join(dir, "claude-code-sessions"));

/**
 * When Claude Desktop last showed the session (`lastFocusedAt`, ms since epoch; the app sets it
 * when the user opens or switches to the session). null for text that is no JSON (the app may be
 * writing the file just now) and for any other shape: undocumented app state.
 */
export function parseLastFocusedAt(text: string): number | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return isObj(raw) && isFiniteNumber(raw.lastFocusedAt) ? raw.lastFocusedAt : null;
}

/** a missing or unreadable directory, or a file where one was expected, has no entries */
async function names(fs: DirPort, dir: string): Promise<string[]> {
  try {
    return await fs.list(dir);
  } catch {
    return [];
  }
}

/** The path of every session file under `roots` (three levels deep), by Desktop id. Never throws. */
export async function scanDesktopSessions(
  roots: readonly string[],
  fs: DirPort,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  for (const root of roots)
    for (const workspace of await names(fs, root))
      for (const account of await names(fs, join(root, workspace)))
        for (const name of await names(fs, join(root, workspace, account))) {
          const id = SESSION_FILE.exec(name)?.[1];
          if (id !== undefined) paths.set(id, join(root, workspace, account, name));
        }
  return paths;
}

/**
 * Reads `lastFocusedAt` from Claude Desktop's session files, only ever reading. Only the files of
 * the ids asked for are read; where they lie comes from a scan of `roots` that runs again only when
 * an id is not known yet. Never throws: an id without a readable value is missing from the result.
 */
export class DesktopFocus {
  readonly #roots: readonly string[];
  readonly #fs: DirPort;
  #paths = new Map<string, string>();

  constructor(roots: readonly string[], fs: DirPort) {
    this.#roots = roots;
    this.#fs = fs;
  }

  async focusedAt(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.some((id) => !this.#paths.has(id)))
      this.#paths = await scanDesktopSessions(this.#roots, this.#fs);
    const out = new Map<string, number>();
    for (const id of ids) {
      const path = this.#paths.get(id);
      if (path === undefined) continue;
      let text: string;
      try {
        text = await this.#fs.read(path);
      } catch {
        // moved, deleted or locked: the next call scans again
        this.#paths.delete(id);
        continue;
      }
      const at = parseLastFocusedAt(text);
      if (at !== null) out.set(id, at);
    }
    return out;
  }
}
