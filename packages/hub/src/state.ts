import type { AuthState, ExtraView, SessionView, WindowView } from "@vibetribe/core";

export type Health = "ok" | "stale" | "missing";

export interface SourceHealth {
  health: Health;
  lastAt: number | null;
  error: string | null;
}

export interface RecentEvent {
  at: number;
  host: string;
  sessionId: string;
  name: string;
}

/** What the hub knows at one moment: the deck draws it, /debug and /debug/state.json show it. */
export interface HubState {
  now: number;
  sessions: SessionView[];
  /** Code sessions pinned in Claude Desktop: Desktop ids (`local_…`) in sidebar order. */
  pins: string[];
  limits: {
    fiveHour: WindowView | null;
    sevenDay: WindowView | null;
    extra: ExtraView | null;
    auth: AuthState;
  };
  sources: Record<string, SourceHealth>;
  recent: RecentEvent[];
  invalidEnvelopes: number;
}
