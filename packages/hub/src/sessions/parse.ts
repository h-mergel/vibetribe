import type { FileStatus, SessionFileInfo } from "@vibetribe/core";
import { isObj } from "@vibetribe/protocol";

export interface SessionFile {
  info: SessionFileInfo;
  /** Linux: clock ticks since boot; Windows: FILETIME — compared against the live process */
  procStart: string | null;
}

const STATUSES = new Set<FileStatus>(["busy", "idle", "waiting"]);

/** Largest value a 32-bit pid can take on Linux and Windows. */
const MAX_PID = 2_147_483_647;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const isPid = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= MAX_PID;

/** procStart is a decimal string of clock ticks or FILETIME; larger numbers lose precision as JSON numbers. */
function procStartOf(v: unknown): string | null {
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" && Number.isSafeInteger(v)) s = String(v);
  else return null;
  return /^\d+$/.test(s) ? s : null;
}

/** Untrusted file content → typed value, or null (half-written, foreign, broken). */
export function parseSessionFile(text: string): SessionFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  const sessionId = str(raw.sessionId);
  const pid = isPid(raw.pid) ? raw.pid : null;
  if (!sessionId || pid === null) return null;
  const status =
    typeof raw.status === "string" && STATUSES.has(raw.status as FileStatus)
      ? (raw.status as FileStatus)
      : null;
  return {
    info: {
      sessionId,
      pid,
      cwd: typeof raw.cwd === "string" ? raw.cwd : "",
      entrypoint: str(raw.entrypoint),
      name: str(raw.name),
      hostSessionId: str(raw.hostSessionId),
      bridgeSessionId: str(raw.bridgeSessionId),
      status,
      waitingFor: str(raw.waitingFor),
    },
    procStart: procStartOf(raw.procStart),
  };
}

/** Session files are named <pid>.json; everything else (e.g. .key files) is ignored. */
export function pidFromFileName(name: string): number | null {
  const m = /^([1-9]\d{0,9})\.json$/.exec(name);
  if (!m) return null;
  const pid = Number(m[1]);
  return isPid(pid) ? pid : null;
}

/** Field 22 (starttime) of /proc/<pid>/stat; the command name in parentheses may contain spaces and parens. */
export function linuxStartTime(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  // fields[0] is field 3 (state), so field 22 is fields[19]
  const field = stat
    .slice(close + 1)
    .trim()
    .split(/ +/)[19];
  return field !== undefined && /^\d+$/.test(field) ? field : null;
}

const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000n;

/**
 * A FILETIME is 100 ns ticks since 1601-01-01 UTC; this returns epoch milliseconds.
 * Pre-1970 values, malformed input and anything that is not a finite non-negative number give null.
 */
export function filetimeToMs(filetime: string): number | null {
  if (!/^\d{1,20}$/.test(filetime)) return null;
  const ms = Number(BigInt(filetime) / 10_000n - FILETIME_EPOCH_OFFSET_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
