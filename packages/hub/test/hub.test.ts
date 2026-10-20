import type { HookEnvelope, StatuslineEnvelope } from "@vibetribe/protocol";
import { describe, expect, it } from "vitest";
import { Hub, SETUP_SOURCE } from "../src/hub";

const source = {
  host: "wsl:Ubuntu",
  os: "wsl" as const,
  distro: "Ubuntu",
  entrypoint: "claude-desktop",
};
const session = { id: "s1", cwd: "/tmp/p", pid: 7, hostSessionId: "local_x" };
function hook(name: string, extra: Partial<HookEnvelope["event"]> = {}): HookEnvelope {
  return {
    v: 1,
    kind: "hook",
    source,
    session,
    event: {
      name,
      ts: 0,
      toolName: null,
      toolUseId: null,
      agentId: null,
      notificationType: null,
      errorType: null,
      reason: null,
      auto: null,
      backgroundTasks: null,
      ...extra,
    },
  };
}
const fileInfo = {
  sessionId: "s1",
  pid: 7,
  cwd: "/tmp/p",
  entrypoint: "claude-desktop",
  name: "Test",
  hostSessionId: "local_x",
  bridgeSessionId: null,
  status: "busy" as const,
  waitingFor: null,
};

describe("Hub", () => {
  it("applies normalized hook events and notifies listeners", () => {
    const hub = new Hub();
    let changes = 0;
    hub.onChange(() => changes++);
    hub.ingest(hook("UserPromptSubmit", { auto: false }), 1_000);
    hub.ingest(hook("PermissionRequest", { toolName: "Bash" }), 2_000);
    const s = hub.state(3_000);
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toMatchObject({ state: "needs_permission", episodeSince: 2_000 });
    expect(s.recent.map((r) => r.name)).toEqual(["UserPromptSubmit", "PermissionRequest"]);
    expect(changes).toBe(2);
  });

  it("keeps only the most recent events", () => {
    const hub = new Hub({ recentLimit: 2 });
    for (const n of ["SessionStart", "UserPromptSubmit", "Stop"]) hub.ingest(hook(n), 1);
    expect(hub.state(1).recent.map((r) => r.name)).toEqual(["UserPromptSubmit", "Stop"]);
  });

  it("feeds statusline rate limits into the limits store", () => {
    const hub = new Hub();
    const sl: StatuslineEnvelope = {
      v: 1,
      kind: "statusline",
      source,
      session,
      ts: 0,
      fiveHour: { usedPct: 42, resetsAt: 10_000_000 },
      sevenDay: null,
    };
    hub.ingest(sl, 1_000);
    expect(hub.state(1_000).limits.fiveHour).toMatchObject({ usedPct: 42 });
  });

  it("applies snapshots, reports removals once and tracks source health", () => {
    const hub = new Hub();
    hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1_000, sessions: [fileInfo] });
    expect(hub.state(1_000).sources["sessions:wsl:Ubuntu"]).toEqual({
      health: "ok",
      lastAt: 1_000,
      error: null,
    });
    hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 2_000, sessions: [] });
    expect(hub.drainRemovals()).toEqual([expect.objectContaining({ reason: "gone" })]);
    expect(hub.drainRemovals()).toEqual([]);
    expect(hub.state(2_000 + 60_001).sources["sessions:wsl:Ubuntu"]?.health).toBe("stale");
  });

  it("marks an inactive source as missing without touching sessions", () => {
    const hub = new Hub();
    hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1_000, sessions: [fileInfo] });
    hub.markInactive("sessions:wsl:Ubuntu");
    expect(hub.state(1_500).sources["sessions:wsl:Ubuntu"]?.health).toBe("missing");
    expect(hub.state(1_500).sessions).toHaveLength(1);
  });

  it("markInactive stores the reason as error and a later snapshot clears it", () => {
    const hub = new Hub();
    hub.markInactive("sessions:wsl:Ubuntu", "distro not running");
    expect(hub.state(1).sources["sessions:wsl:Ubuntu"]).toEqual({
      health: "missing",
      lastAt: null,
      error: "distro not running",
    });
    hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 2, sessions: [] });
    expect(hub.state(2).sources["sessions:wsl:Ubuntu"]?.error).toBeNull();
  });

  it("handles usage readings, expiry and errors", () => {
    const hub = new Hub();
    hub.ingestUsage(
      {
        fiveHour: { usedPct: 20, resetsAt: 9_000_000 },
        extra: { enabled: false, usedCredits: 0, monthlyLimit: 50, currency: "EUR" },
      },
      1_000,
    );
    expect(hub.state(1_000).limits).toMatchObject({
      auth: "ok",
      fiveHour: { usedPct: 20 },
      extra: { enabled: false },
    });
    expect(hub.state(1_000).sources.usage?.health).toBe("ok");
    hub.usageExpired();
    expect(hub.state(2_000).limits.auth).toBe("expired");
    hub.markError("usage", "HTTP 429");
    expect(hub.state(3_000).sources.usage).toMatchObject({ health: "missing", error: "HTTP 429" });
  });

  it("uses per-kind stale windows: hooks and ingress never go stale", () => {
    const hub = new Hub();
    hub.ingest(hook("Stop"), 0);
    hub.markOk("ingress", 0);
    hub.ingestUsage({ fiveHour: null }, 0);
    const later = hub.state(10 * 60_000).sources;
    expect(later["hooks:wsl:Ubuntu"]?.health).toBe("ok");
    expect(later.ingress?.health).toBe("ok");
    expect(later.usage?.health).toBe("ok");
    expect(hub.state(15 * 60_000 + 1).sources.usage?.health).toBe("stale");
  });

  it("the setup source never goes stale and carries its error until marked ok", () => {
    const hub = new Hub();
    hub.markError(SETUP_SOURCE, "Claude Code hooks not set up");
    expect(hub.state(0).sources.setup).toMatchObject({ health: "missing" });
    hub.markOk(SETUP_SOURCE, 0);
    expect(hub.state(24 * 3_600_000).sources.setup).toEqual({
      health: "ok",
      lastAt: 0,
      error: null,
    });
  });

  it("tells the listeners when a source recovers, not on every ok", () => {
    const hub = new Hub();
    let changes = 0;
    hub.onChange(() => changes++);
    hub.markOk(SETUP_SOURCE, 0);
    hub.markOk(SETUP_SOURCE, 1);
    expect(changes).toBe(0);
    hub.markError(SETUP_SOURCE, "Claude Code hooks not set up");
    hub.markOk(SETUP_SOURCE, 2);
    expect(changes).toBe(2);
  });

  it("counts invalid envelopes and exposes them in the state", () => {
    const hub = new Hub();
    hub.countInvalid();
    expect(hub.state(1).invalidEnvelopes).toBe(1);
  });

  it("tick removes timed-out sessions and collects removals", () => {
    const hub = new Hub();
    hub.ingest(hook("UserPromptSubmit"), 0);
    hub.tick(1_800_000);
    expect(hub.drainRemovals()).toEqual([expect.objectContaining({ reason: "hook_only_ttl" })]);
  });

  it("unsubscribes listeners", () => {
    const hub = new Hub();
    let n = 0;
    const off = hub.onChange(() => n++);
    off();
    hub.ingest(hook("Stop"), 1);
    expect(n).toBe(0);
  });

  it("isolates a throwing listener from the others and reports the error", () => {
    const errors: unknown[] = [];
    const hub = new Hub({ onListenerError: (err) => errors.push(err) });
    const boom = new Error("boom");
    let bRuns = 0;
    hub.onChange(() => {
      throw boom;
    });
    hub.onChange(() => bRuns++);
    expect(() => hub.ingest(hook("UserPromptSubmit"), 0)).not.toThrow();
    expect(() => hub.tick(1_800_000)).not.toThrow();
    expect(() =>
      hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1, sessions: [] }),
    ).not.toThrow();
    expect(hub.drainRemovals()).toHaveLength(1);
    expect(bRuns).toBe(3);
    expect(errors).toEqual([boom, boom, boom]);
  });

  it("reports a removal when a session ends", () => {
    const hub = new Hub();
    hub.ingest(hook("UserPromptSubmit"), 0);
    hub.ingest(hook("SessionEnd"), 1);
    const removals = hub.drainRemovals();
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({
      reason: "end",
      key: { host: "wsl:Ubuntu", sessionId: "s1" },
    });
  });

  it("recovers a source from an error or inactivity through a snapshot", () => {
    const hub = new Hub();
    hub.markError("sessions:win", "x");
    expect(hub.state(0).sources["sessions:win"]).toMatchObject({ health: "missing", error: "x" });
    hub.ingestSnapshot({ host: "win", hostKind: "windows", at: 1_000, sessions: [] });
    expect(hub.state(1_000).sources["sessions:win"]).toEqual({
      health: "ok",
      lastAt: 1_000,
      error: null,
    });
    hub.markInactive("sessions:win");
    hub.ingestSnapshot({ host: "win", hostKind: "windows", at: 2_000, sessions: [] });
    expect(hub.state(2_000).sources["sessions:win"]).toEqual({
      health: "ok",
      lastAt: 2_000,
      error: null,
    });
  });

  it("markInactive keeps the last seen time", () => {
    const hub = new Hub();
    hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1_000, sessions: [] });
    hub.markInactive("sessions:wsl:Ubuntu");
    expect(hub.state(1_500).sources["sessions:wsl:Ubuntu"]).toEqual({
      health: "missing",
      lastAt: 1_000,
      error: null,
    });
  });

  it("sessions source goes stale just after 60 s", () => {
    const hub = new Hub();
    hub.markOk("sessions:h", 1_000);
    expect(hub.state(1_000 + 60_000).sources["sessions:h"]?.health).toBe("ok");
    expect(hub.state(1_000 + 60_001).sources["sessions:h"]?.health).toBe("stale");
  });

  it("usage source goes stale just after 15 min", () => {
    const hub = new Hub();
    hub.markOk("usage", 1_000);
    expect(hub.state(1_000 + 15 * 60_000).sources.usage?.health).toBe("ok");
    expect(hub.state(1_000 + 15 * 60_000 + 1).sources.usage?.health).toBe("stale");
  });

  it("unknown source kinds fall back to a 60 s stale window", () => {
    const hub = new Hub();
    hub.markOk("foo:x", 1_000);
    expect(hub.state(1_000 + 60_000).sources["foo:x"]?.health).toBe("ok");
    expect(hub.state(1_000 + 60_001).sources["foo:x"]?.health).toBe("stale");
  });

  it("a never-seen source with an error is missing with lastAt null", () => {
    const hub = new Hub();
    hub.markError("usage", "x");
    expect(hub.state(0).sources.usage).toEqual({ health: "missing", lastAt: null, error: "x" });
  });

  it("state().recent is a copy that later ingests do not change", () => {
    const hub = new Hub();
    hub.ingest(hook("Stop"), 1);
    const mutated = hub.state(1);
    mutated.recent.length = 0;
    expect(hub.state(1).recent.map((r) => r.name)).toEqual(["Stop"]);
    const before = hub.state(1);
    hub.ingest(hook("UserPromptSubmit"), 2);
    expect(before.recent.map((r) => r.name)).toEqual(["Stop"]);
    expect(hub.state(2).recent.map((r) => r.name)).toEqual(["Stop", "UserPromptSubmit"]);
  });

  it("usageExpired reports expired auth and a fresh reading restores it", () => {
    const hub = new Hub();
    hub.ingestUsage({ fiveHour: null }, 0);
    hub.usageExpired();
    expect(hub.state(1).limits.auth).toBe("expired");
    expect(hub.state(1).sources.usage).toMatchObject({ health: "missing", error: "login expired" });
    hub.ingestUsage({ fiveHour: null }, 2);
    expect(hub.state(2).limits.auth).toBe("ok");
    expect(hub.state(2).sources.usage).toEqual({ health: "ok", lastAt: 2, error: null });
  });

  it("statusline feeds the seven-day window and does not enter recent events", () => {
    const hub = new Hub();
    const sl: StatuslineEnvelope = {
      v: 1,
      kind: "statusline",
      source,
      session,
      ts: 0,
      fiveHour: null,
      sevenDay: { usedPct: 10, resetsAt: 10_000_000 },
    };
    hub.ingest(sl, 1_000);
    expect(hub.state(1_000).limits.sevenDay).toMatchObject({ usedPct: 10 });
    expect(hub.state(1_000).recent).toEqual([]);
  });

  it("notifies once per state-changing mutator and not for a tick without removal", () => {
    const hub = new Hub();
    let n = 0;
    hub.onChange(() => n++);
    hub.ingestSnapshot({ host: "wsl:Ubuntu", hostKind: "wsl", at: 1, sessions: [fileInfo] });
    expect(n).toBe(1);
    hub.markInactive("sessions:wsl:Ubuntu");
    expect(n).toBe(2);
    hub.ingestUsage({ fiveHour: null }, 1);
    expect(n).toBe(3);
    hub.markError("usage", "x");
    expect(n).toBe(4);

    const ticking = new Hub();
    let m = 0;
    ticking.onChange(() => m++);
    ticking.ingest(hook("UserPromptSubmit"), 0);
    expect(m).toBe(1);
    ticking.tick(1_800_000);
    expect(m).toBe(2);
    ticking.tick(1_800_001);
    expect(m).toBe(2);
  });

  it("markSeen ends an unseen episode and notifies; unknown sessions are ignored", () => {
    const hub = new Hub();
    let n = 0;
    hub.onChange(() => n++);
    hub.ingest(hook("Stop"), 1_000);
    const view = hub.state(1_000).sessions[0];
    if (!view) throw new Error("session expected");
    expect(view.state).toBe("done_unseen");
    hub.markSeen(view, 2_000);
    expect(hub.state(2_000).sessions[0]?.state).toBe("idle");
    expect(n).toBe(2);
    hub.markSeen({ key: { host: "win", sessionId: "nope" }, hostKind: "windows" }, 3_000);
    expect(hub.state(3_000).sessions).toHaveLength(1);
  });

  it("keeps Claude Desktop's pins in the state and notifies only when they change", () => {
    const hub = new Hub();
    let n = 0;
    hub.onChange(() => n++);
    expect(hub.state(0).pins).toEqual([]);
    const pins = ["local_b", "local_a"];
    hub.ingestPins(pins);
    pins.push("local_c");
    expect(hub.state(0).pins).toEqual(["local_b", "local_a"]);
    expect(n).toBe(1);
    hub.ingestPins(["local_b", "local_a"]);
    expect(n).toBe(1);
    hub.ingestPins(["local_a", "local_b"]);
    expect(hub.state(0).pins).toEqual(["local_a", "local_b"]);
    expect(n).toBe(2);
  });

  it("markSeen for an unknown session does not notify", () => {
    const hub = new Hub();
    hub.ingest(hook("Stop"), 1_000);
    const view = hub.state(1_000).sessions[0];
    if (!view) throw new Error("session expected");
    let n = 0;
    hub.onChange(() => n++);
    hub.markSeen(
      { key: { host: view.key.host, sessionId: "nope" }, hostKind: view.hostKind },
      2_000,
    );
    expect(n).toBe(0);
    expect(hub.state(2_000).sessions[0]?.state).toBe("done_unseen");
  });
});
