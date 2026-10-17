/** First resend of a refused frame, and its cap: the delay doubles per refusal in between. */
export const RETRY_FIRST_MS = 250;
export const RETRY_MAX_MS = 8_000;

/** `t` lies in the rolling second up to `now` (a time after `now`, clock set back, does not). */
const withinSecond = (t: number, now: number): boolean => t <= now && now - t < 1_000;

interface Accepted {
  image: string;
  at: number;
  /** the session a slot key showed in this image (null: none) */
  session: string | null;
}

/**
 * What each key really shows: the last image its surface accepted and the session a slot key showed
 * in it, so a press acts on what the user saw. A refused frame is not on the key: it is forgotten
 * (the scheduler would otherwise skip the identical image and the session would go stale) and
 * sent again after a growing delay per key, so a key the SDK keeps refusing cannot eat the frame
 * budget. Time is always a parameter.
 */
export class ShownFrames {
  readonly #accepted = new Map<string, Accepted>();
  /** session of the frame queued per slot key, until the surface accepts it */
  readonly #queued = new Map<string, string | null>();
  /** refused during the current flush */
  readonly #refusedNow = new Set<string>();
  readonly #delay = new Map<string, number>();
  readonly #retryAt = new Map<string, number>();
  /** when the surface accepted a frame, for the last second */
  #acceptedAt: number[] = [];

  /** A slot key's image is about to be submitted for `session`. */
  queue(id: string, session: string | null, image: string): void {
    this.#queued.set(id, session);
    // the scheduler skips an image the key already shows (a /clear successor in the same folder
    // looks identical): the key shows this session now as well
    const shown = this.#accepted.get(id);
    if (shown?.image === image) shown.session = session;
  }

  /** The surface took `image` (at `at`); the key's backoff starts over. */
  accepted(id: string, image: string, at: number): void {
    this.#accepted.set(id, { image, at, session: this.#queued.get(id) ?? null });
    this.#delay.delete(id);
    this.#retryAt.delete(id);
    this.#acceptedAt = [...this.#acceptedAt.filter((t) => withinSecond(t, at)), at];
  }

  /** Frames the surface accepted in the second before `now`. */
  acceptedLastSecond(now: number): number {
    return this.#acceptedAt.filter((t) => withinSecond(t, now)).length;
  }

  /** The surface refused the frame at `now`; the next try waits 250 ms, 500 ms, … up to 8 s. */
  refused(id: string, now: number): void {
    const delay = Math.min((this.#delay.get(id) ?? RETRY_FIRST_MS / 2) * 2, RETRY_MAX_MS);
    this.#delay.set(id, delay);
    this.#retryAt.set(id, now + delay);
    this.#refusedNow.add(id);
  }

  /** May a frame for this key be submitted at `now`? False while its backoff runs. */
  due(id: string, now: number): boolean {
    return now >= (this.#retryAt.get(id) ?? 0);
  }

  /** The session the key showed in its last accepted image. */
  sessionOf(id: string): string | null {
    return this.#accepted.get(id)?.session ?? null;
  }

  imageOf(id: string): string | null {
    return this.#accepted.get(id)?.image ?? null;
  }

  atOf(id: string): number | null {
    return this.#accepted.get(id)?.at ?? null;
  }

  /** The key is gone or redrawn from scratch: nothing is shown, no backoff. */
  forget(id: string): void {
    this.#accepted.delete(id);
    this.#queued.delete(id);
    this.#delay.delete(id);
    this.#retryAt.delete(id);
    this.#refusedNow.delete(id);
  }

  /** After a flush: forget what was refused; returns those keys so the caller drops them from the scheduler. */
  afterFlush(): string[] {
    const ids = [...this.#refusedNow];
    for (const id of ids) this.#accepted.delete(id);
    this.#refusedNow.clear();
    return ids;
  }
}
