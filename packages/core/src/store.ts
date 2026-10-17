import {
  applyEvent,
  applyFile,
  deriveState,
  jobsOf,
  newSession,
  type SessionRecord,
} from "./session";
import {
  type BackgroundKind,
  type BackgroundRecord,
  type Badge,
  type CoreEvent,
  type HostKind,
  type HostSnapshot,
  keyOf,
  type Removal,
  type RemovalReason,
  type SessionFileInfo,
  type SessionKey,
  type SessionView,
} from "./types";

const REMOTE_NO_SIGNAL_MS = 90_000;
const REMOTE_REMOVE_MS = 210_000;
const HOOK_ONLY_TTL_MS = 1_800_000;
const BACKGROUND_STALE_MS = 1_800_000;
const TOMBSTONE_MS = 60_000;
/** a hook-only session older than this is dropped by a snapshot that does not list it */
const HOOK_ONLY_GRACE_MS = 15_000;

export function basenameAny(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const BADGE: Record<HostKind, Badge> = { windows: "WIN", wsl: "WSL", remote: "REM" };

/**
 * Spec §4.1: the badge names where the session runs. Claude Desktop starts sessions on Windows and
 * in WSL alike, so the entrypoint says nothing about the host; it only picks the jump link
 * (`jumpUrlFor`). Hook-only sessions know their host from the reporter's `os` as well.
 */
const badgeOf = (hostKind: HostKind): Badge => BADGE[hostKind];

function titleOf(rec: SessionRecord): string {
  return rec.file?.name?.trim() || basenameAny(rec.cwd) || "claude";
}

function endReason(reason: string | null): RemovalReason {
  if (reason === "clear") return "clear";
  if (reason === "resume") return "resume";
  return "end";
}

function removal(rec: SessionRecord, reason: RemovalReason): Removal {
  return { id: keyOf(rec.key), key: rec.key, reason, cwd: rec.cwd, pid: rec.file?.pid ?? null };
}

export class SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #hostSeenAt = new Map<string, number>();
  readonly #endedUntil = new Map<string, number>();

  apply(ev: CoreEvent): Removal[] {
    const id = keyOf(ev.key);
    if (this.#isTombstoned(id, ev.at)) {
      if (ev.type !== "session_start") return [];
      this.#endedUntil.delete(id);
    }
    // "seen" comes from the deck, not from the host: it is no sign of life
    if (ev.type !== "seen") this.#markHostSeen(ev.key.host, ev.at);
    const existing = this.#sessions.get(id);
    if (ev.type === "session_end")
      return existing ? [this.#end(id, existing, ev.at, endReason(ev.reason))] : [];
    if (ev.type === "seen") {
      if (existing) applyEvent(existing, ev);
      return [];
    }
    const rec = existing ?? this.#create(ev.key, ev.hostKind, ev.at, ev.cwd ?? "");
    applyEvent(rec, ev);
    return [];
  }

  /**
   * Only call with a complete listing of the host's live sessions — a partial listing removes sessions.
   * Removed sessions get a tombstone, so buffered late events cannot resurrect them.
   */
  applySnapshot(snap: HostSnapshot): Removal[] {
    this.#markHostSeen(snap.host, snap.at);
    const present = new Set<string>();
    for (const info of snap.sessions) {
      const id = this.#applyFileInfo(snap.host, snap.hostKind, snap.at, info);
      if (id) present.add(id);
    }
    const removed: Removal[] = [];
    for (const [id, rec] of this.#sessions) {
      if (rec.key.host !== snap.host || present.has(id)) continue;
      // a hook-only session may just be ahead of the file watcher: give it a grace period
      if (rec.fileLinkedAt === null && snap.at - rec.createdAt < HOOK_ONLY_GRACE_MS) continue;
      removed.push(this.#end(id, rec, snap.at, "gone"));
    }
    return removed;
  }

  applyFileDelta(host: string, hostKind: HostKind, at: number, info: SessionFileInfo): void {
    this.#markHostSeen(host, at);
    this.#applyFileInfo(host, hostKind, at, info);
  }

  tick(now: number): Removal[] {
    const removed: Removal[] = [];
    for (const [id, rec] of this.#sessions) {
      let reason: RemovalReason | null = null;
      if (rec.hostKind === "remote" && now - this.#hostAt(rec) >= REMOTE_REMOVE_MS)
        reason = "no_signal_timeout";
      else if (rec.fileLinkedAt === null && now - rec.lastEventAt >= HOOK_ONLY_TTL_MS)
        reason = "hook_only_ttl";
      if (reason) {
        this.#sessions.delete(id);
        removed.push(removal(rec, reason));
      }
    }
    for (const [id, until] of this.#endedUntil) if (until <= now) this.#endedUntil.delete(id);
    return removed;
  }

  view(now: number): SessionView[] {
    return [...this.#sessions.values()].map((rec) => this.#toView(rec, now));
  }

  /** Local sessions (Windows, WSL) with running background jobs, for the hub to save. */
  backgrounds(): BackgroundRecord[] {
    const out: BackgroundRecord[] = [];
    for (const rec of this.#sessions.values()) {
      if (rec.hostKind === "remote" || rec.background.size === 0) continue;
      const tasks = [...rec.background].map(([id, kind]) => ({ id, kind }));
      out.push({ key: rec.key, tasks, changedAt: rec.backgroundChangedAt });
    }
    return out;
  }

  /**
   * Puts jobs saved before a restart back onto a known session that shows none, keeping their
   * change time (stale mark). False, and nothing changes, for unknown sessions, sessions that
   * already have jobs and empty lists.
   */
  restoreBackground(r: BackgroundRecord): boolean {
    const rec = this.#sessions.get(keyOf(r.key));
    if (!rec || rec.background.size > 0 || r.tasks.length === 0) return false;
    rec.background = jobsOf(r.tasks);
    rec.backgroundChangedAt = r.changedAt;
    return true;
  }

  #markHostSeen(host: string, at: number): void {
    this.#hostSeenAt.set(
      host,
      Math.max(this.#hostSeenAt.get(host) ?? Number.NEGATIVE_INFINITY, at),
    );
  }

  #applyFileInfo(
    host: string,
    hostKind: HostKind,
    at: number,
    info: SessionFileInfo,
  ): string | null {
    const key: SessionKey = { host, sessionId: info.sessionId };
    const id = keyOf(key);
    if (this.#isTombstoned(id, at)) return null;
    const rec = this.#sessions.get(id) ?? this.#create(key, hostKind, at, info.cwd);
    applyFile(rec, info, at);
    return id;
  }

  #create(key: SessionKey, hostKind: HostKind, at: number, cwd: string): SessionRecord {
    const rec = newSession(key, hostKind, at, cwd);
    this.#sessions.set(keyOf(key), rec);
    return rec;
  }

  /** Removes the session; the tombstone keeps buffered late events from bringing it back. */
  #end(id: string, rec: SessionRecord, at: number, reason: RemovalReason): Removal {
    this.#sessions.delete(id);
    this.#endedUntil.set(id, at + TOMBSTONE_MS);
    return removal(rec, reason);
  }

  #hostAt(rec: SessionRecord): number {
    return this.#hostSeenAt.get(rec.key.host) ?? rec.lastEventAt;
  }

  #isTombstoned(id: string, at: number): boolean {
    const until = this.#endedUntil.get(id);
    return until !== undefined && at < until;
  }

  #toView(rec: SessionRecord, now: number): SessionView {
    const noSignal = rec.hostKind === "remote" && now - this.#hostAt(rec) >= REMOTE_NO_SIGNAL_MS;
    const kinds: Record<BackgroundKind, number> = { shell: 0, agent: 0, monitor: 0, other: 0 };
    for (const kind of rec.background.values()) kinds[kind] += 1;
    const count = rec.background.size;
    return {
      id: keyOf(rec.key),
      key: rec.key,
      hostKind: rec.hostKind,
      badge: badgeOf(rec.hostKind),
      title: titleOf(rec),
      cwd: rec.cwd,
      state: noSignal ? "no_signal" : deriveState(rec),
      detail: rec.detail,
      errorType: rec.errorType,
      episodeSince: rec.episode?.since ?? null,
      episodeSeen: rec.episode?.seen ?? true,
      background: {
        count,
        kinds,
        stale: count > 0 && now - rec.backgroundChangedAt >= BACKGROUND_STALE_MS,
      },
      pid: rec.file?.pid ?? null,
      entrypoint: rec.file?.entrypoint ?? null,
      hostSessionId: rec.file?.hostSessionId ?? null,
      bridgeSessionId: rec.file?.bridgeSessionId ?? null,
    };
  }
}
