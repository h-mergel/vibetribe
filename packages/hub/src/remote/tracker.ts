import type { HostSnapshot, SessionFileInfo } from "@vibetribe/core";
import type { RemoteSession } from "./api";
import { REMOTE_HOST } from "./names";

/** How long a raised turn is remembered after its session was last listed. */
export const TURN_MEMORY_MS = 24 * 3_600_000;

/** What one remote listing means for the store, in the order the hub applies it. */
export interface RemoteBatch {
  /** every shown session with its own time; applied first, so an episode starts at last_event_at */
  deltas: { at: number; info: SessionFileInfo }[];
  /** the complete remote listing: a session missing from it is removed */
  snapshot: HostSnapshot;
  /** sessions with a turn to raise as done + unread: a stop at their time starts done_unseen */
  finished: { sessionId: string; at: number }[];
  /** sessions read elsewhere: they were done + unread and are idle and read now */
  read: string[];
}

/** A remote session as the store sees a session file: no pid, no cwd, the title as its name. */
export function remoteFileInfo(s: RemoteSession): SessionFileInfo {
  return {
    sessionId: s.id,
    pid: null,
    cwd: "",
    entrypoint: null,
    name: s.title,
    hostSessionId: null,
    bridgeSessionId: s.id,
    status: s.status,
    waitingFor: s.status === "waiting" ? "input needed" : null,
  };
}

interface Turn {
  /** last_event_at of the raised turn; null = unknown (then `reopened` alone decides) */
  at: number | null;
  /** seen on the deck or read elsewhere */
  acked: boolean;
  /**
   * a listing showed the session without done + unread since the turn was raised (busy, waiting
   * or read): only then can a later done + unread be a new turn
   */
  reopened: boolean;
  listedAt: number;
}

/**
 * Turns successive listings into store input. It remembers the last raised done + unread turn per
 * session by its last_event_at, also while the session is missing from the list (up to
 * TURN_MEMORY_MS): a turn is raised once, a seen turn is not raised again after a disconnect
 * flap, and an unseen turn is raised again when its session had to be re-created. A new turn
 * needs evidence (probe J2b: last_event_at also moves quietly on idle sessions): a
 * changed last_event_at counts only after some listing showed the session without done + unread
 * (busy, waiting or read). Without last_event_at that evidence alone decides.
 */
export class RemoteTracker {
  readonly #turns = new Map<string, Turn>();
  /** ids that were done + unread or waiting in the last listing: idle now means read */
  #previousAlarm = new Set<string>();

  /**
   * `exclude`: bridge ids a local session shows (local wins). `present`: remote session ids the
   * store holds right now (before this batch).
   */
  plan(
    sessions: RemoteSession[],
    exclude: ReadonlySet<string>,
    present: ReadonlySet<string>,
    now: number,
  ): RemoteBatch {
    for (const [id, turn] of this.#turns)
      if (now - turn.listedAt > TURN_MEMORY_MS) this.#turns.delete(id);
    const shown: RemoteSession[] = [];
    const ids = new Set<string>();
    for (const s of sessions) {
      if (exclude.has(s.id) || ids.has(s.id)) continue;
      ids.add(s.id);
      shown.push(s);
    }
    // the server clock may run ahead of ours: an episode never starts in the future
    const atOf = (s: RemoteSession): number => (s.at === null ? now : Math.min(s.at, now));
    const finished: RemoteBatch["finished"] = [];
    const read: string[] = [];
    const alarm = new Set<string>();
    for (const s of shown) {
      const turn = this.#turns.get(s.id);
      if (turn) turn.listedAt = now;
      if (s.doneUnread) {
        alarm.add(s.id);
        const newTurn =
          turn === undefined || (turn.reopened && (s.at === null || turn.at !== s.at));
        const lost = turn !== undefined && !turn.acked && !present.has(s.id);
        if (newTurn || lost) {
          finished.push({ sessionId: s.id, at: atOf(s) });
          this.#turns.set(s.id, { at: s.at, acked: false, reopened: false, listedAt: now });
        }
        continue;
      }
      if (turn) turn.reopened = true;
      if (s.status === "waiting") alarm.add(s.id);
      else if (s.status === "idle" && this.#previousAlarm.has(s.id)) {
        // only an idle session counts as read: a new wait or turn must not inherit "seen"
        read.push(s.id);
        if (turn) turn.acked = true;
      }
    }
    this.#previousAlarm = alarm;
    const deltas = shown.map((s) => ({ at: atOf(s), info: remoteFileInfo(s) }));
    return {
      deltas,
      snapshot: {
        host: REMOTE_HOST,
        hostKind: "remote",
        at: now,
        sessions: deltas.map((d) => d.info),
      },
      finished,
      read,
    };
  }

  /** The raised turn was seen on the deck. */
  ack(id: string): void {
    const turn = this.#turns.get(id);
    if (turn) turn.acked = true;
  }

  /** The store dropped the session (no signal for too long): its next done + unread is new. */
  forget(id: string): void {
    this.#turns.delete(id);
    this.#previousAlarm.delete(id);
  }
}
