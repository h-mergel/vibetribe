import {
  type BackgroundTaskRef,
  type HookEnvelope,
  hostId,
  isFiniteNumber,
  isObj,
  MAX_STRING,
  MAX_TASKS,
  type Obj,
  PROTOCOL_VERSION,
  type SessionRef,
  type SourceInfo,
  type StatuslineEnvelope,
  type WindowReading,
} from "@vibetribe/protocol";
import type { Env } from "./env";
import type { HostInfo } from "./host";

const AUTO_PREFIXES = ["<task-notification>", "Another Claude session sent a message:"];
/** Machine codes only (reason, notification_type, StopFailure error) — never free text. */
const CODE = /^[a-z_]{1,32}$/;

/** The JSON value of `text`, or null when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Non-empty string, truncated to MAX_STRING; anything else becomes null. */
function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, MAX_STRING) : null;
}

function code(v: unknown): string | null {
  const s = text(v);
  return s && CODE.test(s) ? s : null;
}

function positiveInt(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isAutoPrompt(prompt: unknown): boolean {
  if (typeof prompt !== "string") return false;
  const start = prompt.trimStart();
  return AUTO_PREFIXES.some((prefix) => start.startsWith(prefix));
}

function sourceOf(host: HostInfo, env: Env): SourceInfo {
  return {
    host: hostId(host.os, host.distro, host.hostname),
    os: host.os,
    distro: host.distro,
    entrypoint: text(env.CLAUDE_CODE_ENTRYPOINT),
  };
}

function sessionOf(p: Obj, sessionId: string, env: Env): SessionRef {
  return {
    id: sessionId,
    cwd: text(p.cwd) ?? text(env.CLAUDE_PROJECT_DIR) ?? "",
    pid: positiveInt(env.CLAUDE_PID),
    hostSessionId: text(env.CLAUDE_CODE_HOST_SESSION_ID),
  };
}

function tasksOf(v: unknown): BackgroundTaskRef[] | null {
  if (!Array.isArray(v)) return null;
  const tasks: BackgroundTaskRef[] = [];
  for (const t of v) {
    if (!isObj(t)) continue;
    const id = text(t.id);
    const type = text(t.type);
    if (id && type) tasks.push({ id, type });
    if (tasks.length >= MAX_TASKS) break;
  }
  return tasks;
}

export function buildHookEnvelope(
  payload: unknown,
  env: Env,
  host: HostInfo,
  now: number,
): HookEnvelope | null {
  if (!isObj(payload)) return null;
  const sessionId = text(payload.session_id);
  const name = text(payload.hook_event_name);
  if (!sessionId || !name) return null;
  return {
    v: PROTOCOL_VERSION,
    kind: "hook",
    source: sourceOf(host, env),
    session: sessionOf(payload, sessionId, env),
    event: {
      name,
      ts: now,
      toolName: text(payload.tool_name),
      toolUseId: text(payload.tool_use_id),
      agentId: text(payload.agent_id),
      notificationType: code(payload.notification_type),
      errorType: name === "StopFailure" ? code(payload.error) : null,
      reason: code(payload.reason),
      auto: name === "UserPromptSubmit" ? isAutoPrompt(payload.prompt) : null,
      backgroundTasks: tasksOf(payload.background_tasks),
    },
  };
}

function windowOf(v: unknown): WindowReading | null {
  if (!isObj(v) || !isFiniteNumber(v.used_percentage)) return null;
  const resets = isFiniteNumber(v.resets_at) ? v.resets_at * 1000 : null;
  return { usedPct: v.used_percentage, resetsAt: resets };
}

export function buildStatuslineEnvelope(
  payload: unknown,
  env: Env,
  host: HostInfo,
  now: number,
): StatuslineEnvelope | null {
  if (!isObj(payload)) return null;
  const sessionId = text(payload.session_id);
  if (!sessionId) return null;
  const limits = isObj(payload.rate_limits) ? payload.rate_limits : {};
  return {
    v: PROTOCOL_VERSION,
    kind: "statusline",
    source: sourceOf(host, env),
    session: sessionOf(payload, sessionId, env),
    ts: now,
    fiveHour: windowOf(limits.five_hour),
    sevenDay: windowOf(limits.seven_day),
  };
}
