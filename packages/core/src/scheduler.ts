export const FRAME_PRIORITY = { state: 0, breathe: 1, clock: 2, working: 3 } as const;
export type FramePriority = (typeof FRAME_PRIORITY)[keyof typeof FRAME_PRIORITY];
export type SendImage = (context: string, image: string) => void;

interface PendingFrame {
  image: string;
  priority: FramePriority;
  seq: number;
}

/**
 * Plugin-wide setImage budget (Elgato guideline: max 10 per second).
 * `send` must not throw; adapters catch and log (spec §3.1). If it does throw anyway, the frame
 * stays pending and is not counted as sent.
 */
export class FrameScheduler {
  readonly #send: SendImage;
  readonly #max: number;
  readonly #pending = new Map<string, PendingFrame>();
  readonly #lastSent = new Map<string, string>();
  #sentAt: number[] = [];
  #lowSentAt: number[] = [];
  #seq = 0;
  #reserve = 0;

  constructor(send: SendImage, maxPerSecond = 10) {
    this.#send = send;
    this.#max = maxPerSecond;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  submit(context: string, image: string, priority: FramePriority): void {
    if (this.#lastSent.get(context) === image) {
      this.#pending.delete(context);
      return;
    }
    const prev = this.#pending.get(context);
    this.#pending.set(context, {
      image,
      priority: prev ? (Math.min(prev.priority, priority) as FramePriority) : priority,
      seq: prev?.seq ?? this.#seq++,
    });
  }

  forget(context: string): void {
    this.#pending.delete(context);
    this.#lastSent.delete(context);
  }

  /**
   * Keep `n` frames of every rolling second for state and breathe frames: clock and working frames
   * together may send at most `max - n` per rolling second. Default 0 (all priorities share the
   * budget).
   */
  setReserve(n: number): void {
    this.#reserve = Math.max(0, Math.min(n, this.#max - 1));
  }

  flush(now: number): number {
    const recent = (t: number) => t <= now && now - t < 1_000;
    this.#sentAt = this.#sentAt.filter(recent);
    this.#lowSentAt = this.#lowSentAt.filter(recent);
    let used = this.#sentAt.length;
    if (used >= this.#max) return 0;
    const queue = [...this.#pending.entries()].sort(
      (a, b) => a[1].priority - b[1].priority || a[1].seq - b[1].seq,
    );
    let sent = 0;
    for (const [context, frame] of queue) {
      if (used >= this.#max) break;
      const low = frame.priority >= FRAME_PRIORITY.clock;
      if (low && this.#lowSentAt.length >= this.#max - this.#reserve) continue;
      this.#send(context, frame.image);
      this.#pending.delete(context);
      this.#lastSent.set(context, frame.image);
      this.#sentAt.push(now);
      if (low) this.#lowSentAt.push(now);
      used += 1;
      sent += 1;
    }
    return sent;
  }
}

/** Breathing images per second and key (handoff §4.2: 4 steps per 1.2 s period, rounded up). */
export const BREATH_FPS = 4;
/** Working dots: one step every 2 s per key. */
const WORKING_FPS = 0.5;

/** What wants images every second, besides state changes. */
export interface FrameDemand {
  /** keys breathing now */
  breathing: number;
  /** clocks under one minute that tick every second; a breathing key's clock rides on its breath frames */
  secondClocks: number;
  /** working keys whose dots advance */
  working: number;
}

export interface FramePlan {
  /** working dots advance (false: they stand still) */
  workingTicks: boolean;
  /** second clocks step every 1 s, or every 2 s when the budget is still exceeded */
  clockStepS: 1 | 2;
}

/**
 * Budget guard (handoff §4.2): breathing has priority because it carries "needs you". Over the
 * budget, the working dots stop first; if that is not enough, second clocks move in 2 s steps.
 */
export function planFrames(d: FrameDemand, maxPerSecond = 10): FramePlan {
  const base = BREATH_FPS * d.breathing + d.secondClocks;
  if (base + WORKING_FPS * d.working <= maxPerSecond) return { workingTicks: true, clockStepS: 1 };
  if (base <= maxPerSecond) return { workingTicks: false, clockStepS: 1 };
  return { workingTicks: false, clockStepS: 2 };
}
