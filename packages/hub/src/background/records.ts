import {
  type BackgroundKind,
  type BackgroundRecord,
  type BackgroundTask,
  type HostSnapshot,
  keyOf,
} from "@vibetribe/core";
import { isFiniteNumber, isObj } from "@vibetribe/protocol";

/**
 * A file saved longer ago than this is not restored: after a long pause (Stream Deck closed
 * overnight) the jobs have most likely ended without the hub hearing the final Stop.
 */
export const BACKGROUND_RESTORE_MAX_AGE_MS = 6 * 3_600_000;

/** While jobs run, the file is rewritten at least this often, so `savedAt` measures the downtime. */
export const BACKGROUND_REFRESH_MS = 10 * 60_000;

/** Content of %APPDATA%\vibetribe\background.json: when it was written (hub clock) and the jobs. */
export interface BackgroundFile {
  savedAt: number;
  records: SavedRecord[];
}

/**
 * A saved job list. `savedAt` is set only on records still waiting for their host's first scan:
 * it is the time the file last held them as running, and survives every rewrite, so waiting jobs
 * expire however often the file is refreshed.
 */
export type SavedRecord = BackgroundRecord & { savedAt?: number };

/** Too old, or from the future (clock set back): not trusted to still run. */
const expired = (savedAt: number, now: number): boolean =>
  savedAt > now || now - savedAt >= BACKGROUND_RESTORE_MAX_AGE_MS;

const KINDS: ReadonlySet<string> = new Set<BackgroundKind>(["shell", "agent", "monitor", "other"]);

/** File format version 1: ids and kinds only, no descriptions or commands. */
export function serializeBackgrounds(file: BackgroundFile): string {
  const sessions = file.records.map((r) => ({
    host: r.key.host,
    sessionId: r.key.sessionId,
    changedAt: r.changedAt,
    tasks: r.tasks.map((t) => ({ id: t.id, kind: t.kind })),
    savedAt: r.savedAt,
  }));
  return JSON.stringify({ v: 1, savedAt: file.savedAt, sessions });
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function taskOf(v: unknown): BackgroundTask | null {
  if (!isObj(v) || !isText(v.id) || typeof v.kind !== "string" || !KINDS.has(v.kind)) return null;
  return { id: v.id, kind: v.kind as BackgroundKind };
}

function recordOf(v: unknown): SavedRecord | null {
  if (!isObj(v) || !isText(v.host) || !isText(v.sessionId) || !isFiniteNumber(v.changedAt))
    return null;
  if (!Array.isArray(v.tasks)) return null;
  const tasks = v.tasks.map(taskOf).filter((t): t is BackgroundTask => t !== null);
  if (tasks.length === 0) return null;
  const record: SavedRecord = {
    key: { host: v.host, sessionId: v.sessionId },
    tasks,
    changedAt: v.changedAt,
  };
  if (isFiniteNumber(v.savedAt)) record.savedAt = v.savedAt;
  return record;
}

/**
 * Untrusted file content → the saved jobs; null when it is no readable version-1 file. Single
 * unreadable entries are skipped.
 */
export function parseBackgrounds(text: string): BackgroundFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== 1 || !isFiniteNumber(raw.savedAt) || !Array.isArray(raw.sessions))
    return null;
  const records = raw.sessions.map(recordOf).filter((r): r is SavedRecord => r !== null);
  return { savedAt: raw.savedAt, records };
}

/**
 * Jobs saved before a restart, waiting for the first scan of their host: a session that scan
 * lists alive gets them back, a missing one has ended. A live job list from a hook replaces them.
 */
export class PendingBackgrounds {
  readonly #byId = new Map<string, { record: BackgroundRecord; savedAt: number }>();

  /** Takes the saved jobs that are not expired (see `expired`); each keeps its own save time. */
  load(file: BackgroundFile, now: number): void {
    for (const { savedAt, ...record } of file.records) {
      const at = savedAt ?? file.savedAt;
      if (!expired(at, now)) this.#byId.set(keyOf(record.key), { record, savedAt: at });
    }
  }

  /** Removes every record of the scanned host; returns the unexpired ones whose session the scan lists. */
  takeForScan(snap: HostSnapshot): BackgroundRecord[] {
    const alive = new Set(snap.sessions.map((s) => s.sessionId));
    const out: BackgroundRecord[] = [];
    for (const [id, p] of this.#byId) {
      if (p.record.key.host !== snap.host) continue;
      this.#byId.delete(id);
      if (alive.has(p.record.key.sessionId) && !expired(p.savedAt, snap.at)) out.push(p.record);
    }
    return out;
  }

  drop(id: string): void {
    this.#byId.delete(id);
  }

  /** A subagent that ended is no job any more; a record without jobs goes away. */
  dropTask(id: string, taskId: string): void {
    const p = this.#byId.get(id);
    if (!p) return;
    const tasks = p.record.tasks.filter((t) => t.id !== taskId);
    if (tasks.length === 0) this.#byId.delete(id);
    else if (tasks.length < p.record.tasks.length) p.record = { ...p.record, tasks };
  }

  /** The records still waiting, each with its save time; expired ones are forgotten. */
  all(now: number): SavedRecord[] {
    const out: SavedRecord[] = [];
    for (const [id, p] of this.#byId) {
      if (expired(p.savedAt, now)) this.#byId.delete(id);
      else out.push({ ...p.record, savedAt: p.savedAt });
    }
    return out;
  }
}
