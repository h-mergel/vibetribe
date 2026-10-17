import type { SessionState, SessionView } from "./types";

export const STATE_RANK: Record<SessionState, number> = {
  needs_permission: 0,
  needs_input: 1,
  error: 2,
  done_unseen: 3,
  throttled: 4,
  working: 5,
  background: 6,
  idle: 7,
  no_signal: 8,
};

export function compareSeverity(a: SessionView, b: SessionView): number {
  return (
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    (a.episodeSince ?? Number.MAX_SAFE_INTEGER) - (b.episodeSince ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id)
  );
}

/** needs_permission, needs_input or error: the states that start an episode. */
export const isAlarm = (state: SessionState): boolean => STATE_RANK[state] <= STATE_RANK.error;

/** An alarm or done_unseen: the session waits for the user (inbox count, wait clock). */
export const isWaitingState = (state: SessionState): boolean =>
  STATE_RANK[state] <= STATE_RANK.done_unseen;

export const isWaiting = (v: SessionView): boolean => isWaitingState(v.state);

/**
 * A waiting session not seen yet. It claims a visible slot (SlotTable) and counts as "+N" on the
 * inbox while it has none; every other session is calm. Done counts too: a finished turn is as
 * prominent as Input/Approve until it is seen, but it never breathes (`animatedIds`).
 */
export const needsAttention = (v: SessionView): boolean => isWaiting(v) && !v.episodeSeen;

export function waitingInOrder(views: SessionView[]): SessionView[] {
  return views.filter(isWaiting).sort(compareSeverity);
}

export interface InboxSummary {
  top: SessionView | null;
  waitingCount: number;
  overflowCount: number;
}

/** How long the inbox keeps cycling after a press. */
export const CYCLE_WINDOW_MS = 5_000;

/**
 * The host calls `settle(now)` on a timer (at least every second) and before every `press`;
 * otherwise a landing can be lost.
 */
export class InboxCycler {
  #lastPressAt: number | null = null;
  #index = 0;
  #current: string | null = null;

  /** Returns the session to jump to. */
  press(now: number, waiting: SessionView[]): string | null {
    if (waiting.length === 0) {
      this.#lastPressAt = null;
      this.#current = null;
      return null;
    }
    const withinWindow = this.#lastPressAt !== null && now - this.#lastPressAt < CYCLE_WINDOW_MS;
    this.#index = withinWindow ? (this.#index + 1) % waiting.length : 0;
    this.#lastPressAt = now;
    this.#current = waiting[this.#index]?.id ?? null;
    return this.#current;
  }

  /**
   * The session the last press jumped to, while its window runs (the inbox shows it as "next"
   * with its position); null outside the window.
   */
  current(now: number): string | null {
    if (this.#lastPressAt === null || now - this.#lastPressAt >= CYCLE_WINDOW_MS) return null;
    return this.#current;
  }

  /** Returns the session the user landed on once the window has passed (to be marked seen), once. */
  settle(now: number): string | null {
    if (
      this.#current !== null &&
      this.#lastPressAt !== null &&
      now - this.#lastPressAt >= CYCLE_WINDOW_MS
    ) {
      const landed = this.#current;
      this.#current = null;
      return landed;
    }
    return null;
  }
}
