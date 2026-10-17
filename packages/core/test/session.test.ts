import { describe, expect, it } from "vitest";
import { applyEvent, applyFile, deriveState, newSession, waitReasonFor } from "../src/session";
import { ev, file, KEY } from "./helpers";

const fresh = (at = 0) => newSession(KEY, "wsl", at, "/home/h/atlas");

describe("turns", () => {
  it("prompt -> working, stop -> done_unseen, seen -> idle", () => {
    const s = fresh();
    expect(deriveState(s)).toBe("idle");
    applyEvent(s, ev({ type: "prompt_submit", at: 1_000, auto: false }));
    expect(deriveState(s)).toBe("working");
    applyEvent(s, ev({ type: "stop", at: 5_000, background: [] }));
    expect(deriveState(s)).toBe("done_unseen");
    expect(s.episode).toEqual({ since: 5_000, seen: false });
    applyEvent(s, ev({ type: "seen", at: 6_000 }));
    expect(deriveState(s)).toBe("idle");
  });

  it("prompt_submit marks the current episode as seen", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop", at: 1_000, background: [] }));
    applyEvent(s, ev({ type: "prompt_submit", at: 2_000, auto: false }));
    expect(s.episode?.seen).toBe(true);
    expect(deriveState(s)).toBe("working");
  });

  it("tool_start sets working with the tool as detail", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({ type: "tool_start", at: 1, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    expect(deriveState(s)).toBe("working");
    expect(s.detail).toBe("Bash");
  });
});

