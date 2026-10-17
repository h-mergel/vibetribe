import type { HookEnvelope } from "@vibetribe/protocol";
import { describe, expect, it } from "vitest";
import { hostKindOf, normalizeHook } from "../src/normalize";
import { REMOTE_HOST, REMOTE_SOURCE } from "../src/remote/names";

const stop = (os: HookEnvelope["source"]["os"]): HookEnvelope => ({
  v: 1,
  kind: "hook",
  source: { host: "mac:mbp", os, distro: null, entrypoint: "cli" },
  session: { id: "m1", cwd: "/Users/h/p", pid: 9, hostSessionId: null },
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
  },
});

describe("hostKindOf", () => {
  it("keeps windows and wsl and turns a Mac into a remote host", () => {
    expect(hostKindOf("windows")).toBe("windows");
    expect(hostKindOf("wsl")).toBe("wsl");
    expect(hostKindOf("mac")).toBe("remote");
  });

  it("hook events from a Mac reporter carry hostKind remote", () => {
    expect(normalizeHook(stop("mac"), 5)[0]).toMatchObject({ type: "stop", hostKind: "remote" });
    expect(normalizeHook(stop("wsl"), 5)[0]).toMatchObject({ hostKind: "wsl" });
  });

  it("names the remote host and its health source", () => {
    expect(REMOTE_HOST).toBe("remote");
    expect(REMOTE_SOURCE).toBe("sessions:remote");
  });
});
