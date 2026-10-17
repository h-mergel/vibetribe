import type { HostKind, HostSnapshot, SessionFileInfo } from "@vibetribe/core";
import {
  filetimeToMs,
  linuxStartTime,
  parseSessionFile,
  pidFromFileName,
  type SessionFile,
} from "./parse";

export interface DirPort {
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

/** The source cannot report right now; the reason is shown on /debug and logged (no file contents). */
export interface InactiveScan {
  inactive: string;
}

export const isInactive = (r: HostSnapshot | InactiveScan): r is InactiveScan => "inactive" in r;

/** "EACCES: permission denied, scandir <path>"-style text; the code is always part of it. */
export function describeError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code && !msg.includes(code) ? `${code}: ${msg}` : msg;
}

export interface SessionSource {
  readonly name: string;
  readonly host: string;
  readonly hostKind: HostKind;
  /** Complete listing of live sessions, or the reason the source is inactive. Unexpected errors are thrown. */
  scan(now: number): Promise<HostSnapshot | InactiveScan>;
}

export interface WindowsSourcePorts {
  dir: string;
  fs: DirPort;
  isAlive(pid: number): boolean;
  /** pid -> process creation time (ms epoch), one batched query */
  creationTimes(pids: number[]): Promise<Map<number, number>>;
}

export interface WslSourcePorts {
  distro: string;
  fs: DirPort;
  isRunning(): Promise<boolean>;
  /** Linux user owning ~/.claude; only called while the distro runs */
  user(): Promise<string | null>;
  /** Entries of /proc (one readdir); throws when the distro is unreachable */
  listProc(): Promise<string[]>;
  /** /proc/<pid>/stat, null when the process is gone; throws on other errors */
  readStat(pid: number): Promise<string | null>;
}

/** The process or file vanished between two steps — expected, not an error. */
export const isGone = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ESRCH";
};

/** A Windows session file belongs to the running process: its procStart (FILETIME) is the creation time, ±1 ms. */
export function isSameProcess(procStart: string, createdMs: number): boolean {
  const ms = filetimeToMs(procStart);
  return ms !== null && Math.abs(ms - createdMs) <= 1;
}

const pidsOf = (names: string[]): number[] =>
  names.map(pidFromFileName).filter((p): p is number => p !== null);

/**
 * Reads <dir>\\<pid>.json. Returns null when the file vanished, is unparseable (e.g. half-written)
 * or names a different pid; other errors are thrown.
 */
async function readSessionFile(fs: DirPort, dir: string, pid: number): Promise<SessionFile | null> {
  let text: string;
  try {
    text = await fs.read(`${dir}\\${pid}.json`);
  } catch (err) {
    if (isGone(err)) return null;
    throw err;
  }
  const parsed = parseSessionFile(text);
  return parsed && parsed.info.pid === pid ? parsed : null;
}

/** Last successfully parsed info of a verified session, with the start time it was verified against. */
interface LastGood {
  info: SessionFileInfo;
  procStart: string;
}

function prune<V>(map: Map<number, V>, keep: ReadonlySet<number>): void {
  for (const pid of map.keys()) if (!keep.has(pid)) map.delete(pid);
}

/** How long a pid without a resolvable creation time is not queried again. */
const UNRESOLVED_TTL_MS = 60_000;

export class WindowsSessionSource implements SessionSource {
  readonly name = "sessions:win";
  readonly host = "win";
  readonly hostKind: HostKind = "windows";
  readonly #p: WindowsSourcePorts;
  /** pid -> creation time (ms) of the live process, queried once per pid */
  readonly #created = new Map<number, number>();
  /** pid -> time until which the creation time is not queried again (negative cache) */
  readonly #unresolvedUntil = new Map<number, number>();
  /** pid -> last good info; a snapshot must not lose live sessions on a transient read failure */
  readonly #lastGood = new Map<number, LastGood>();

  constructor(p: WindowsSourcePorts) {
    this.#p = p;
  }

