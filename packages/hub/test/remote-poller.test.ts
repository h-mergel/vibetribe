import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub";
import type { RemoteResult } from "../src/remote/api";
import {
  REMOTE_MAX_BACKOFF_MS,
  REMOTE_POLL_MS,
  RemotePoller,
  type RemotePorts,
} from "../src/remote/poller";
import type { Credentials } from "../src/usage/usage";

const T = 1_000_000;
const creds = (expiresAt = 10 ** 15, accessToken = "supersecret"): Credentials => ({
  accessToken,
  expiresAt,
});
const waiting: RemoteResult = {
  kind: "ok",
  sessions: [{ id: "session_01A", title: "Mac", status: "waiting", doneUnread: false, at: null }],
};

function setup(
  results: RemoteResult[],
  read: () => Promise<Credentials | null> = async () => creds(),
) {
  const hub = new Hub();
  const logs: string[] = [];
  const tokens: string[] = [];
  const ports: RemotePorts = {
    readCredentials: read,
    fetchSessions: async (token) => {
      tokens.push(token);
      return results.shift() ?? waiting;
    },
  };
  const poller = new RemotePoller({ hub, ports, log: (l) => logs.push(l) });
  return { hub, poller, logs, tokens };
}

describe("RemotePoller", () => {
  it("feeds a listing into the hub and asks again after REMOTE_POLL_MS", async () => {
    const { hub, poller, tokens } = setup([waiting]);
    expect(await poller.poll(T)).toBe(REMOTE_POLL_MS);
    expect(tokens).toEqual(["supersecret"]);
    expect(hub.state(T).sessions.map((s) => [s.badge, s.state])).toEqual([["REM", "needs_input"]]);
    expect(hub.state(T).sources["sessions:remote"]?.health).toBe("ok");
  });

  it("backs off on 429, 5xx and network errors up to 5 min and resets after a success", async () => {
    const { hub, poller, logs } = setup([
      { kind: "rate_limited" },
      { kind: "error", message: "HTTP 503" },
      { kind: "error", message: "timeout" },
      { kind: "rate_limited" },
      { kind: "rate_limited" },
      { kind: "rate_limited" },
      waiting,
    ]);
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) delays.push(await poller.poll(T + i));
    // derived from the constants, so a newly measured interval keeps this test valid
    const expected: number[] = [];
    let d = REMOTE_POLL_MS;
    for (let i = 0; i < 6; i++) {
      d = Math.min(d * 2, REMOTE_MAX_BACKOFF_MS);
      expected.push(d);
    }
    expect(delays).toEqual([...expected, REMOTE_POLL_MS]);
    expect(delays.slice(3, 6)).toEqual([300_000, 300_000, 300_000]);
    expect(logs[0]).toBe(
      `remote sessions: rate limited; next try in ${(2 * REMOTE_POLL_MS) / 1000} s`,
    );
    expect(logs[1]).toBe(`remote sessions: HTTP 503; next try in ${(4 * REMOTE_POLL_MS) / 1000} s`);
    expect(hub.state(T).sources["sessions:remote"]?.health).toBe("ok");
  });

  it("a failure keeps the sessions and reports the error on the source", async () => {
    const { hub, poller } = setup([waiting, { kind: "error", message: "unexpected response" }]);
    await poller.poll(T);
    await poller.poll(T + 20_000);
    expect(hub.state(T + 20_000).sessions).toHaveLength(1);
    expect(hub.state(T + 20_000).sources["sessions:remote"]).toMatchObject({
      health: "missing",
      error: "unexpected response",
    });
  });

  it("a rejected login is 'login expired' and backs off as well", async () => {
    const { hub, poller } = setup([{ kind: "unauthorized" }]);
    expect(await poller.poll(T)).toBe(2 * REMOTE_POLL_MS);
    expect(hub.state(T).sources["sessions:remote"]?.error).toBe("login expired");
  });

  it("a refreshed token (new expiresAt) resets the backoff", async () => {
    let expiresAt = 10 ** 15;
    const { poller } = setup(
      [{ kind: "unauthorized" }, { kind: "unauthorized" }, { kind: "unauthorized" }],
      async () => creds(expiresAt),
    );
    expect(await poller.poll(T)).toBe(2 * REMOTE_POLL_MS);
    expect(await poller.poll(T + 1)).toBe(4 * REMOTE_POLL_MS);
    expiresAt += 8 * 3_600_000;
    expect(await poller.poll(T + 2)).toBe(2 * REMOTE_POLL_MS);
  });

  it("sends no request without credentials or with an expired token", async () => {
    const none = setup([], async () => null);
    expect(await none.poller.poll(T)).toBe(REMOTE_POLL_MS);
    expect(none.tokens).toEqual([]);
    expect(none.hub.state(T).sources["sessions:remote"]?.error).toBe("no credentials");
    const expired = setup([], async () => creds(T - 1));
    expect(await expired.poller.poll(T)).toBe(REMOTE_POLL_MS);
    expect(expired.tokens).toEqual([]);
    expect(expired.hub.state(T).sources["sessions:remote"]?.error).toBe("login expired");
  });

  it("never writes the token into state or logs", async () => {
    const { hub, poller, logs } = setup([
      { kind: "error", message: "network error" },
      { kind: "unauthorized" },
      { kind: "rate_limited" },
      waiting,
    ]);
    for (let i = 0; i < 4; i++) await poller.poll(T + i);
    expect(JSON.stringify(hub.state(T + 4))).not.toContain("supersecret");
    expect(logs.join("\n")).not.toContain("supersecret");
  });
});
