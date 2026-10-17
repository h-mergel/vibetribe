import { CYCLE_WINDOW_MS } from "@vibetribe/core";
import type { HubConfig } from "@vibetribe/hub";

/**
 * The deck's own inbox jumps, by Desktop id. Opening a session by link makes Claude Desktop set its
 * focus about 2 s later, but while the user cycles through the inbox only the session they land on
 * counts as seen (spec §9): a focus up to CYCLE_WINDOW_MS after such a jump is not the user's.
 * The previous jump is kept too: a poll right after the latest one can still read the focus the
 * previous one caused, and a focus older than that was already read while the session waited.
 */
export class InboxOpens {
  readonly #cap: number;
  readonly #at = new Map<string, readonly number[]>();

  constructor(cap: number) {
    this.#cap = cap;
  }

  /** An inbox jump to this Desktop id starts now; the oldest id goes beyond `cap`. */
  note(desktopId: string, at: number): void {
    const latest = this.#at.get(desktopId)?.at(-1);
    this.#at.delete(desktopId);
    this.#at.set(desktopId, latest === undefined ? [at] : [latest, at]);
    if (this.#at.size > this.#cap) this.#at.delete(this.#at.keys().next().value ?? "");
  }

  /** The focus port without the focus the deck's own inbox jumps caused; no port stays none. */
  filter(focus: HubConfig["focus"]): HubConfig["focus"] {
    if (!focus) return null;
    return async (ids) => {
      const out = new Map<string, number>();
      for (const [id, f] of await focus(ids)) {
        const jumps = this.#at.get(id) ?? [];
        if (!jumps.some((j) => j <= f && f <= j + CYCLE_WINDOW_MS)) out.set(id, f);
      }
      return out;
    };
  }
}
