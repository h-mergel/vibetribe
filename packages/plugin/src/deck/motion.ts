import { type FrameDemand, isWaitingState, planFrames, type SessionView } from "@vibetribe/core";

/** Working dots: the lit dot moves every 2 s (handoff › Bewegung). */
export const WORKING_TICK_MS = 2_000;

/** A wait clock ticks every second only in its first minute ("42 s"), then every minute. */
const SECOND_CLOCK_MS = 60_000;

export interface MotionInput {
  /** sessions on visible slot keys */
  shown: readonly SessionView[];
  /** sessions breathing now (core `animatedIds`) */
  animated: ReadonlySet<string>;
  /** the session whose wait clock the inbox shows (comfortable, inbox key visible), else null */
  inboxClock: SessionView | null;
}

export interface MotionFrame {
  /** lit working dot, 0–2 */
  tick: number;
  /** step of clocks under one minute */
  clockStepS: 1 | 2;
}

const ticksEverySecond = (v: SessionView, now: number): boolean =>
  isWaitingState(v.state) && v.episodeSince !== null && now - v.episodeSince < SECOND_CLOCK_MS;

/**
 * Images per second the visible keys want besides state changes. A breathing key's clock rides on
 * its breath frames and costs nothing extra; the inbox clock is a key of its own.
 */
export function frameDemand(input: MotionInput, now: number): FrameDemand {
  const calm = input.shown.filter((v) => !input.animated.has(v.id));
  const inbox = input.inboxClock !== null && ticksEverySecond(input.inboxClock, now) ? 1 : 0;
  return {
    breathing: input.shown.length - calm.length,
    secondClocks: calm.filter((v) => ticksEverySecond(v, now)).length + inbox,
    working: input.shown.filter((v) => v.state === "working").length,
  };
}

/**
 * The deck's motion state (handoff §4.2): the working dot advances every 2 s while the budget
 * guard (core `planFrames`) allows it, and clocks under one minute fall back to 2 s steps when
 * the budget is still exceeded. Pure; time is a parameter.
 */
export class Motion {
  readonly #budget: number;
  #tick = 0;
  #tickAt: number | null = null;

  /** One frame per second stays free for state changes (the FrameScheduler reserve). */
  constructor(maxFramesPerSecond: number) {
    this.#budget = Math.max(1, maxFramesPerSecond - 1);
  }

  frame(now: number, input: MotionInput): MotionFrame {
    const plan = planFrames(frameDemand(input, now), this.#budget);
    if (this.#tickAt === null || now < this.#tickAt) this.#tickAt = now;
    else if (plan.workingTicks && now - this.#tickAt >= WORKING_TICK_MS) {
      this.#tick = (this.#tick + 1) % 3;
      this.#tickAt = now;
    }
    return { tick: this.#tick, clockStepS: plan.clockStepS };
  }
}
