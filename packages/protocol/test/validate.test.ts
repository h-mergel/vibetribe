import { describe, expect, it } from "vitest";
import type { HookEnvelope, StatuslineEnvelope } from "../src/envelope";
import { MAX_STRING, MAX_TASKS, parseEnvelope } from "../src/validate";

const hook: HookEnvelope = {
  v: 1,
  kind: "hook",
  source: { host: "wsl:Ubuntu", os: "wsl", distro: "Ubuntu", entrypoint: "claude-desktop" },
  session: { id: "57cb6ddb", cwd: "/tmp/vt-probe", pid: 773707, hostSessionId: "local_7b1f" },
  event: {
    name: "PermissionRequest",
    ts: 1_791_647_663_360,
    toolName: "Bash",
    toolUseId: null,
    agentId: null,
    notificationType: null,
    errorType: null,
    reason: null,
    auto: null,
    backgroundTasks: null,
  },
};

const statusline: StatuslineEnvelope = {
  v: 1,
  kind: "statusline",
  source: { host: "win", os: "windows", distro: null, entrypoint: "cli" },
  session: { id: "s1", cwd: "C:/dev", pid: null, hostSessionId: null },
  ts: 1,
  fiveHour: { usedPct: 20, resetsAt: 1_791_650_000_000 },
  sevenDay: null,
};