describe("waits", () => {
  it("permission request starts one episode; later duplicate triggers do not restart it", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({ type: "tool_start", at: 1_000, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    applyEvent(s, ev({ type: "wait_start", at: 1_100, reason: "permission", waitId: "t1" }));
    expect(deriveState(s)).toBe("needs_permission");
    expect(s.episode).toEqual({ since: 1_100, seen: false });
    applyEvent(s, ev({ type: "wait_start", at: 7_100, reason: "permission", waitId: null }));
    expect(s.episode).toEqual({ since: 1_100, seen: false });
  });

  it("tool_end of the waiting tool ends the wait, including anonymous duplicates", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "permission", waitId: "t1" }));
    applyEvent(s, ev({ type: "wait_start", at: 2, reason: "permission", waitId: null }));
    applyEvent(
      s,
      ev({ type: "tool_end", at: 3, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    expect(deriveState(s)).toBe("idle");
  });

  it("a tool_start arriving after the permission request does not clear it", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "permission", waitId: "t1" }));
    applyEvent(
      s,
      ev({ type: "tool_start", at: 2, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    expect(deriveState(s)).toBe("needs_permission");
  });

  it("parallel subagents: one approval does not clear the other open request", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "permission", waitId: "t1" }));
    applyEvent(s, ev({ type: "wait_start", at: 2, reason: "permission", waitId: "t2" }));
    applyEvent(
      s,
      ev({ type: "tool_start", at: 3, toolName: "Read", toolUseId: "t3", agentId: "a2" }),
    );
    expect(deriveState(s)).toBe("needs_permission");
    applyEvent(
      s,
      ev({ type: "tool_end", at: 4, toolName: "Bash", toolUseId: "t1", agentId: "a1" }),
    );
    expect(deriveState(s)).toBe("needs_permission");
    applyEvent(
      s,
      ev({ type: "tool_end", at: 5, toolName: "Bash", toolUseId: "t2", agentId: "a2" }),
    );
    expect(deriveState(s)).toBe("working");
  });

  it("a subagent's tool_end does not clear an anonymous wait of the main agent", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({
        type: "wait_start",
        at: 1,
        reason: "permission",
        waitId: null,
        toolName: "Bash",
        agentId: null,
      }),
    );
    applyEvent(
      s,
      ev({ type: "tool_end", at: 2, toolName: "Read", toolUseId: "t9", agentId: "a2" }),
    );
    expect(deriveState(s)).toBe("needs_permission");
    applyEvent(
      s,
      ev({ type: "tool_end", at: 3, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    expect(deriveState(s)).toBe("idle");
  });

  it("a subagent's tool_end does not clear the session-file wait", () => {
    const s = fresh();
    applyFile(s, file({ status: "idle" }), 1);
    applyFile(s, file({ status: "waiting", waitingFor: "permission prompt" }), 2);
    applyEvent(
      s,
      ev({ type: "tool_end", at: 3, toolName: "Read", toolUseId: "t9", agentId: "a2" }),
    );
    expect(deriveState(s)).toBe("needs_permission");
  });

  it("permission outranks input", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "input", waitId: "elicitation" }));
    expect(deriveState(s)).toBe("needs_input");
    applyEvent(s, ev({ type: "wait_start", at: 2, reason: "permission", waitId: "t1" }));
    expect(deriveState(s)).toBe("needs_permission");
    applyEvent(s, ev({ type: "wait_end", at: 3, waitId: "elicitation" }));
    expect(deriveState(s)).toBe("needs_permission");
  });

  it("stop clears all waits", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "permission", waitId: "t1" }));
    applyEvent(s, ev({ type: "stop", at: 2, background: [] }));
    expect(deriveState(s)).toBe("done_unseen");
  });

  it("ignores an anonymous notification wait while another wait is open (probe B)", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({
        type: "wait_start",
        at: 1,
        reason: "permission",
        waitId: null,
        toolName: "Bash",
        agentId: "a1",
      }),
    );
    applyEvent(s, ev({ type: "wait_start", at: 8_000, reason: "permission", waitId: null }));
    applyEvent(
      s,
      ev({ type: "tool_end", at: 9_000, toolName: "Bash", toolUseId: "t1", agentId: "a1" }),
    );
    expect(deriveState(s)).toBe("idle");
  });

  it("keeps an anonymous notification wait when nothing else is open", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "permission", waitId: null }));
    expect(deriveState(s)).toBe("needs_permission");
  });

  it("keeps an anonymous wait with a tool name even while another wait is open", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({
        type: "wait_start",
        at: 1,
        reason: "permission",
        waitId: null,
        toolName: "Bash",
        agentId: "a1",
      }),
    );
    applyEvent(
      s,
      ev({
        type: "wait_start",
        at: 2,
        reason: "permission",
        waitId: null,
        toolName: "Bash",
        agentId: "a2",
      }),
    );
    applyEvent(
      s,
      ev({ type: "tool_end", at: 3, toolName: "Bash", toolUseId: "t1", agentId: "a1" }),
    );
    expect(deriveState(s)).toBe("needs_permission");
  });

  it("keeps a named elicitation wait while another wait is open", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "wait_start", at: 1, reason: "permission", waitId: "t1" }));
    applyEvent(s, ev({ type: "wait_start", at: 2, reason: "input", waitId: "elicitation" }));
    applyEvent(
      s,
      ev({ type: "tool_end", at: 3, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    expect(deriveState(s)).toBe("needs_input");
  });
});

describe("errors", () => {
  it("rate_limit is throttled (no alarm episode) and quota_resumed resumes work", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop_failure", at: 1, error: "rate_limit" }));
    expect(deriveState(s)).toBe("throttled");
    expect(s.episode).toBeNull();
    applyEvent(s, ev({ type: "quota_resumed", at: 2 }));
    expect(deriveState(s)).toBe("working");
  });

  it("throttle_start (quota auto-resume pending) is throttled until quota_resumed", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "throttle_start", at: 1 }));
    expect(deriveState(s)).toBe("throttled");
    expect(s.errorType).toBe("quota");
    applyEvent(s, ev({ type: "quota_resumed", at: 2 }));
    expect(deriveState(s)).toBe("working");
  });

  it("billing_error is an error episode, cleared by the next tool_start", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop_failure", at: 10, error: "billing_error" }));
    expect(deriveState(s)).toBe("error");
    expect(s.episode).toEqual({ since: 10, seen: false });
    applyEvent(
      s,
      ev({ type: "tool_start", at: 20, toolName: "Read", toolUseId: "t1", agentId: null }),
    );
    expect(deriveState(s)).toBe("working");
    expect(s.errorType).toBeNull();
  });
});

