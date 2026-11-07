export type WindowId = "five_hour" | "seven_day";
export type LimitLevel = "neutral" | "amber" | "red";

export interface WindowInput {
  usedPct: number;
  /** ms epoch */
  resetsAt: number | null;
}

export const EXTRA_INACTIVE = ["no_credit", "limit_reached", "disabled", "other"] as const;
/** Why extra usage is not active; absent while it is enabled (or for old caches). */
export type ExtraInactive = (typeof EXTRA_INACTIVE)[number];

/** "expired": the login is missing or was rejected; the limit tiles ask to sign in. */
export type AuthState = "ok" | "expired";

export interface ExtraInput {
  enabled: boolean;
  usedCredits: number;
  monthlyLimit: number | null;
  currency: string;
  inactive?: ExtraInactive;
}

export interface EndpointInput {
  /** For both windows: null means the endpoint reports no such window; undefined, that it says nothing. */
  fiveHour?: WindowInput | null;
  sevenDay?: WindowInput | null;
  extra?: ExtraInput | null;
}

export interface StatuslineInput {
  fiveHour?: WindowInput;
  sevenDay?: WindowInput;
}

export interface WindowView {
  id: WindowId;
  usedPct: number;
  resetsAt: number | null;
  pacePct: number | null;
  aheadOfPlan: boolean;
  level: LimitLevel;
  stale: boolean;
  receivedAt: number;
  rolledOver: boolean;
}

export interface ExtraView extends ExtraInput {
  stale: boolean;
  receivedAt: number;
}

export const WINDOW_MS: Record<WindowId, number> = {
  five_hour: 5 * 3_600_000,
  seven_day: 7 * 86_400_000,
};
const WINDOW_STALE_MS = 15 * 60_000;
const EXTRA_STALE_MS = 10 * 60_000;
const AHEAD_MARGIN_PCT = 10;

interface Reading extends WindowInput {
  receivedAt: number;
  /** set when the reading was synthesized because the statusline stopped reporting a reset window */
  rolledOver: boolean;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function levelOf(pct: number): LimitLevel {
  if (pct >= 85) return "red";
  if (pct >= 60) return "amber";
  return "neutral";
}

export class LimitsStore {
  readonly #windows = new Map<WindowId, Reading>();
  /** When the endpoint last reported each absent window; never a window that has a reading. */
  readonly #noWindow = new Map<WindowId, number>();
  #extra: (ExtraInput & { receivedAt: number }) | null = null;
  #auth: AuthState = "ok";

  get auth(): AuthState {
    return this.#auth;
  }

  setAuthExpired(): void {
    this.#auth = "expired";
  }

  ingestEndpoint(input: EndpointInput, at: number): void {
    this.#auth = "ok";
    this.#ingestEndpointWindow("five_hour", input.fiveHour, at);
    this.#ingestEndpointWindow("seven_day", input.sevenDay, at);
    if (input.extra) this.#extra = { ...input.extra, receivedAt: at };
  }

  ingestStatusline(input: StatuslineInput, at: number): void {
    this.#ingestStatuslineWindow("five_hour", input.fiveHour, at);
    this.#ingestStatuslineWindow("seven_day", input.sevenDay, at);
  }

  window(id: WindowId, now: number): WindowView | null {
    const r = this.#windows.get(id);
    if (!r) return null;
    const rolledOver = r.rolledOver || (r.resetsAt !== null && now >= r.resetsAt);
    const usedPct = rolledOver ? 0 : clamp(r.usedPct, 0, 100);
    const resetsAt = rolledOver ? null : r.resetsAt;
    const len = WINDOW_MS[id];
    const pacePct =
      resetsAt === null ? null : clamp(((now - (resetsAt - len)) / len) * 100, 0, 100);
    return {
      id,
      usedPct,
      resetsAt,
      pacePct,
      aheadOfPlan: pacePct !== null && usedPct > pacePct + AHEAD_MARGIN_PCT,
      level: levelOf(usedPct),
      stale: now - r.receivedAt > WINDOW_STALE_MS,
      receivedAt: r.receivedAt,
      rolledOver,
    };
  }

  /** The windows the endpoint reported as absent; a stale report no longer counts. */
  noWindow(now: number): WindowId[] {
    return [...this.#noWindow].filter(([, at]) => now - at <= WINDOW_STALE_MS).map(([id]) => id);
  }

  extra(now: number): ExtraView | null {
    if (!this.#extra) return null;
    return { ...this.#extra, stale: now - this.#extra.receivedAt > EXTRA_STALE_MS };
  }

  /** A null only replaces a stale reading: a fresh one may come from a statusline that still reports it. */
  #ingestEndpointWindow(id: WindowId, input: WindowInput | null | undefined, at: number): void {
    if (input) {
      this.#put(id, input, at);
      return;
    }
    if (input === undefined) {
      this.#noWindow.delete(id);
      return;
    }
    const old = this.#windows.get(id);
    if (old && at - old.receivedAt <= WINDOW_STALE_MS) return;
    this.#windows.delete(id);
    this.#noWindow.set(id, at);
  }

  #ingestStatuslineWindow(id: WindowId, input: WindowInput | undefined, at: number): void {
    if (input) {
      this.#put(id, input, at);
      return;
    }
    const old = this.#windows.get(id);
    if (old && old.resetsAt !== null && old.resetsAt <= at)
      this.#put(id, { usedPct: 0, resetsAt: null }, at, true);
  }

  #put(id: WindowId, input: WindowInput, at: number, rolledOver = false): void {
    const old = this.#windows.get(id);
    if (old && old.receivedAt > at) return;
    this.#noWindow.delete(id);
    this.#windows.set(id, { ...input, receivedAt: at, rolledOver });
  }
}
