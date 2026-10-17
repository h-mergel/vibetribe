import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/store";
import { file } from "./helpers";

describe("remote sessions (badge REM)", () => {
  const remote = file({
    sessionId: "session_01A",
    pid: null,
    cwd: "",
    entrypoint: null,
    name: "Mac Build",
    bridgeSessionId: "session_01A",
  });

  it("shows REM without a pid, titled by the remote title, and goes no_signal when the host falls silent", () => {
    const store = new SessionStore();
    store.applySnapshot({ host: "remote", hostKind: "remote", at: 0, sessions: [remote] });
    expect(store.view(1_000)[0]).toMatchObject({
      badge: "REM",
      hostKind: "remote",
      pid: null,
      title: "Mac Build",
      bridgeSessionId: "session_01A",
      state: "idle",
    });
    expect(store.view(91_000)[0]?.state).toBe("no_signal");
    expect(store.tick(211_000)[0]).toMatchObject({ reason: "no_signal_timeout", pid: null });
  });

  it("a local session never gets the REM badge", () => {
    const store = new SessionStore();
    store.applySnapshot({ host: "win", hostKind: "windows", at: 0, sessions: [file()] });
    expect(store.view(0)[0]?.badge).toBe("WIN");
  });
});
