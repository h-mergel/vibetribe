import {
  type CoreEvent,
  type EndpointInput,
  type HostKind,
  type HostSnapshot,
  keyOf,
  LimitsStore,
  type Removal,
  type SessionKey,
  SessionStore,
} from "@vibetribe/core";
import type { Envelope } from "@vibetribe/protocol";
import { type BackgroundFile, PendingBackgrounds, type SavedRecord } from "./background/records";
import { normalizeHook } from "./normalize";
import type { RemoteSession } from "./remote/api";
import { LocalBridges } from "./remote/local-bridges";
import { REMOTE_HOST, REMOTE_SOURCE } from "./remote/names";
import { RemoteTracker } from "./remote/tracker";
import type { Health, HubState, RecentEvent, SourceHealth } from "./state";

interface SourceRecord {
  lastAt: number | null;
  error: string | null;
  inactive: boolean;
}

/** Silence after which a source counts as stale, by source kind (the part before the first ':'). */
const STALE_MS: Record<string, number> = {
  sessions: 60_000,
  usage: 15 * 60_000,
  hooks: Number.POSITIVE_INFINITY,
  ingress: Number.POSITIVE_INFINITY,
};

/** A live job list (Stop, SubagentStop) or the end of the session makes saved jobs obsolete. */
const replacesBackground = (ev: CoreEvent): boolean =>
  (ev.type === "stop" && ev.background !== null) ||
  ev.type === "background_snapshot" ||
  ev.type === "session_end";

/** Pure domain facade: no clock, no I/O. Adapters feed it; the plugin reads state() and drainRemovals(). */
export class Hub {
  readonly #store = new SessionStore();
  readonly #limits = new LimitsStore();
  readonly #remote = new RemoteTracker();
  readonly #pendingBackgrounds = new PendingBackgrounds();
  /** the last remote listing; re-planned when the bridge ids of local sessions change */
  #listing: { sessions: RemoteSession[]; at: number } | null = null;
  readonly #localBridges = new LocalBridges();
  readonly #recentLimit: number;
  readonly #recent: RecentEvent[] = [];
  readonly #sources = new Map<string, SourceRecord>();
  readonly #listeners = new Set<() => void>();
  readonly #onListenerError: ((err: unknown) => void) | undefined;
  #removals: Removal[] = [];
  #invalid = 0;
  #pins: string[] = [];

  constructor(opts: { recentLimit?: number; onListenerError?: (err: unknown) => void } = {}) {
    this.#recentLimit = opts.recentLimit ?? 50;
    this.#onListenerError = opts.onListenerError;
  }

