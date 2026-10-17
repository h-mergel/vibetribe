import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_POLL_MS } from "../src/remote/poller";
import { type RunningHub, startHub } from "../src/runtime";

let running: RunningHub | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await running?.stop();
  running = null;
});

describe("startHub remote loop", () => {
  it("polls the remote list at once and every REMOTE_POLL_MS; a throwing port does not end the loop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reads = 0;
    const lines: string[] = [];
    running = await startHub({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      log: (l) => lines.push(l),
      remote: {
        ports: {
          readCredentials: async () => {
            reads++;
            if (reads === 2) throw new Error("EACCES: credentials");
            return { accessToken: "a", expiresAt: 10 ** 15 };
          },
          fetchSessions: async () => ({
            kind: "ok",
            sessions: [
              { id: "session_01A", title: "Mac", status: "busy", doneUnread: false, at: null },
            ],
          }),
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);
    expect(running.hub.state(Date.now()).sessions.map((s) => [s.badge, s.state])).toEqual([
      ["REM", "working"],
    ]);
    await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS);
    expect(reads).toBe(2);
    expect(running.hub.state(Date.now()).sources["sessions:remote"]?.error).toBe("poll failed");
    expect(lines).toContain("remote poll failed: Error: EACCES: credentials");
    await vi.advanceTimersByTimeAsync(REMOTE_POLL_MS);
    expect(reads).toBe(3);
    expect(running.hub.state(Date.now()).sources["sessions:remote"]?.health).toBe("ok");
  });

  it("without remote ports there is no REM source", async () => {
    running = await startHub({ port: 0, token: "t", sources: [], usage: null });
    expect(running.hub.state(Date.now()).sources["sessions:remote"]).toBeUndefined();
  });
});
