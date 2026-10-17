import { isAlarm } from "./ranking";
import type {
  BackgroundKind,
  BackgroundTask,
  CoreEvent,
  HostKind,
  SessionFileInfo,
  SessionKey,
  SessionState,
  WaitReason,
} from "./types";

export type Phase = "idle" | "working" | "done" | "error" | "throttled";

export interface Episode {
  since: number;
  seen: boolean;
}

export interface SessionRecord {
  key: SessionKey;
  hostKind: HostKind;
  cwd: string;
  file: SessionFileInfo | null;
  fileLinkedAt: number | null;
  phase: Phase;
  /**
   * open wait reasons keyed by `<tool_use_id>`, `name:<agent|main>:<tool|?>` (no tool_use_id),
   * `elicitation` or `file` (the session-file wait)
   */
  waits: Map<string, WaitReason>;
  background: Map<string, BackgroundKind>;
  backgroundChangedAt: number;
  detail: string | null;
  errorType: string | null;
  episode: Episode | null;
  lastStopAt: number | null;
  lastRealPromptAt: number | null;
  createdAt: number;
  lastEventAt: number;
}

const STOP_DEDUPE_MS = 10_000;
const FILE_WAIT_ID = "file";
const THROTTLE_ERRORS = new Set(["rate_limit", "overloaded"]);

export const jobsOf = (tasks: BackgroundTask[]): Map<string, BackgroundKind> =>
  new Map(tasks.map((t) => [t.id, t.kind]));

export function newSession(
  key: SessionKey,
  hostKind: HostKind,
  at: number,
  cwd: string,
): SessionRecord {
  return {
    key,
    hostKind,
    cwd,
    file: null,
    fileLinkedAt: null,
    phase: "idle",
    waits: new Map(),
    background: new Map(),
    backgroundChangedAt: at,
    detail: null,
    errorType: null,
    episode: null,
    lastStopAt: null,
    lastRealPromptAt: null,
    createdAt: at,
    lastEventAt: at,
  };
}

export function deriveState(rec: SessionRecord): SessionState {
  let permission = false;
  let input = false;
  for (const reason of rec.waits.values()) {
    if (reason === "permission") permission = true;
    else input = true;
  }
  if (permission) return "needs_permission";
  if (input) return "needs_input";
  const rest: SessionState = rec.background.size > 0 ? "background" : "idle";
  switch (rec.phase) {
    case "error":
      return "error";
    case "done":
      return rec.episode && !rec.episode.seen ? "done_unseen" : rest;
    case "throttled":
      return "throttled";
    case "working":
      return "working";
    case "idle":
      return rest;
  }
}

export function waitReasonFor(waitingFor: string | null): WaitReason {
  return waitingFor === "permission prompt" || waitingFor === "sandbox request"
    ? "permission"
    : "input";
}

function startEpisodeIfAlarm(rec: SessionRecord, before: SessionState, at: number): void {
  const after = deriveState(rec);
  if (isAlarm(after) && after !== before) rec.episode = { since: at, seen: false };
}

/** Key for waits without tool_use_id: scoped per agent ("main" = top level) and tool ("?" = unknown). */
const anonWaitKey = (
  agentId: string | null | undefined,
  toolName: string | null | undefined,
): string => `name:${agentId ?? "main"}:${toolName ?? "?"}`;

function sameJobs(a: Map<string, BackgroundKind>, b: Map<string, BackgroundKind>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, kind] of b) if (a.get(id) !== kind) return false;
  return true;
}

/**
 * A finished tool ends only waits of the same agent: its own tool_use_id, anonymous waits for the same tool,
 * and anonymous waits of that agent with unknown tool. The session-file wait belongs to the top-level agent.
 * A parallel subagent's tool_end therefore never clears another agent's open request.
 */
function clearToolWaits(
  rec: SessionRecord,
  toolName: string,
  toolUseId: string | null,
  agentId: string | null,
): void {
  if (toolUseId) rec.waits.delete(toolUseId);
  rec.waits.delete(anonWaitKey(agentId, toolName));
  rec.waits.delete(anonWaitKey(agentId, null));
  if (agentId === null) rec.waits.delete(FILE_WAIT_ID);
}

