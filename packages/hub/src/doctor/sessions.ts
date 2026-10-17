import { DESKTOP_ENTRYPOINT, isDesktopId, isObj } from "@vibetribe/protocol";
import { parseSessionFile, pidFromFileName } from "../sessions/parse";
import { type CheckResult, changed, ok, skipped, wordOf } from "./check";

/** One entry of `~/.claude/sessions`: its name and its text. */
export interface SessionFileText {
  name: string;
  text: string;
}

/**
 * The processes among `pids` that run right now, each with the hub's rule for the host: does a
 * file's procStart belong to that process (and not to an earlier one with the same pid)?
 */
export type ProcessCheck = (
  pids: readonly number[],
) => Promise<Map<number, (procStart: string) => boolean>>;

/**
 * Whether Claude Code's session files still carry what the session sources need. Only files whose
 * pid runs right now count (old files of ended processes keep whatever an older version wrote):
 * each parses with its own pid and has a procStart (without it no session counts as alive), and
 * each live one has a known status and, when Claude Desktop started it, a Desktop id (pins, "seen"
 * and the jump link use it). Only plain status words reach the detail.
 */
export async function checkSessionFiles(
  name: string,
  entries: readonly SessionFileText[],
  processes: ProcessCheck,
): Promise<CheckResult> {
  const files = entries.flatMap((e) => {
    const pid = pidFromFileName(e.name);
    return pid === null ? [] : [{ pid, text: e.text }];
  });
  const running = await processes(files.map((f) => f.pid));
  let broken = 0;
  let noStart = 0;
  let live = 0;
  let noDesktopId = 0;
  const statuses = new Set<string>();
  for (const { pid, text } of files) {
    const belongs = running.get(pid);
    if (belongs === undefined) continue;
    const file = parseSessionFile(text);
    if (file?.info.pid !== pid) broken++;
    else if (file.procStart === null) noStart++;
    else if (belongs(file.procStart)) {
      live++;
      const raw: unknown = JSON.parse(text);
      if (isObj(raw) && typeof raw.status === "string" && file.info.status === null)
        statuses.add(wordOf(raw.status));
      const id = file.info.hostSessionId;
      if (file.info.entrypoint === DESKTOP_ENTRYPOINT && (id === null || !isDesktopId(id)))
        noDesktopId++;
    }
  }
  const problems: string[] = [];
  if (broken > 0) problems.push(`files of running pids without sessionId or their pid: ${broken}`);
  if (noStart > 0) problems.push(`files of running pids without procStart: ${noStart}`);
  if (statuses.size > 0) problems.push(`unknown status ${[...statuses].join(", ")}`);
  if (noDesktopId > 0)
    problems.push(`live Claude Desktop sessions without a Desktop id: ${noDesktopId}`);
  if (problems.length > 0) return changed(name, problems.join("; "));
  if (live === 0) return skipped(name, `no live session among ${files.length} files`);
  return ok(name, `${live} live of ${files.length} files`);
}
