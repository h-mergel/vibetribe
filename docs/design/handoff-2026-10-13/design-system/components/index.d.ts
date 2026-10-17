/** VibeTribe tile renderer. Every function returns a complete 144 x 144 SVG string. */
export type SlotState = 'needs_permission' | 'needs_input' | 'error' | 'done_unseen' | 'throttled' | 'working' | 'background' | 'idle' | 'no_signal';
export type Origin = 'APP' | 'WIN' | 'WSL' | 'REM' | '?';  /* REM = remote sessions (model value MAC is shown as REM) */
export type Level = 'neutral' | 'amber' | 'red';
export type Health = 'ok' | 'stale' | 'missing' | 'off';

export interface SlotTileProps {
  kind: 'slot';
  /** Desktop session name or project folder. Wrapped to 2 lines, head…tail elision, emoji stripped. Empty → "–". */
  title: string;
  state: SlotState;
  badge: Origin;
  /** Wait time in seconds, shown as "42 s" / "3 min" / "1:05 h" / "12 h"; shown for needs_permission, needs_input, error, done_unseen. */
  wait?: number | string | null;
  /** working: tool name, "Subagent", "Kompaktiert"; error/throttled: error kind; background: job split. Never truncated: shown whole or dropped. */
  detail?: string | null;
  bgCount?: number | null;
  /** Counter unchanged for 30 min: badge and word show "?". */
  bgStale?: boolean;
  /** thick = unseen and needs me / error (phases A–C), thin = seen (phase D), normal = none. */
  frame?: 'thick' | 'thin' | 'normal';
  /** Accent opacity 0.35…1 for frame and tint only. Steps: 0.35, 0.675, 1, 0.675 at 4 fps. */
  level?: number;
  /** Jump to the session in progress: footer shows "Open…". */
  jumping?: boolean;
  /** working only: which of the three dots is lit (0–2), advanced every 2 s. */
  tick?: 0 | 1 | 2;
}
export interface EmptyTileProps { kind: 'empty' }
export interface InboxTileProps {
  kind: 'inbox';
  waiting: number;
  top: { title: string; state: SlotState; /** seconds the top session has waited (luftig shows it) */ wait?: number } | null;
  /** Running sessions beyond the available slots, shown as "+N" pill. */
  overflow?: number;
  /** While cycling (5 s window): 1-based position in the waiting list. */
  cycle?: { index: number; total: number } | null;
}
export interface LimitTileProps {
  kind: 'limit';
  label: '5h' | 'Week';
  usedPct: number | null;
  pacePct?: number | null;
  resetIn?: string;
  level?: Level;
  ahead?: boolean;
  stale?: boolean;
  /** Replaces the reset line: "As of 14:32", "Sign in", "No data", "New window". */
  note?: string | null;
}
export interface ExtraTileProps {
  kind: 'extra';
  used: string | null;
  limit: string | null;
  ratio: number | null;
  level?: Level;
  stale?: boolean;
  /** "As of 14:32", "Sign in", "No data", "Disabled" (= disabled, amount shows "aus"). */
  note?: string | null;
}
export interface StatusTileProps {
  kind: 'status';
  rows: { source: 'WIN' | 'WSL' | 'REM' | 'LIM'; health: Health }[];
  /** luftig: show all four sources (set for 5 s after a tap). */
  expanded?: boolean;
  /** Max. 11 characters, e.g. "Port in use", "No token". Adds a thick error frame. */
  alert?: string | null;
}
export interface GlyphsProps { name: string; color: string; size?: number; filled?: boolean }
export interface BreathingProps { frameIndex: number }
export interface DeckProps {}
export type TileModel = SlotTileProps | EmptyTileProps | InboxTileProps | LimitTileProps | ExtraTileProps | StatusTileProps;

export interface RenderOptions {
  /** 'luftig' (recommended default) or 'dicht' (all mandatory contents of the brief). Default: 'dicht'. */
  variant?: 'luftig' | 'dicht';
}
export interface Episode { id: string | number; state: SlotState; since: number; seen: boolean }
/** A breathing, B static urgent, C reminder pulse, D seen. */
export type Phase = 'A' | 'B' | 'C' | 'D';

export interface VibeTribeApi {
  render(model: TileModel, options?: RenderOptions): string;
  /** Which waiting episodes breathe now: max 2, newest phase-A episodes first, then the oldest one's reminder. */
  escalation(episodes: Episode[], nowSeconds: number): Record<string, Phase>;
  slot(m: SlotTileProps): string;
  empty(): string;
  inbox(m: InboxTileProps): string;
  limit(m: LimitTileProps): string;
  extra(m: ExtraTileProps): string;
  status(m: StatusTileProps): string;
  /** Breath level for frame n of the 4-step cycle. */
  breathLevel(frameIndex: number): number;
  clock(seconds: number): string;
  textWidth(s: string, size: number, weight: 400 | 700): number;
  tokens: Record<string, unknown>;
}
declare global { interface Window { VibeTribe: VibeTribeApi } }
