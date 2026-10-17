export const PROTOCOL_VERSION = 1 as const;

export type OsKind = "windows" | "wsl" | "mac";

export interface SourceInfo {
  /** host id, see hostId() — must match the hub's ids */
  host: string;
  os: OsKind;
  distro: string | null;
  /** CLAUDE_CODE_ENTRYPOINT, e.g. "claude-desktop" or "cli" */
  entrypoint: string | null;
}

export interface SessionRef {
  /** Claude Code session id (= sessionId of ~/.claude/sessions/<pid>.json) */
  id: string;
  cwd: string;
  /** CLAUDE_PID */
  pid: number | null;
  /** CLAUDE_CODE_HOST_SESSION_ID, Desktop id "local_…" */
  hostSessionId: string | null;
}

/** Claude Desktop's own session id (`local_<uuid>`, probe E), as a regex source. */
export const DESKTOP_SESSION_ID = "local_[0-9A-Za-z-]{1,64}";

const DESKTOP_ID = new RegExp(`^${DESKTOP_SESSION_ID}$`);

/** The whole string is a Desktop id, e.g. a session file's hostSessionId. */
export const isDesktopId = (id: string): boolean => DESKTOP_ID.test(id);

/** CLAUDE_CODE_ENTRYPOINT (and `entrypoint` of the session file) of a session Claude Desktop started. */
export const DESKTOP_ENTRYPOINT = "claude-desktop";

export interface BackgroundTaskRef {
  id: string;
  /** raw type from Claude Code: "shell", "subagent", … */
  type: string;
}

export interface HookEventData {
  /** hook_event_name */
  name: string;
  /** sender clock, ms */
  ts: number;
  toolName: string | null;
  toolUseId: string | null;
  agentId: string | null;
  notificationType: string | null;
  /** StopFailure error code only */
  errorType: string | null;
  reason: string | null;
  /** UserPromptSubmit only: automatic turn (task notification, peer message) */
  auto: boolean | null;
  /** Stop / SubagentStop only: snapshot of running background jobs */
  backgroundTasks: BackgroundTaskRef[] | null;
}

export interface HookEnvelope {
  v: typeof PROTOCOL_VERSION;
  kind: "hook";
  source: SourceInfo;
  session: SessionRef;
  event: HookEventData;
}

export interface WindowReading {
  usedPct: number;
  /** ms epoch */
  resetsAt: number | null;
}

export interface StatuslineEnvelope {
  v: typeof PROTOCOL_VERSION;
  kind: "statusline";
  source: SourceInfo;
  session: SessionRef;
  ts: number;
  fiveHour: WindowReading | null;
  sevenDay: WindowReading | null;
}

export type Envelope = HookEnvelope | StatuslineEnvelope;

export function hostId(os: OsKind, distro: string | null, hostname: string): string {
  if (os === "windows") return "win";
  if (os === "wsl") return `wsl:${distro ?? "unknown"}`;
  return `mac:${hostname.toLowerCase()}`;
}
