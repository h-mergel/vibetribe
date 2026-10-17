/**
 * Where a session runs, seen from the hub: this PC (Windows, WSL) or another machine. `remote`
 * sessions (badge REM) are known only through a remote signal (the account's session list, a
 * future Mac agent); when that signal stops they go no_signal and are dropped (spec §4.2, §4.3).
 */
export type HostKind = "windows" | "wsl" | "remote";
/** Origin badge: where a session runs (spec §4.1), not how it was started. */
export type Badge = "WIN" | "WSL" | "REM";
export type SessionState =
  | "needs_permission"
  | "needs_input"
  | "error"
  | "done_unseen"
  | "throttled"
  | "working"
  | "background"
  | "idle"
  | "no_signal";
export type BackgroundKind = "shell" | "agent" | "monitor" | "other";
export type WaitReason = "permission" | "input";
export type FileStatus = "busy" | "idle" | "waiting";

export interface SessionKey {
  host: string;
  sessionId: string;
}

export const keyOf = (key: SessionKey): string => `${key.host}/${key.sessionId}`;

/**
 * Fields VibeTribe uses from ~/.claude/sessions/<pid>.json (already liveness-checked by the reader).
 * Callers pass a fresh object per read; it is stored by reference and must not be mutated.
 */
export interface SessionFileInfo {
  sessionId: string;
  /** null for sessions without a local process (remote sessions) */
  pid: number | null;
  cwd: string;
  entrypoint: string | null;
  name: string | null;
  hostSessionId: string | null;
  bridgeSessionId: string | null;
  status: FileStatus | null;
  waitingFor: string | null;
}

export interface BackgroundTask {
  id: string;
  kind: BackgroundKind;
}

/** The last known background jobs of one session; the hub keeps them across restarts. */
export interface BackgroundRecord {
  key: SessionKey;
  tasks: BackgroundTask[];
  /** when the job list last changed (hub clock); the 30 min stale mark counts from here */
  changedAt: number;
}

interface EventBase {
  key: SessionKey;
  hostKind: HostKind;
  /** receivedAt of the hub, in ms */
  at: number;
  /** cwd reported by the hook; lets a session first seen after SessionStart keep its folder name */
  cwd?: string;
}

/** Normalized hook events; the hub maps raw hook payloads onto these. */
export type CoreEvent =
  | (EventBase & { type: "session_start"; cwd: string })
  | (EventBase & { type: "prompt_submit"; auto: boolean })
  | (EventBase & {
      type: "tool_start";
      toolName: string;
      toolUseId: string | null;
      agentId: string | null;
    })
  | (EventBase & {
      type: "tool_end";
      toolName: string;
      toolUseId: string | null;
      agentId: string | null;
    })
  | (EventBase & {
      type: "wait_start";
      reason: WaitReason;
      /** tool_use_id or "elicitation"; null = anonymous (e.g. Notification without tool reference) */
      waitId: string | null;
      /** used to key anonymous waits per agent and tool */
      toolName?: string | null;
      agentId?: string | null;
    })
  | (EventBase & { type: "wait_end"; waitId: string })
  | (EventBase & { type: "stop"; background: BackgroundTask[] | null })
  | (EventBase & { type: "background_snapshot"; background: BackgroundTask[] })
  | (EventBase & { type: "stop_failure"; error: string })
  | (EventBase & { type: "throttle_start" })
  | (EventBase & { type: "quota_resumed" })
  | (EventBase & { type: "subagent_start"; agentId: string })
  | (EventBase & { type: "subagent_stop"; agentId: string })
  | (EventBase & { type: "compact" })
  | (EventBase & { type: "session_end"; reason: string | null })
  | (EventBase & { type: "seen" });

/** Full, authoritative list of live sessions of one host. */
export interface HostSnapshot {
  host: string;
  hostKind: HostKind;
  at: number;
  sessions: SessionFileInfo[];
}

export interface BackgroundSummary {
  count: number;
  kinds: Record<BackgroundKind, number>;
  stale: boolean;
}

export interface SessionView {
  id: string;
  key: SessionKey;
  hostKind: HostKind;
  badge: Badge;
  title: string;
  cwd: string;
  state: SessionState;
  detail: string | null;
  errorType: string | null;
  episodeSince: number | null;
  episodeSeen: boolean;
  background: BackgroundSummary;
  pid: number | null;
  entrypoint: string | null;
  hostSessionId: string | null;
  bridgeSessionId: string | null;
}

export type RemovalReason =
  | "end"
  | "clear"
  | "resume"
  | "gone"
  | "no_signal_timeout"
  | "hook_only_ttl";

export interface Removal {
  id: string;
  key: SessionKey;
  reason: RemovalReason;
  cwd: string;
  pid: number | null;
}
