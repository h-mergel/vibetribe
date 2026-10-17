import type { KeyFlash } from "@vibetribe/render";

/**
 * Press feedback per key: a flash ("Open…", "No link") for the session the press acted on, and a
 * status key that lists all sources. Time is always a parameter.
 */
export class PressFeedback {
  readonly #flash = new Map<string, { kind: KeyFlash; until: number; session: string }>();
  readonly #expanded = new Map<string, number>();

  flash(keyId: string, kind: KeyFlash, session: string, until: number): void {
    this.#flash.set(keyId, { kind, until, session });
  }

  expand(keyId: string, until: number): void {
    this.#expanded.set(keyId, until);
  }

  forget(keyId: string): void {
    this.#flash.delete(keyId);
    this.#expanded.delete(keyId);
  }

  /**
   * Feedback still running at `now`; expired entries are dropped. `sessionOn` names the session a
   * slot key holds now (undefined for other keys): a slot that changed its session drops the
   * flash, because "Open…" belongs to the old session.
   */
  active(
    now: number,
    sessionOn: (keyId: string) => string | null | undefined,
  ): { flash: Map<string, KeyFlash>; expanded: Set<string> } {
    const flash = new Map<string, KeyFlash>();
    for (const [id, f] of this.#flash) {
      const current = sessionOn(id);
      if (f.until > now && (current === undefined || current === f.session)) flash.set(id, f.kind);
      else this.#flash.delete(id);
    }
    const expanded = new Set<string>();
    for (const [id, until] of this.#expanded) {
      if (until > now) expanded.add(id);
      else this.#expanded.delete(id);
    }
    return { flash, expanded };
  }
}