  ingest(env: Envelope, at: number): void {
    this.markOk(`hooks:${env.source.host}`, at);
    if (env.kind === "statusline") {
      this.#limits.ingestStatusline(
        { fiveHour: env.fiveHour ?? undefined, sevenDay: env.sevenDay ?? undefined },
        at,
      );
    } else {
      for (const ev of normalizeHook(env, at)) {
        if (replacesBackground(ev)) this.#pendingBackgrounds.drop(keyOf(ev.key));
        else if (ev.type === "subagent_stop")
          this.#pendingBackgrounds.dropTask(keyOf(ev.key), ev.agentId);
        this.#removals.push(...this.#store.apply(ev));
      }
      this.#recent.push({
        at,
        host: env.source.host,
        sessionId: env.session.id,
        name: env.event.name,
      });
      if (this.#recent.length > this.#recentLimit)
        this.#recent.splice(0, this.#recent.length - this.#recentLimit);
    }
    this.#notify();
  }

  /** "Seen" comes from the deck or from Claude Desktop (spec §4.4); unknown sessions are ignored. */
  markSeen(session: { key: SessionKey; hostKind: HostKind }, at: number): void {
    const id = keyOf(session.key);
    if (!this.#store.view(at).some((v) => keyOf(v.key) === id)) return;
    this.#store.apply({ type: "seen", key: session.key, hostKind: session.hostKind, at });
    if (session.key.host === REMOTE_HOST) this.#remote.ack(session.key.sessionId);
    this.#notify();
  }

  /**
   * Background jobs saved before a restart. Each goes back onto its session with the next
   * scan of its host that lists the session alive; a session missing from that scan has ended.
   */
  restoreBackgrounds(file: BackgroundFile, now: number): void {
    this.#pendingBackgrounds.load(file, now);
  }

  /**
   * What to save: the jobs of local sessions plus saved ones still waiting for their scan (those
   * carry their original save time and are dropped once it is too old).
   */
  backgrounds(now: number): SavedRecord[] {
    const live = this.#store.backgrounds();
    const ids = new Set(live.map((r) => keyOf(r.key)));
    return [...live, ...this.#pendingBackgrounds.all(now).filter((r) => !ids.has(keyOf(r.key)))];
  }

  ingestSnapshot(snap: HostSnapshot): void {
    this.#removals.push(...this.#store.applySnapshot(snap));
    for (const r of this.#pendingBackgrounds.takeForScan(snap)) this.#store.restoreBackground(r);
    this.markOk(`sessions:${snap.host}`, snap.at);
    if (this.#localBridges.note(this.#store.view(snap.at), snap.at)) this.#planRemote();
    this.#notify();
  }

  /**
   * One complete remote listing (spec §4.3, probe J2). The listing is kept: a later local scan that
   * changes the local bridge ids re-plans it, so a local session never shows twice.
   */
  ingestRemote(sessions: RemoteSession[], at: number): void {
    this.#listing = { sessions, at };
    this.#planRemote();
    this.markOk(REMOTE_SOURCE, at);
    this.#notify();
  }

  /**
   * Applies the kept listing at its own time (a re-plan never counts as a sign of life of the
   * remote host). A session that a local session file shows (same bridgeSessionId, now or within
   * LOCAL_BRIDGE_HOLD_MS) stays local; the rest is the remote host.
   */
  #planRemote(): void {
    if (!this.#listing) return;
    const { sessions, at } = this.#listing;
    const exclude = this.#localBridges.heldAt(at);
    const present = new Set<string>();
    for (const v of this.#store.view(at))
      if (v.key.host === REMOTE_HOST) present.add(v.key.sessionId);
    const batch = this.#remote.plan(sessions, exclude, present, at);
    for (const d of batch.deltas) this.#store.applyFileDelta(REMOTE_HOST, "remote", d.at, d.info);
    this.#removals.push(...this.#store.applySnapshot(batch.snapshot));
    const key = (sessionId: string): SessionKey => ({ host: REMOTE_HOST, sessionId });
    for (const f of batch.finished)
      this.#store.apply({
        type: "stop",
        key: key(f.sessionId),
        hostKind: "remote",
        at: f.at,
        background: null,
      });
    for (const id of batch.read)
      this.#store.apply({ type: "seen", key: key(id), hostKind: "remote", at });
  }

  markOk(source: string, at: number): void {
    this.#sources.set(source, { lastAt: at, error: null, inactive: false });
  }

  /** The source is switched off (e.g. WSL distro stopped): keep its sessions, show it as missing. */
  markInactive(source: string, reason?: string): void {
    const prev = this.#sources.get(source) ?? { lastAt: null, error: null };
    this.#sources.set(source, {
      ...prev,
      error: reason ?? prev.error,
      inactive: true,
    });
    this.#notify();
  }

  ingestUsage(input: EndpointInput, at: number): void {
    this.#limits.ingestEndpoint(input, at);
    this.markOk("usage", at);
    this.#notify();
  }

  usageExpired(): void {
    this.#limits.setAuthExpired();
    this.markError("usage", "login expired");
  }

  markError(source: string, message: string): void {
    const prev = this.#sources.get(source) ?? { lastAt: null, error: null, inactive: false };
    this.#sources.set(source, { ...prev, error: message });
    this.#notify();
  }

  countInvalid(): void {
    this.#invalid += 1;
  }

  /** Claude Desktop's pins as last read; an unchanged list notifies nobody. */
  ingestPins(ids: string[]): void {
    if (ids.join("\n") === this.#pins.join("\n")) return;
    this.#pins = [...ids];
    this.#notify();
  }

  tick(now: number): void {
    const removed = this.#store.tick(now);
    for (const r of removed)
      if (r.key.host === REMOTE_HOST && r.reason === "no_signal_timeout") {
        this.#remote.forget(r.key.sessionId);
        // the kept listing is stale now: a later local scan must not re-plan it (no ghosts)
        this.#listing = null;
      }
    if (removed.length > 0) {
      this.#removals.push(...removed);
      this.#notify();
    }
  }

  /**
   * Removals since the last call; consumers release slots before syncing (SlotTable contract).
   * The consumer must drain; the queue is unbounded otherwise.
   */
  drainRemovals(): Removal[] {
    const out = this.#removals;
    this.#removals = [];
    return out;
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  state(now: number): HubState {
    const sources: Record<string, SourceHealth> = {};
    for (const [name, rec] of this.#sources) sources[name] = this.#health(name, rec, now);
    return {
      now,
      sessions: this.#store.view(now),
      pins: [...this.#pins],
      limits: {
        fiveHour: this.#limits.window("five_hour", now),
        sevenDay: this.#limits.window("seven_day", now),
        extra: this.#limits.extra(now),
        auth: this.#limits.auth,
      },
      sources,
      recent: [...this.#recent],
      invalidEnvelopes: this.#invalid,
    };
  }

  #health(name: string, rec: SourceRecord, now: number): SourceHealth {
    const staleMs = STALE_MS[name.split(":")[0] ?? ""] ?? 60_000;
    let health: Health = "ok";
    if (rec.inactive || rec.error || rec.lastAt === null) health = "missing";
    else if (now - rec.lastAt > staleMs) health = "stale";
    return { health, lastAt: rec.lastAt, error: rec.error };
  }

  /** A throwing listener must not stop the others or the caller (ingress, tick); the Hub itself does not log. */
  #notify(): void {
    for (const fn of this.#listeners) {
      try {
        fn();
      } catch (err) {
        this.#onListenerError?.(err);
      }
    }
  }
}
