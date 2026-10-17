import type { SessionView } from "@vibetribe/core";
import { REMOTE_HOST } from "./names";

/**
 * A bridge id a local session file carried within this window stays local: the list may still
 * call the session connected for a while after the local process ended (no REM ghost).
 */
export const LOCAL_BRIDGE_HOLD_MS = 120_000;

/**
 * Which Remote Control bridge ids local sessions carry (spec §4.3, local before remote): a remote
 * listing entry with such an id is the local session, now and for LOCAL_BRIDGE_HOLD_MS after.
 */
export class LocalBridges {
  /** bridgeSessionId -> when a local session last carried it */
  readonly #seenAt = new Map<string, number>();
  #current = new Set<string>();

  /** Notes the bridge ids local sessions carry now; true when one appeared or vanished. */
  note(views: readonly Pick<SessionView, "key" | "bridgeSessionId">[], now: number): boolean {
    const current = new Set<string>();
    for (const v of views)
      if (v.key.host !== REMOTE_HOST && v.bridgeSessionId !== null) current.add(v.bridgeSessionId);
    let changed = current.size !== this.#current.size;
    for (const id of current) {
      if (!this.#current.has(id)) changed = true;
      this.#seenAt.set(id, now);
    }
    for (const [id, seenAt] of this.#seenAt)
      if (now - seenAt >= LOCAL_BRIDGE_HOLD_MS) this.#seenAt.delete(id);
    this.#current = current;
    return changed;
  }

  /** The bridge ids that stay local for a listing taken at `at`. */
  heldAt(at: number): Set<string> {
    const held = new Set<string>();
    for (const [id, seenAt] of this.#seenAt) if (at - seenAt < LOCAL_BRIDGE_HOLD_MS) held.add(id);
    return held;
  }
}