  async scan(now: number): Promise<HostSnapshot> {
    const live = pidsOf(await this.#list()).filter((pid) => this.#p.isAlive(pid));
    const liveSet = new Set(live);
    prune(this.#created, liveSet);
    prune(this.#unresolvedUntil, liveSet);
    prune(this.#lastGood, liveSet);
    await this.#resolveCreationTimes(live, now);

    const sessions: SessionFileInfo[] = [];
    for (const pid of live) {
      const info = await this.#sessionOf(pid);
      if (info) sessions.push(info);
    }
    return { host: this.host, hostKind: this.hostKind, at: now, sessions };
  }

  /** A missing sessions dir (fresh machine) is an empty listing. */
  async #list(): Promise<string[]> {
    try {
      return await this.#p.fs.list(this.#p.dir);
    } catch (err) {
      if (isGone(err)) return [];
      throw err;
    }
  }

  async #resolveCreationTimes(live: number[], now: number): Promise<void> {
    const unknown = live.filter(
      (pid) => !this.#created.has(pid) && (this.#unresolvedUntil.get(pid) ?? 0) <= now,
    );
    if (unknown.length === 0) return;
    const times = await this.#p.creationTimes(unknown);
    for (const pid of unknown) {
      const ms = times.get(pid);
      if (ms === undefined) this.#unresolvedUntil.set(pid, now + UNRESOLVED_TTL_MS);
      else {
        this.#created.set(pid, ms);
        this.#unresolvedUntil.delete(pid);
      }
    }
  }

  async #sessionOf(pid: number): Promise<SessionFileInfo | null> {
    const procMs = this.#created.get(pid);
    // no creation time (yet): nothing to verify against, so never carry forward
    if (procMs === undefined) return null;

    const file = await readSessionFile(this.#p.fs, this.#p.dir, pid);
    if (!file) return this.#carried(this.#lastGood.get(pid), procMs);

    if (file.procStart !== null && isSameProcess(file.procStart, procMs)) {
      this.#lastGood.set(pid, { info: file.info, procStart: file.procStart });
      return file.info;
    }
    // pid reuse or stale cache: re-query the creation time next scan
    if (file.procStart !== null && filetimeToMs(file.procStart) !== null) {
      this.#created.delete(pid);
      this.#lastGood.delete(pid);
    }
    return null;
  }

  /** The last good info, as long as it is still verified against the live process. */
  #carried(good: LastGood | undefined, procMs: number): SessionFileInfo | null {
    return good && isSameProcess(good.procStart, procMs) ? good.info : null;
  }
}

export class WslSessionSource implements SessionSource {
  readonly name: string;
  readonly host: string;
  readonly hostKind: HostKind = "wsl";
  readonly #p: WslSourcePorts;
  /** pid -> last good info; a snapshot must not lose live sessions on a transient read failure */
  readonly #lastGood = new Map<number, LastGood>();

  constructor(p: WslSourcePorts) {
    this.#p = p;
    this.host = `wsl:${p.distro}`;
    this.name = `sessions:${this.host}`;
  }

  async scan(now: number): Promise<HostSnapshot | InactiveScan> {
    // never touch \\wsl.localhost while the distro is stopped: that would start it
    if (!(await this.#p.isRunning())) return { inactive: "distro not running" };
    const user = await this.#p.user();
    if (!user) return { inactive: "WSL user unknown" };
    try {
      return await this.#scanRunning(user, now);
    } catch (err) {
      // distro went away mid-scan (or is unreadable): inactive for this round, keep the sessions we know
      return { inactive: describeError(err) };
    }
  }

  async #scanRunning(user: string, now: number): Promise<HostSnapshot> {
    const dir = `\\\\wsl.localhost\\${this.#p.distro}\\home\\${user}\\.claude\\sessions`;
    const alive = new Set(await this.#p.listProc());
    const candidates = pidsOf(await this.#p.fs.list(dir)).filter((pid) => alive.has(String(pid)));
    const starts = new Map<number, string>();
    for (const pid of candidates) {
      const stat = await this.#p.readStat(pid);
      const start = stat ? linuxStartTime(stat) : null;
      if (start) starts.set(pid, start);
    }
    prune(this.#lastGood, new Set(starts.keys()));
    const sessions: SessionFileInfo[] = [];
    for (const [pid, start] of starts) {
      const file = await readSessionFile(this.#p.fs, dir, pid);
      const good = this.#lastGood.get(pid);
      if (!file) {
        if (good && good.procStart === start) sessions.push(good.info);
      } else if (file.procStart !== null && file.procStart === start) {
        this.#lastGood.set(pid, { info: file.info, procStart: start });
        sessions.push(file.info);
      }
    }
    return { host: this.host, hostKind: this.hostKind, at: now, sessions };
  }
}
