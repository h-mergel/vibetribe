import { compareSeverity, needsAttention, STATE_RANK } from "./ranking";
import type { SessionView } from "./types";

export interface SlotReservation {
  host: string;
  cwd: string;
  pid: number | null;
  until: number;
}

/**
 * A session that needed attention keeps its slot this long after it became calm (seen,
 * answered), so two waiting sessions never take turns on one slot faster than this.
 */
export const ATTENTION_HOLD_MS = 30_000;

/** Idle or no_signal: nothing runs or waits for a reply; every other state counts as running. */
const isResting = (v: SessionView): boolean => STATE_RANK[v.state] >= STATE_RANK.idle;

/**
 * Reservations match by host + cwd (+ pid when both are known), not by identity;
 * `release` of an overflowed (unassigned) id is a no-op.
 */
export class SlotTable {
  #slots: (string | null)[];
  #reserved: (SlotReservation | null)[];
  /** session id -> last promote at which it needed attention (with or without a slot) */
  readonly #heldAt = new Map<string, number>();

  constructor(count: number) {
    this.#slots = Array.from({ length: count }, () => null);
    this.#reserved = Array.from({ length: count }, () => null);
  }

  get count(): number {
    return this.#slots.length;
  }

  resize(count: number): void {
    this.#slots = Array.from({ length: count }, (_, i) => this.#slots[i] ?? null);
    this.#reserved = Array.from({ length: count }, (_, i) => this.#reserved[i] ?? null);
  }

  release(id: string, reserve?: SlotReservation): void {
    const i = this.#slots.indexOf(id);
    if (i < 0) return;
    this.#slots[i] = null;
    if (reserve) this.#reserved[i] = reserve;
  }

  /**
   * `canAssign` limits where NEW sessions may land (default: every index); sessions already in a
   * slot keep it, and a reservation on a disallowed index waits for its expiry. Only fills free
   * slots; displacing calm sessions is a separate step (`promote`).
   */
  sync(
    views: SessionView[],
    now: number,
    canAssign: (index: number) => boolean = () => true,
  ): void {
    const live = new Set(views.map((v) => v.id));
    this.#slots = this.#slots.map((id) => (id !== null && live.has(id) ? id : null));
    this.#reserved = this.#reserved.map((r) => (r !== null && r.until > now ? r : null));
    const assigned = new Set(this.#slots.filter((id): id is string => id !== null));
    const pending = views.filter((v) => !assigned.has(v.id)).sort(compareSeverity);
    for (const v of pending) {
      let i = this.#reserved.findIndex(
        (r, idx) =>
          canAssign(idx) &&
          r !== null &&
          this.#slots[idx] === null &&
          r.host === v.key.host &&
          r.cwd === v.cwd &&
          (r.pid === null || v.pid === null || r.pid === v.pid),
      );
      if (i >= 0) this.#reserved[i] = null;
      else
        i = this.#slots.findIndex(
          (id, idx) => canAssign(idx) && id === null && this.#reserved[idx] === null,
        );
      if (i < 0) continue;
      this.#slots[i] = v.id;
    }
  }

  /**
   * Call after `sync` with the same views. First, a session without a slot that needs attention
   * takes the allowed slot of the session that has been calm longest, of an unpinned one if any.
   * Then a calm session pinned in Claude Desktop without a slot takes the allowed slot of a calm
   * unpinned one, except that a resting one never takes the slot of a running one. `pins` are
   * Desktop ids in sidebar order: running pinned sessions claim first, then the sidebar order;
   * while a resting pinned one waits, a running one takes the slot of a running session first.
   * Never displaced: a session that needs attention, or one that needed it less than
   * ATTENTION_HOLD_MS ago. Unpinned calm sessions never displace, pinned ones never displace each
   * other, and a session on a disallowed (hidden) index keeps it (the 60 s hidden-key rule frees
   * it). Callers must not promote while keys are still reappearing one by one (the first visible
   * key would lose its session).
   */
  promote(
    views: SessionView[],
    now: number,
    canAssign: (index: number) => boolean = () => true,
    pins: readonly string[] = [],
  ): void {
    const byId = new Map(views.map((v) => [v.id, v]));
    for (const id of this.#heldAt.keys()) if (!byId.has(id)) this.#heldAt.delete(id);
    // attention counts wherever the session is: waiting as "+N" and then getting a slot is no
    // reason to be the first one displaced
    for (const v of views) if (needsAttention(v)) this.#heldAt.set(v.id, now);
    const pinOf = (v: SessionView): number =>
      v.hostSessionId === null ? -1 : pins.indexOf(v.hostSessionId);
    const unpinned = (v: SessionView): boolean => pinOf(v) < 0;
    for (const v of this.overflow(views).filter(needsAttention)) {
      const i = this.#calmest(byId, now, canAssign, unpinned);
      const j = i >= 0 ? i : this.#calmest(byId, now, canAssign, () => true);
      if (j < 0) return;
      this.#slots[j] = v.id;
    }
    const pinned = this.overflow(views)
      .filter((v) => !unpinned(v) && !needsAttention(v))
      .sort((a, b) => Number(isResting(a)) - Number(isResting(b)) || pinOf(a) - pinOf(b));
    // a resting claimant can only use the slot of a resting session: running ones leave those to it
    const restingWaits = pinned.some(isResting);
    for (const v of pinned) {
      const may = (w: SessionView): boolean => unpinned(w) && (isResting(w) || !isResting(v));
      const running = (w: SessionView): boolean => may(w) && !isResting(w);
      let i = restingWaits && !isResting(v) ? this.#calmest(byId, now, canAssign, running) : -1;
      if (i < 0) i = this.#calmest(byId, now, canAssign, may);
      if (i < 0) return;
      this.#slots[i] = v.id;
    }
  }

  /**
   * The allowed index whose session may be displaced, among those `may` admits: calm longest first
   * (oldest attention, never = longest), then the calmer state, then the later slot. -1 when every
   * such slot is protected.
   */
  #calmest(
    byId: Map<string, SessionView>,
    now: number,
    canAssign: (index: number) => boolean,
    may: (v: SessionView) => boolean,
  ): number {
    let best = -1;
    let bestHeld = 0;
    let bestRank = 0;
    this.#slots.forEach((id, i) => {
      const v = id === null ? undefined : byId.get(id);
      if (!v || !canAssign(i) || needsAttention(v) || !may(v)) return;
      const held = this.#heldAt.get(v.id) ?? Number.NEGATIVE_INFINITY;
      // a hold in the future (clock set back) does not protect
      if (now - held >= 0 && now - held < ATTENTION_HOLD_MS) return;
      const rank = STATE_RANK[v.state];
      if (best < 0 || held < bestHeld || (held === bestHeld && rank >= bestRank)) {
        best = i;
        bestHeld = held;
        bestRank = rank;
      }
    });
    return best;
  }

  idAt(index: number): string | null {
    return this.#slots[index] ?? null;
  }

  overflow(views: SessionView[]): SessionView[] {
    const assigned = new Set(this.#slots);
    return views.filter((v) => !assigned.has(v.id)).sort(compareSeverity);
  }
}
