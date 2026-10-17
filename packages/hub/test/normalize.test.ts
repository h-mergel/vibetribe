import type { HookEnvelope, HookEventData } from "@vibetribe/protocol";
import { describe, expect, it } from "vitest";
import { backgroundKind, normalizeHook } from "../src/normalize";

function env(event: Partial<HookEventData>): HookEnvelope {
  return {
    v: 1,
    kind: "hook",
    source: { host: "wsl:Ubuntu", os: "wsl", distro: "Ubuntu", entrypoint: "claude-desktop" },
    session: { id: "s1", cwd: "/tmp/p", pid: 7, hostSessionId: "local_x" },
    event: {
      name: "Stop",
      ts: 1,
      toolName: null,
      toolUseId: null,
      agentId: null,
      notificationType: null,
      errorType: null,
      reason: null,
      auto: null,
      backgroundTasks: null,
      ...event,
    },
  };
}
const base = {
  key: { host: "wsl:Ubuntu", sessionId: "s1" },
  hostKind: "wsl",
  at: 100,
  cwd: "/tmp/p",
};

describe("normalizeHook", () => {
  it("carries the hook cwd on events other than SessionStart", () => {
    expect(
      normalizeHook(env({ name: "PermissionRequest", toolName: "Bash" }), 100)[0],
    ).toMatchObject({
      type: "wait_start",
      cwd: "/tmp/p",
    });
  });

  it.each([
    ["SessionStart", {}, [{ ...base, type: "session_start", cwd: "/tmp/p" }]],
    ["UserPromptSubmit", { auto: true }, [{ ...base, type: "prompt_submit", auto: true }]],
    ["UserPromptSubmit", { auto: null }, [{ ...base, type: "prompt_submit", auto: false }]],
    [
      "PreToolUse",
      { toolName: "Bash", toolUseId: "t1" },
      [{ ...base, type: "tool_start", toolName: "Bash", toolUseId: "t1", agentId: null }],
    ],
    [
      "PostToolUse",
      { toolName: "Bash", toolUseId: "t1" },
      [{ ...base, type: "tool_end", toolName: "Bash", toolUseId: "t1", agentId: null }],
    ],
    [
      "PostToolUseFailure",
      { toolName: "Bash" },
      [{ ...base, type: "tool_end", toolName: "Bash", toolUseId: null, agentId: null }],
    ],
    [
      "PermissionRequest",
      { toolName: "Bash", agentId: "a1" },
      [
        {
          ...base,
          type: "wait_start",
          reason: "permission",
          waitId: null,
          toolName: "Bash",
          agentId: "a1",
        },
      ],
    ],
    [
      "PermissionRequest",
      { toolName: "AskUserQuestion" },
      [
        {
          ...base,
          type: "wait_start",
          reason: "input",
          waitId: null,
          toolName: "AskUserQuestion",
          agentId: null,
        },
      ],
    ],
    [
      "PermissionRequest",
      { toolName: "ExitPlanMode" },
      [
        {
          ...base,
          type: "wait_start",
          reason: "input",
          waitId: null,
          toolName: "ExitPlanMode",
          agentId: null,
        },
      ],
    ],
    [
      "Notification",
      { notificationType: "permission_prompt" },
      [{ ...base, type: "wait_start", reason: "permission", waitId: null }],
    ],
    [
      "Notification",
      { notificationType: "elicitation_dialog" },
      [{ ...base, type: "wait_start", reason: "input", waitId: null }],
    ],
    [
      "Notification",
      { notificationType: "agent_needs_input" },
      [{ ...base, type: "wait_start", reason: "input", waitId: null }],
    ],
    ["Notification", { notificationType: "idle_prompt" }, []],
    [
      "Notification",
      { notificationType: "quota_auto_resume_fired" },
      [{ ...base, type: "quota_resumed" }],
    ],
    [
      "Notification",
      { notificationType: "quota_auto_resume_scheduled" },
      [{ ...base, type: "throttle_start" }],
    ],
    ["Elicitation", {}, [{ ...base, type: "wait_start", reason: "input", waitId: "elicitation" }]],
    ["ElicitationResult", {}, [{ ...base, type: "wait_end", waitId: "elicitation" }]],
    [
      "StopFailure",
      { errorType: "rate_limit" },
      [{ ...base, type: "stop_failure", error: "rate_limit" }],
    ],
    ["StopFailure", {}, [{ ...base, type: "stop_failure", error: "unknown" }]],
    ["SubagentStart", { agentId: "a1" }, [{ ...base, type: "subagent_start", agentId: "a1" }]],
    ["PreCompact", {}, [{ ...base, type: "compact" }]],
    ["SessionEnd", { reason: "clear" }, [{ ...base, type: "session_end", reason: "clear" }]],
    ["TaskCompleted", {}, []],
  ])("%s %j", (name, event, expected) => {
    expect(normalizeHook(env({ name, ...event }), 100)).toEqual(expected);
  });

  it("drops tool events without tool name and subagent events without agent id", () => {
    expect(normalizeHook(env({ name: "PreToolUse" }), 1)).toEqual([]);
    expect(normalizeHook(env({ name: "SubagentStart" }), 1)).toEqual([]);
  });

  it("maps Stop background tasks to kinds", () => {
    const out = normalizeHook(
      env({
        name: "Stop",
        backgroundTasks: [
          { id: "b1", type: "shell" },
          { id: "a1", type: "subagent" },
          { id: "c1", type: "cloud session" },
        ],
      }),
      5,
    );
    expect(out).toEqual([
      {
        ...base,
        at: 5,
        type: "stop",
        background: [
          { id: "b1", kind: "shell" },
          { id: "a1", kind: "agent" },
          { id: "c1", kind: "other" },
        ],
      },
    ]);
  });

  it("emits subagent_stop plus a background snapshot for SubagentStop", () => {
    const out = normalizeHook(
      env({ name: "SubagentStop", agentId: "a1", backgroundTasks: [{ id: "b1", type: "shell" }] }),
      5,
    );
    expect(out).toEqual([
      { ...base, at: 5, type: "subagent_stop", agentId: "a1" },
      { ...base, at: 5, type: "background_snapshot", background: [{ id: "b1", kind: "shell" }] },
    ]);
  });

  it("uses the envelope os as host kind", () => {
    const winEnv = {
      ...env({ name: "PreCompact" }),
      source: { host: "win", os: "windows" as const, distro: null, entrypoint: null },
    };
    expect(normalizeHook(winEnv, 1)[0]).toMatchObject({
      key: { host: "win", sessionId: "s1" },
      hostKind: "windows",
    });
  });
});