describe("parseEnvelope", () => {
  it("accepts a valid hook envelope", () => {
    expect(parseEnvelope(hook)).toEqual({ ok: true, value: hook });
  });

  it("accepts a valid statusline envelope", () => {
    expect(parseEnvelope(statusline)).toEqual({ ok: true, value: statusline });
  });

  it("accepts background tasks", () => {
    const withTasks = {
      ...hook,
      event: { ...hook.event, name: "Stop", backgroundTasks: [{ id: "b1", type: "shell" }] },
    };
    expect(parseEnvelope(withTasks).ok).toBe(true);
  });

  it.each([
    ["not an object", 42, "envelope must be an object"],
    ["wrong version", { ...hook, v: 2 }, "unsupported protocol version"],
    ["unknown kind", { ...hook, kind: "nope" }, "unknown envelope kind"],
    ["bad os", { ...hook, source: { ...hook.source, os: "linux" } }, "source.os is invalid"],
    [
      "empty session id",
      { ...hook, session: { ...hook.session, id: "" } },
      "session.id is invalid",
    ],
    [
      "pid not a number",
      { ...hook, session: { ...hook.session, pid: "1" } },
      "session.pid is invalid",
    ],
    [
      "missing event name",
      { ...hook, event: { ...hook.event, name: undefined } },
      "event.name is invalid",
    ],
    ["ts not finite", { ...hook, event: { ...hook.event, ts: Number.NaN } }, "event.ts is invalid"],
    [
      "auto not boolean",
      { ...hook, event: { ...hook.event, auto: "yes" } },
      "event.auto is invalid",
    ],
    [
      "overlong string",
      { ...hook, session: { ...hook.session, cwd: "x".repeat(513) } },
      "session.cwd is invalid",
    ],
    [
      "too many tasks",
      {
        ...hook,
        event: {
          ...hook.event,
          backgroundTasks: Array.from({ length: 101 }, (_, i) => ({ id: `t${i}`, type: "shell" })),
        },
      },
      "event.backgroundTasks is invalid",
    ],
    [
      "bad window",
      { ...statusline, fiveHour: { usedPct: "20", resetsAt: null } },
      "statusline.fiveHour is invalid",
    ],
  ])("rejects %s", (_name, raw, error) => {
    expect(parseEnvelope(raw)).toEqual({ ok: false, error });
  });

  describe("background task elements", () => {
    it.each([
      ["empty id", [{ id: "", type: "shell" }]],
      ["non-string type", [{ id: "b1", type: 1 }]],
      ["non-object element", ["x"]],
    ])("rejects a task with %s", (_name, tasks) => {
      const raw = { ...hook, event: { ...hook.event, backgroundTasks: tasks } };
      expect(parseEnvelope(raw)).toEqual({ ok: false, error: "event.backgroundTasks is invalid" });
    });

    it("accepts exactly MAX_TASKS tasks", () => {
      const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, type: "shell" }));
      const raw = { ...hook, event: { ...hook.event, backgroundTasks: tasks } };
      expect(parseEnvelope(raw)).toEqual({ ok: true, value: raw });
    });
  });

  describe("statusline fields", () => {
    it("rejects a non-finite ts", () => {
      expect(parseEnvelope({ ...statusline, ts: Number.NaN })).toEqual({
        ok: false,
        error: "statusline.ts is invalid",
      });
    });

    it("rejects an invalid sevenDay window", () => {
      expect(parseEnvelope({ ...statusline, sevenDay: { usedPct: "20", resetsAt: null } })).toEqual(
        {
          ok: false,
          error: "statusline.sevenDay is invalid",
        },
      );
    });

    it("rejects a string resetsAt", () => {
      expect(parseEnvelope({ ...statusline, fiveHour: { usedPct: 20, resetsAt: "1" } })).toEqual({
        ok: false,
        error: "statusline.fiveHour is invalid",
      });
    });

    it("accepts a window with resetsAt null", () => {
      const raw = { ...statusline, fiveHour: { usedPct: 20, resetsAt: null } };
      expect(parseEnvelope(raw)).toEqual({ ok: true, value: raw });
    });
  });

  describe("boundaries and shapes", () => {
    it("accepts a string of exactly MAX_STRING chars", () => {
      const raw = { ...hook, session: { ...hook.session, cwd: "x".repeat(MAX_STRING) } };
      expect(parseEnvelope(raw)).toEqual({ ok: true, value: raw });
    });

    it.each([
      ["source", { ...hook, source: "x" }, "source must be an object"],
      ["session", { ...hook, session: null }, "session must be an object"],
      ["event", { ...hook, event: [] }, "event must be an object"],
    ])("rejects %s that is not an object", (_name, raw, error) => {
      expect(parseEnvelope(raw)).toEqual({ ok: false, error });
    });

    it.each([
      ["empty host", { ...hook, source: { ...hook.source, host: "" } }, "source.host is invalid"],
      [
        "empty distro",
        { ...hook, source: { ...hook.source, distro: "" } },
        "source.distro is invalid",
      ],
      [
        "numeric distro",
        { ...hook, source: { ...hook.source, distro: 5 } },
        "source.distro is invalid",
      ],
      [
        "empty entrypoint",
        { ...hook, source: { ...hook.source, entrypoint: "" } },
        "source.entrypoint is invalid",
      ],
      [
        "numeric entrypoint",
        { ...hook, source: { ...hook.source, entrypoint: 5 } },
        "source.entrypoint is invalid",
      ],
      [
        "empty hostSessionId",
        { ...hook, session: { ...hook.session, hostSessionId: "" } },
        "session.hostSessionId is invalid",
      ],
      [
        "numeric hostSessionId",
        { ...hook, session: { ...hook.session, hostSessionId: 5 } },
        "session.hostSessionId is invalid",
      ],
      [
        "empty reason",
        { ...hook, event: { ...hook.event, reason: "" } },
        "event.reason is invalid",
      ],
      ["numeric auto", { ...hook, event: { ...hook.event, auto: 1 } }, "event.auto is invalid"],
      [
        "empty toolName",
        { ...hook, event: { ...hook.event, toolName: "" } },
        "event.toolName is invalid",
      ],
      [
        "numeric toolName",
        { ...hook, event: { ...hook.event, toolName: 5 } },
        "event.toolName is invalid",
      ],
      [
        "empty errorType",
        { ...hook, event: { ...hook.event, errorType: "" } },
        "event.errorType is invalid",
      ],
      [
        "numeric errorType",
        { ...hook, event: { ...hook.event, errorType: 5 } },
        "event.errorType is invalid",
      ],
    ])("rejects %s", (_name, raw, error) => {
      expect(parseEnvelope(raw)).toEqual({ ok: false, error });
    });
  });
});