describe("stop dedupe (automatic turns)", () => {
  it("a second stop within 10 s without a real prompt keeps the seen episode", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop", at: 1_000, background: [] }));
    applyEvent(s, ev({ type: "seen", at: 2_000 }));
    applyEvent(s, ev({ type: "prompt_submit", at: 3_000, auto: true }));
    applyEvent(s, ev({ type: "stop", at: 5_000, background: [] }));
    expect(deriveState(s)).toBe("idle");
  });

  it("an automatic turn keeps an unseen episode unseen", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop", at: 1_000, background: [] }));
    applyEvent(s, ev({ type: "prompt_submit", at: 3_000, auto: true }));
    applyEvent(s, ev({ type: "stop", at: 5_000, background: [] }));
    expect(deriveState(s)).toBe("done_unseen");
    expect(s.episode?.since).toBe(1_000);
  });

  it("a real prompt in between starts a new episode", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop", at: 1_000, background: [] }));
    applyEvent(s, ev({ type: "seen", at: 2_000 }));
    applyEvent(s, ev({ type: "prompt_submit", at: 3_000, auto: false }));
    applyEvent(s, ev({ type: "stop", at: 5_000, background: [] }));
    expect(deriveState(s)).toBe("done_unseen");
    expect(s.episode?.since).toBe(5_000);
  });

  it("a stop after more than 10 s starts a new episode", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop", at: 1_000, background: [] }));
    applyEvent(s, ev({ type: "seen", at: 2_000 }));
    applyEvent(s, ev({ type: "stop", at: 20_000, background: [] }));
    expect(deriveState(s)).toBe("done_unseen");
  });
});

describe("background jobs", () => {
  it("done with running jobs: done_unseen, then background after seen, idle when empty", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({
        type: "stop",
        at: 1,
        background: [
          { id: "b1", kind: "shell" },
          { id: "a1", kind: "agent" },
        ],
      }),
    );
    expect(deriveState(s)).toBe("done_unseen");
    expect(s.background.size).toBe(2);
    applyEvent(s, ev({ type: "seen", at: 2 }));
    expect(deriveState(s)).toBe("background");
    applyEvent(s, ev({ type: "subagent_stop", at: 3, agentId: "a1" }));
    expect(s.background.size).toBe(1);
    expect(deriveState(s)).toBe("background");
    applyEvent(s, ev({ type: "stop", at: 60_000, background: [] }));
    applyEvent(s, ev({ type: "seen", at: 60_001 }));
    expect(deriveState(s)).toBe("idle");
  });

  it("background_snapshot replaces the job set (SubagentStop carries the full list)", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({
        type: "stop",
        at: 1,
        background: [
          { id: "a1", kind: "agent" },
          { id: "b1", kind: "shell" },
        ],
      }),
    );
    applyEvent(s, ev({ type: "seen", at: 2 }));
    applyEvent(
      s,
      ev({ type: "background_snapshot", at: 3, background: [{ id: "b1", kind: "shell" }] }),
    );
    expect([...s.background.keys()]).toEqual(["b1"]);
    expect(s.backgroundChangedAt).toBe(3);
    applyEvent(s, ev({ type: "background_snapshot", at: 4, background: [] }));
    expect(deriveState(s)).toBe("idle");
  });

  it("background_snapshot bumps backgroundChangedAt only when the job set changes", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "stop", at: 1, background: [{ id: "b1", kind: "shell" }] }));
    applyEvent(
      s,
      ev({ type: "background_snapshot", at: 5, background: [{ id: "b1", kind: "shell" }] }),
    );
    expect(s.backgroundChangedAt).toBe(1);
    applyEvent(
      s,
      ev({ type: "background_snapshot", at: 9, background: [{ id: "b1", kind: "agent" }] }),
    );
    expect(s.backgroundChangedAt).toBe(9);
  });

  it("stop without a background list keeps the current set", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "subagent_start", at: 1, agentId: "a1" }));
    applyEvent(s, ev({ type: "stop", at: 2, background: null }));
    expect(s.background.size).toBe(1);
  });

  it("subagent_start while working shows Subagent as detail", () => {
    const s = fresh();
    applyEvent(s, ev({ type: "prompt_submit", at: 1, auto: false }));
    applyEvent(s, ev({ type: "subagent_start", at: 2, agentId: "a1" }));
    expect(s.detail).toBe("Subagent");
  });
});

