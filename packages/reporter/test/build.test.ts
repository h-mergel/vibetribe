import { parseEnvelope } from "@vibetribe/protocol";
import { describe, expect, it } from "vitest";
import { buildHookEnvelope, buildStatuslineEnvelope, isAutoPrompt } from "../src/build";
import type { HostInfo } from "../src/host";

const WSL: HostInfo = { os: "wsl", distro: "Ubuntu", hostname: "DRAGONFLY-PC" };
const DESKTOP_ENV = {
  CLAUDE_PID: "773707",
  CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
  CLAUDE_CODE_HOST_SESSION_ID: "local_7b1f",
  CLAUDE_PROJECT_DIR: "/tmp/vt-probe",
};

describe("buildHookEnvelope", () => {
  it("maps a PermissionRequest with env values and no free text", () => {
    const payload = {
      session_id: "57cb6ddb",
      hook_event_name: "PermissionRequest",
      cwd: "/tmp/vt-probe",
      tool_name: "Bash",
      tool_input: { command: "touch /tmp/secret" },
      permission_suggestions: [{ type: "addRules" }],
      agent_id: "a3644938",
    };
    const env = buildHookEnvelope(payload, DESKTOP_ENV, WSL, 1_000);
    expect(env).toEqual({
      v: 1,
      kind: "hook",
      source: { host: "wsl:Ubuntu", os: "wsl", distro: "Ubuntu", entrypoint: "claude-desktop" },
      session: { id: "57cb6ddb", cwd: "/tmp/vt-probe", pid: 773707, hostSessionId: "local_7b1f" },
      event: {
        name: "PermissionRequest",
        ts: 1_000,
        toolName: "Bash",
        toolUseId: null,
        agentId: "a3644938",
        notificationType: null,
        errorType: null,
        reason: null,
        auto: null,
        backgroundTasks: null,
      },
    });
    expect(JSON.stringify(env)).not.toContain("secret");
  });

  it("marks automatic turns by prompt prefix and never sends the prompt", () => {
    const base = { session_id: "s", hook_event_name: "UserPromptSubmit", cwd: "/p" };
    const auto = buildHookEnvelope(
      { ...base, prompt: "<task-notification>\n<task-id>x" },
      {},
      WSL,
      1,
    );
    const peer = buildHookEnvelope(
      { ...base, prompt: "Another Claude session sent a message:\n…" },
      {},
      WSL,
      1,
    );
    const real = buildHookEnvelope({ ...base, prompt: "Mach weiter" }, {}, WSL, 1);
    expect(auto?.event.auto).toBe(true);
    expect(peer?.event.auto).toBe(true);
    expect(real?.event.auto).toBe(false);
    expect(JSON.stringify(real)).not.toContain("Mach weiter");
  });

  it("keeps StopFailure error codes but drops PostToolUseFailure error messages", () => {
    const stopFailure = buildHookEnvelope(
      { session_id: "s", hook_event_name: "StopFailure", error: "rate_limit" },
      {},
      WSL,
      1,
    );
    const toolFailure = buildHookEnvelope(
      {
        session_id: "s",
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        error: "ENOENT: no such file",
      },
      {},
      WSL,
      1,
    );
    expect(stopFailure?.event.errorType).toBe("rate_limit");
    expect(toolFailure?.event.errorType).toBeNull();
  });

  it("sets errorType only for StopFailure, even when the error is a valid code word", () => {
    const toolFailure = buildHookEnvelope(
      {
        session_id: "s",
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        error: "timeout",
      },
      {},
      WSL,
      1,
    );
    expect(toolFailure?.event.errorType).toBeNull();
  });

  it("passes reason and notification_type only as machine codes", () => {
    const end = buildHookEnvelope(
      { session_id: "s", hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
      {},
      WSL,
      1,
    );
    const odd = buildHookEnvelope(
      {
        session_id: "s",
        hook_event_name: "Notification",
        notification_type: "Free text here",
        reason: "because I said so",
      },
      {},
      WSL,
      1,
    );
    expect(end?.event.reason).toBe("prompt_input_exit");
    expect(odd?.event.notificationType).toBeNull();
    expect(odd?.event.reason).toBeNull();
  });

  it("maps background tasks to id and type only", () => {
    const env = buildHookEnvelope(
      {
        session_id: "s",
        hook_event_name: "Stop",
        background_tasks: [
          {
            id: "bq591z5wz",
            type: "shell",
            status: "running",
            description: "Wait",
            command: "sleep 60",
          },
          { id: "aa71", type: "subagent", agent_type: "general-purpose" },
          { type: "shell" },
        ],
      },
      {},
      WSL,
      1,
    );
    expect(env?.event.backgroundTasks).toEqual([
      { id: "bq591z5wz", type: "shell" },
      { id: "aa71", type: "subagent" },
    ]);
  });

  it("falls back to CLAUDE_PROJECT_DIR for cwd and null for a missing or invalid pid", () => {
    const env = buildHookEnvelope(
      { session_id: "s", hook_event_name: "Stop" },
      { CLAUDE_PROJECT_DIR: "/x", CLAUDE_PID: "abc" },
      WSL,
      1,
    );
    expect(env?.session).toEqual({ id: "s", cwd: "/x", pid: null, hostSessionId: null });
  });

  it("returns null without session id or event name, or for non-objects", () => {
    expect(buildHookEnvelope({ hook_event_name: "Stop" }, {}, WSL, 1)).toBeNull();
    expect(buildHookEnvelope({ session_id: "s" }, {}, WSL, 1)).toBeNull();
    expect(buildHookEnvelope("nope", {}, WSL, 1)).toBeNull();
    expect(buildHookEnvelope(null, {}, WSL, 1)).toBeNull();
  });

  it("truncates overlong strings to 512 characters", () => {
    const env = buildHookEnvelope(
      { session_id: "s", hook_event_name: "Stop", cwd: "x".repeat(600) },
      {},
      WSL,
      1,
    );
    expect(env?.session.cwd).toHaveLength(512);
  });
});

type CodeField = {
  label: string;
  event: string;
  key: string;
  read: (env: ReturnType<typeof buildHookEnvelope>) => string | null | undefined;
};

const CODE_FIELDS: CodeField[] = [
  { label: "reason", event: "SessionEnd", key: "reason", read: (e) => e?.event.reason },
  {
    label: "notification_type",
    event: "Notification",
    key: "notification_type",
    read: (e) => e?.event.notificationType,
  },
  {
    label: "StopFailure error",
    event: "StopFailure",
    key: "error",
    read: (e) => e?.event.errorType,
  },
];

const CODE_CASES: Array<[string, unknown, string | null]> = [
  ["accepts a plain code", "permission_prompt", "permission_prompt"],
  ["accepts 32 characters", "a_".repeat(16), "a_".repeat(16)],
  ["drops 33 characters", "a".repeat(33), null],
  ["drops uppercase", "Rate_Limit", null],
  ["drops a hyphen", "rate-limit", null],
  ["drops a digit", "rate1", null],
  ["drops an empty string", "", null],
  ["drops a trailing newline", "abc\n", null],
  ["drops a number", 42, null],
  ["drops free text", "Free text here", null],
];

describe.each(CODE_FIELDS)("machine code filter for $label", ({ event, key, read }) => {
  it.each(CODE_CASES)("%s", (_name, value, expected) => {
    const env = buildHookEnvelope(
      { session_id: "s", hook_event_name: event, [key]: value },
      {},
      WSL,
      1,
    );
    expect(read(env)).toBe(expected);
  });
});

describe("isAutoPrompt", () => {
  it("ignores leading whitespace and non-strings", () => {
    expect(isAutoPrompt("  <task-notification>")).toBe(true);
    expect(isAutoPrompt(undefined)).toBe(false);
  });

  it("requires the marker at the start of the prompt", () => {
    expect(isAutoPrompt("hi <task-notification>")).toBe(false);
    expect(isAutoPrompt("Please relay: Another Claude session sent a message: hi")).toBe(false);
    expect(isAutoPrompt("\n\t <task-notification>…")).toBe(true);
  });
});

describe("buildStatuslineEnvelope", () => {
  it("maps rate limits (resets_at seconds -> ms)", () => {
    const env = buildStatuslineEnvelope(
      {
        session_id: "s",
        cwd: "C:/dev",
        rate_limits: {
          five_hour: { used_percentage: 20, resets_at: 1_791_650_000 },
          seven_day: { used_percentage: 86 },
        },
      },
      { CLAUDE_CODE_ENTRYPOINT: "cli" },
      { os: "windows", distro: null, hostname: "PC" },
      5,
    );
    expect(env).toMatchObject({
      kind: "statusline",
      source: { host: "win", os: "windows", entrypoint: "cli" },
      session: { id: "s", cwd: "C:/dev" },
      ts: 5,
      fiveHour: { usedPct: 20, resetsAt: 1_791_650_000_000 },
      sevenDay: { usedPct: 86, resetsAt: null },
    });
  });

  it("has null windows when rate_limits is missing and returns null without session id", () => {
    expect(buildStatuslineEnvelope({ session_id: "s" }, {}, WSL, 1)).toMatchObject({
      fiveHour: null,
      sevenDay: null,
    });
    expect(buildStatuslineEnvelope({}, {}, WSL, 1)).toBeNull();
  });

  it("sends no transcript, model, cost or workspace data", () => {
    const env = buildStatuslineEnvelope(
      {
        session_id: "s",
        cwd: "C:/dev",
        transcript_path: "C:/secret/transcript.jsonl",
        model: { id: "secret-model-id", display_name: "Secret Model" },
        cost: { total_cost_usd: 12.34 },
        workspace: { current_dir: "C:/secret/workspace", project_dir: "C:/secret/project" },
        rate_limits: { five_hour: { used_percentage: 20, resets_at: 100 } },
      },
      {},
      { os: "windows", distro: null, hostname: "PC" },
      5,
    );
    expect(env).toEqual({
      v: 1,
      kind: "statusline",
      source: { host: "win", os: "windows", distro: null, entrypoint: null },
      session: { id: "s", cwd: "C:/dev", pid: null, hostSessionId: null },
      ts: 5,
      fiveHour: { usedPct: 20, resetsAt: 100_000 },
      sevenDay: null,
    });
    const json = JSON.stringify(env);
    for (const leaked of ["secret", "Secret Model", "12.34", "transcript", "workspace"]) {
      expect(json).not.toContain(leaked);
    }
  });
});

describe("wire round trip", () => {
  /** The envelope as the hub receives it: serialized to JSON and validated by the protocol. */
  const wire = (env: unknown): unknown => JSON.parse(JSON.stringify(env));

  it("accepts a PermissionRequest hook envelope", () => {
    const env = buildHookEnvelope(
      {
        session_id: "57cb6ddb",
        hook_event_name: "PermissionRequest",
        cwd: "/tmp/vt-probe",
        tool_name: "Bash",
        agent_id: "a3644938",
      },
      DESKTOP_ENV,
      WSL,
      1_000,
    );
    expect(parseEnvelope(wire(env))).toEqual({ ok: true, value: wire(env) });
  });

  it("accepts a Stop hook envelope with background tasks", () => {
    const env = buildHookEnvelope(
      {
        session_id: "s",
        hook_event_name: "Stop",
        background_tasks: [
          { id: "bq591z5wz", type: "shell" },
          { id: "aa71", type: "subagent" },
        ],
      },
      DESKTOP_ENV,
      WSL,
      1_000,
    );
    expect(parseEnvelope(wire(env))).toEqual({ ok: true, value: wire(env) });
  });

  it("accepts a statusline envelope", () => {
    const env = buildStatuslineEnvelope(
      {
        session_id: "s",
        cwd: "C:/dev",
        rate_limits: {
          five_hour: { used_percentage: 20, resets_at: 1_791_650_000 },
          seven_day: { used_percentage: 86 },
        },
      },
      { CLAUDE_CODE_ENTRYPOINT: "cli" },
      { os: "windows", distro: null, hostname: "PC" },
      5,
    );
    expect(parseEnvelope(wire(env))).toEqual({ ok: true, value: wire(env) });
  });
});