export function applyEvent(rec: SessionRecord, ev: CoreEvent): void {
  if (ev.type === "seen") {
    if (rec.episode) rec.episode.seen = true;
    return;
  }
  const before = deriveState(rec);
  rec.lastEventAt = ev.at;
  switch (ev.type) {
    case "session_start":
      if (ev.cwd) rec.cwd = ev.cwd;
      break;
    case "prompt_submit":
      rec.phase = "working";
      rec.waits.clear();
      rec.errorType = null;
      rec.detail = null;
      // automatic turns (background reports, loops) do not count as the user having looked
      if (!ev.auto) {
        if (rec.episode) rec.episode.seen = true;
        rec.lastRealPromptAt = ev.at;
      }
      break;
    case "tool_start":
      rec.phase = "working";
      rec.errorType = null;
      rec.detail = ev.toolName;
      break;
    case "tool_end":
      clearToolWaits(rec, ev.toolName, ev.toolUseId, ev.agentId);
      break;
    case "wait_start": {
      const anonymous = ev.waitId === null && (ev.toolName ?? null) === null;
      // probe B: a Notification follows the real request ~8 s later without any reference, so it is a
      // duplicate. Trade-off: ANY open wait suppresses an anonymous one, including an unrelated wait.
      // That loss is rare and self-healing (the next tool_end or stop clears the open wait). The rule
      // assumes the probe-B order: the named request comes first, the Notification about 8 s later.
      if (anonymous && rec.waits.size > 0) break;
      rec.waits.set(ev.waitId ?? anonWaitKey(ev.agentId, ev.toolName), ev.reason);
      break;
    }
    case "wait_end":
      rec.waits.delete(ev.waitId);
      break;
    case "stop": {
      const dedupe =
        rec.lastStopAt !== null &&
        ev.at - rec.lastStopAt < STOP_DEDUPE_MS &&
        (rec.lastRealPromptAt === null || rec.lastRealPromptAt < rec.lastStopAt);
      rec.phase = "done";
      rec.waits.clear();
      rec.detail = null;
      rec.errorType = null;
      if (ev.background) {
        rec.background = jobsOf(ev.background);
        rec.backgroundChangedAt = ev.at;
      }
      if (!dedupe || !rec.episode) rec.episode = { since: ev.at, seen: false };
      rec.lastStopAt = ev.at;
      return;
    }
    case "background_snapshot": {
      const next = jobsOf(ev.background);
      // an identical snapshot (e.g. every SubagentStop) must not reset the stale timer of a stuck job
      if (!sameJobs(rec.background, next)) rec.backgroundChangedAt = ev.at;
      rec.background = next;
      break;
    }
    case "stop_failure":
      rec.waits.clear();
      rec.detail = null;
      rec.errorType = ev.error;
      rec.phase = THROTTLE_ERRORS.has(ev.error) ? "throttled" : "error";
      break;
    case "throttle_start":
      rec.phase = "throttled";
      rec.errorType = "quota";
      break;
    case "quota_resumed":
      if (rec.phase === "throttled") {
        rec.phase = "working";
        rec.errorType = null;
      }
      break;
    case "subagent_start":
      rec.background.set(ev.agentId, "agent");
      rec.backgroundChangedAt = ev.at;
      if (rec.phase === "working") rec.detail = "Subagent";
      break;
    case "subagent_stop":
      if (rec.background.delete(ev.agentId)) rec.backgroundChangedAt = ev.at;
      break;
    case "compact":
      rec.phase = "working";
      rec.detail = "Kompaktiert";
      break;
    case "session_end":
      return;
  }
  startEpisodeIfAlarm(rec, before, ev.at);
}

/** `info` is stored by reference: callers pass a fresh object per read and must not mutate it. */
export function applyFile(rec: SessionRecord, info: SessionFileInfo, at: number): void {
  const before = deriveState(rec);
  const firstSighting = rec.file === null;
  const prev = rec.file?.status ?? null;
  const now = info.status;
  rec.file = info;
  if (rec.fileLinkedAt === null) rec.fileLinkedAt = at;
  if (info.cwd) rec.cwd = info.cwd;

  if (firstSighting) {
    // also for hook-first sessions: a waiting file may be the only signal (e.g. no PermissionRequest hook)
    if (now === "waiting") rec.waits.set(FILE_WAIT_ID, waitReasonFor(info.waitingFor));
    else if (now === "busy" && rec.phase === "idle") rec.phase = "working";
  } else if (prev === "waiting" && now !== "waiting") {
    rec.waits.clear();
    if (now === "idle" && rec.phase === "working") rec.phase = "idle";
  } else if (prev !== "waiting" && now === "waiting") {
    rec.waits.set(FILE_WAIT_ID, waitReasonFor(info.waitingFor));
  } else if (prev === "busy" && now === "idle" && rec.phase === "working") {
    rec.phase = "idle";
  }
  // file turned busy (e.g. permission answered, new turn, resumed after an error) -> working
  if (!firstSighting && now === "busy" && prev !== "busy" && rec.phase !== "working") {
    rec.phase = "working";
    rec.errorType = null;
  }
  startEpisodeIfAlarm(rec, before, at);
}