describe("session file", () => {
  it("first sighting of a file-origin session recovers its state", () => {
    const busy = newSession(KEY, "wsl", 0, "");
    applyFile(busy, file({ status: "busy" }), 1);
    expect(deriveState(busy)).toBe("working");
    const waiting = newSession(KEY, "wsl", 0, "");
    applyFile(waiting, file({ status: "waiting", waitingFor: "permission prompt" }), 1);
    expect(deriveState(waiting)).toBe("needs_permission");
  });

  it("first sighting of a waiting file also counts for hook-first sessions", () => {
    const s = fresh();
    applyEvent(
      s,
      ev({ type: "tool_start", at: 1, toolName: "Bash", toolUseId: "t1", agentId: null }),
    );
    applyFile(s, file({ status: "waiting", waitingFor: "permission prompt" }), 2);
    expect(deriveState(s)).toBe("needs_permission");
    expect(s.episode).toEqual({ since: 2, seen: false });
  });

  it("waiting -> busy ends the wait (answered in the terminal or app) and resumes work", () => {
    const s = fresh();
    applyFile(s, file({ status: "busy" }), 1);
    applyEvent(s, ev({ type: "wait_start", at: 2, reason: "permission", waitId: "t1" }));
    applyFile(s, file({ status: "waiting", waitingFor: "permission prompt" }), 3);
    applyFile(s, file({ status: "busy" }), 4);
    expect(deriveState(s)).toBe("working");
  });

  it("idle -> busy without hooks (e.g. Mac file delta) means working", () => {
    const s = fresh();
    applyFile(s, file({ status: "idle" }), 1);
    applyFile(s, file({ status: "busy" }), 2);
    expect(deriveState(s)).toBe("working");
  });

  it("busy -> idle while working means the turn was interrupted (Esc)", () => {
    const s = fresh();
    applyFile(s, file({ status: "busy" }), 1);
    applyEvent(s, ev({ type: "prompt_submit", at: 2, auto: false }));
    applyFile(s, file({ status: "idle" }), 3);
    expect(deriveState(s)).toBe("idle");
  });

  it("idle -> waiting adds a file wait that a tool_end clears", () => {
    const s = fresh();
    applyFile(s, file({ status: "idle" }), 1);
    applyFile(s, file({ status: "waiting", waitingFor: "input needed" }), 2);
    expect(deriveState(s)).toBe("needs_input");
    applyEvent(
      s,
      ev({ type: "tool_end", at: 3, toolName: "AskUserQuestion", toolUseId: "q1", agentId: null }),
    );
    expect(deriveState(s)).toBe("idle");
  });

  it("file busy after an error resumes working", () => {
    const s = fresh();
    applyFile(s, file({ status: "idle" }), 1);
    applyEvent(s, ev({ type: "stop_failure", at: 2, error: "server_error" }));
    applyFile(s, file({ status: "busy" }), 3);
    expect(deriveState(s)).toBe("working");
  });

  it("maps waitingFor to a wait reason", () => {
    expect(waitReasonFor("permission prompt")).toBe("permission");
    expect(waitReasonFor("sandbox request")).toBe("permission");
    expect(waitReasonFor("input needed")).toBe("input");
    expect(waitReasonFor("dialog open")).toBe("input");
    expect(waitReasonFor(null)).toBe("input");
  });
});
