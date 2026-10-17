import type {
  BackgroundKind,
  BackgroundTask,
  CoreEvent,
  HostKind,
  SessionKey,
} from "@vibetribe/core";
import type { BackgroundTaskRef, HookEnvelope, OsKind } from "@vibetribe/protocol";

/** AskUserQuestion and ExitPlanMode arrive as PermissionRequest but wait for an answer, not a permission (probe B5). */
const INPUT_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
const INPUT_NOTIFICATIONS = new Set([
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);

interface Base {
  key: SessionKey;
  hostKind: HostKind;
  at: number;
  cwd: string;
}

/**
 * The reporter names the OS of its machine (protocol v1 stays as it is); for the hub a Mac is
 * another machine, so its sessions are remote (badge REM).
 */
export function hostKindOf(os: OsKind): HostKind {
  return os === "mac" ? "remote" : os;
}

export function backgroundKind(type: string): BackgroundKind {
  if (type === "shell") return "shell";
  if (type === "subagent") return "agent";
  if (type === "monitor") return "monitor";
  return "other";
}

const tasks = (refs: BackgroundTaskRef[]): BackgroundTask[] =>
  refs.map((t) => ({ id: t.id, kind: backgroundKind(t.type) }));

function notification(base: Base, type: string | null): CoreEvent[] {
  if (type === "permission_prompt")
    return [{ ...base, type: "wait_start", reason: "permission", waitId: null }];
  if (type && INPUT_NOTIFICATIONS.has(type))
    return [{ ...base, type: "wait_start", reason: "input", waitId: null }];
  if (type === "quota_auto_resume_fired") return [{ ...base, type: "quota_resumed" }];
  if (type?.startsWith("quota_auto_resume")) return [{ ...base, type: "throttle_start" }];
  return [];
}

/** Maps one raw hook envelope onto domain events (spec §4.2 normalization, probes B and M). */
export function normalizeHook(env: HookEnvelope, at: number): CoreEvent[] {
  const base: Base = {
    key: { host: env.source.host, sessionId: env.session.id },
    hostKind: hostKindOf(env.source.os),
    at,
    cwd: env.session.cwd,
  };
  const e = env.event;
  switch (e.name) {
    case "SessionStart":
      return [{ ...base, type: "session_start", cwd: env.session.cwd }];
    case "UserPromptSubmit":
      return [{ ...base, type: "prompt_submit", auto: e.auto === true }];
    case "PreToolUse":
      return e.toolName
        ? [
            {
              ...base,
              type: "tool_start",
              toolName: e.toolName,
              toolUseId: e.toolUseId,
              agentId: e.agentId,
            },
          ]
        : [];
    case "PostToolUse":
    case "PostToolUseFailure":
      return e.toolName
        ? [
            {
              ...base,
              type: "tool_end",
              toolName: e.toolName,
              toolUseId: e.toolUseId,
              agentId: e.agentId,
            },
          ]
        : [];
    case "PermissionRequest": {
      const reason = e.toolName && INPUT_TOOLS.has(e.toolName) ? "input" : "permission";
      return [
        {
          ...base,
          type: "wait_start",
          reason,
          waitId: e.toolUseId,
          toolName: e.toolName,
          agentId: e.agentId,
        },
      ];
    }
    case "Notification":
      return notification(base, e.notificationType);
    case "Elicitation":
      return [{ ...base, type: "wait_start", reason: "input", waitId: "elicitation" }];
    case "ElicitationResult":
      return [{ ...base, type: "wait_end", waitId: "elicitation" }];
    case "Stop":
      return [
        { ...base, type: "stop", background: e.backgroundTasks ? tasks(e.backgroundTasks) : null },
      ];
    case "StopFailure":
      return [{ ...base, type: "stop_failure", error: e.errorType ?? "unknown" }];
    case "SubagentStart":
      return e.agentId ? [{ ...base, type: "subagent_start", agentId: e.agentId }] : [];
    case "SubagentStop": {
      const out: CoreEvent[] = [];
      if (e.agentId) out.push({ ...base, type: "subagent_stop", agentId: e.agentId });
      if (e.backgroundTasks)
        out.push({ ...base, type: "background_snapshot", background: tasks(e.backgroundTasks) });
      return out;
    }
    case "PreCompact":
      return [{ ...base, type: "compact" }];
    case "SessionEnd":
      return [{ ...base, type: "session_end", reason: e.reason }];
    default:
      return [];
  }
}
