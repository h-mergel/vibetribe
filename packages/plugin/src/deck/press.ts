import type { SessionView } from "@vibetribe/core";

export type PressKind = "short" | "long";

/**
 * What a key press asks the adapter to do. `jump` carries the validated link; `markSeen` is true
 * for slot keys (spec §4.4 a) and false for the inbox. `landed` is the inbox session the user
 * stayed on (only sessions with a link); the adapter marks it seen unless its jump failed.
 * `open_usage` asks for the claude.ai usage settings page (Extra key).
 */
export type DeckCommand =
  | { type: "jump"; session: SessionView; url: string; markSeen: boolean }
  | { type: "no_target"; session: SessionView }
  | { type: "landed"; session: SessionView }
  | { type: "seen"; session: SessionView }
  | { type: "refresh_usage" }
  | { type: "open_debug" }
  | { type: "open_usage" };

/** Spec §4.4 (c): a long press is ≥ 600 ms. */
export const LONG_PRESS_MS = 600;

/**
 * Turns key-down/key-up pairs into short or long presses. Pure: the adapter passes the clock.
 * Stream Deck has no long-press event; a key that disappears while held never reports an up.
 */
export class PressTracker {
  readonly #downAt = new Map<string, number>();

  down(id: string, now: number): void {
    this.#downAt.set(id, now);
  }

  /** The press that just ended, or null for an up without a matching down. */
  up(id: string, now: number): PressKind | null {
    const at = this.#downAt.get(id);
    if (at === undefined) return null;
    this.#downAt.delete(id);
    return now - at >= LONG_PRESS_MS ? "long" : "short";
  }

  cancel(id: string): void {
    this.#downAt.delete(id);
  }
}