describe("backgroundKind", () => {
  it("maps known types and falls back to other", () => {
    expect(["shell", "subagent", "monitor", "MCP task"].map(backgroundKind)).toEqual([
      "shell",
      "agent",
      "monitor",
      "other",
    ]);
  });
});

describe("normalizeHook guards and null semantics", () => {
  it("Stop: empty task list clears jobs, null task list means no information", () => {
    expect(normalizeHook(env({ name: "Stop", backgroundTasks: [] }), 5)).toEqual([
      { ...base, at: 5, type: "stop", background: [] },
    ]);
    expect(normalizeHook(env({ name: "Stop", backgroundTasks: null }), 5)).toEqual([
      { ...base, at: 5, type: "stop", background: null },
    ]);
  });

  it("SubagentStop without background tasks emits only subagent_stop", () => {
    expect(
      normalizeHook(env({ name: "SubagentStop", agentId: "a1", backgroundTasks: null }), 5),
    ).toEqual([{ ...base, at: 5, type: "subagent_stop", agentId: "a1" }]);
  });

  it("SubagentStop without agent id still emits the background snapshot", () => {
    expect(
      normalizeHook(
        env({
          name: "SubagentStop",
          agentId: null,
          backgroundTasks: [{ id: "b1", type: "monitor" }],
        }),
        5,
      ),
    ).toEqual([
      { ...base, at: 5, type: "background_snapshot", background: [{ id: "b1", kind: "monitor" }] },
    ]);
  });

  it("SubagentStop with an empty task list emits a snapshot that clears jobs", () => {
    expect(
      normalizeHook(env({ name: "SubagentStop", agentId: "a1", backgroundTasks: [] }), 5),
    ).toEqual([
      { ...base, at: 5, type: "subagent_stop", agentId: "a1" },
      { ...base, at: 5, type: "background_snapshot", background: [] },
    ]);
  });

  it.each(["PostToolUse", "PostToolUseFailure"])("%s without tool name is dropped", (name) => {
    expect(normalizeHook(env({ name, toolName: null, toolUseId: "t1" }), 1)).toEqual([]);
  });

  it("tool events pass non-null agent and tool use ids through", () => {
    expect(
      normalizeHook(
        env({ name: "PreToolUse", toolName: "Bash", toolUseId: "t1", agentId: "a1" }),
        1,
      ),
    ).toEqual([
      { ...base, at: 1, type: "tool_start", toolName: "Bash", toolUseId: "t1", agentId: "a1" },
    ]);
    expect(
      normalizeHook(
        env({ name: "PostToolUse", toolName: "Bash", toolUseId: "t1", agentId: "a1" }),
        1,
      ),
    ).toEqual([
      { ...base, at: 1, type: "tool_end", toolName: "Bash", toolUseId: "t1", agentId: "a1" },
    ]);
  });

  it("PermissionRequest uses the tool use id as wait id", () => {
    expect(
      normalizeHook(env({ name: "PermissionRequest", toolName: "Bash", toolUseId: "t9" }), 1),
    ).toEqual([
      {
        ...base,
        at: 1,
        type: "wait_start",
        reason: "permission",
        waitId: "t9",
        toolName: "Bash",
        agentId: null,
      },
    ]);
  });

  it("Notification: URL elicitation is an input wait; unknown or null types are ignored", () => {
    expect(
      normalizeHook(env({ name: "Notification", notificationType: "elicitation_url_dialog" }), 1),
    ).toEqual([{ ...base, at: 1, type: "wait_start", reason: "input", waitId: null }]);
    expect(
      normalizeHook(env({ name: "Notification", notificationType: "something_new" }), 1),
    ).toEqual([]);
    expect(normalizeHook(env({ name: "Notification", notificationType: null }), 1)).toEqual([]);
  });
});
