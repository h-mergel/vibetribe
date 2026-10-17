import { describe, expect, it } from "vitest";
import { Hub } from "../src/hub";
import {
  FRESH_MS,
  MAX_BACKOFF_MS,
  POLL_MS,
  UsagePoller,
  type UsagePorts,
} from "../src/usage/poller";
import { REFRESH_ARGS, TokenRefresher } from "../src/usage/refresh";
import type { Credentials, UsageResult } from "../src/usage/usage";

const HOUR = 3_600_000;
const okInput = { fiveHour: { usedPct: 20, resetsAt: 9 * HOUR }, sevenDay: null, extra: null };
const creds = (expiresAt: number, accessToken = "tok"): Credentials => ({
  accessToken,
  expiresAt,
});

function ports(over: Partial<UsagePorts> & { results?: UsageResult[] } = {}) {
  const results = over.results ?? [{ kind: "ok", input: okInput }];
  const calls = { fetch: 0, saved: 0, tokens: [] as string[] };
  const p: UsagePorts = {
    readCredentials: async () => creds(10 * HOUR),
    fetchUsage: async (token) => {
      calls.fetch++;
      calls.tokens.push(token);
      return results.shift() ?? { kind: "ok", input: okInput };
    },
    loadCache: async () => null,
    saveCache: async () => {
      calls.saved++;
    },
    ...over,
  };
  return { p, calls };
}
const fakeRefresher = (ok: boolean) => {
  const r = {
    requests: 0,
    request: async () => {
      r.requests++;
      return ok;
    },
  };
  return r as unknown as TokenRefresher & { requests: number };
};

describe("TokenRefresher", () => {
  /** A refresher whose CLI run moves expiresAt to `movesTo` (null: leaves it). */
  const refresher = (movesTo: number | null, start = 0) => {
    let expires = start;
    const ran: string[][] = [];
    const lines: string[] = [];
    const r = new TokenRefresher({
      run: async (args) => {
        ran.push(args);
        if (movesTo !== null) expires = movesTo;
        return true;
      },
      readExpiresAt: async () => expires,
      log: (line) => lines.push(line),
    });
    return { r, ran, lines };
  };

  it("runs /cost once; ok when expiresAt moves forward into the future, at most once per hour", async () => {
    const { r, ran, lines } = refresher(10 * HOUR);
    expect(await r.request(HOUR)).toBe(true);
    expect(ran).toEqual([REFRESH_ARGS]);
    expect(lines).toEqual(["token refresh: ok"]);
    expect(await r.request(HOUR + 1_000)).toBe(false);
    expect(ran).toHaveLength(1);
  });

  it("never makes a model call: only /cost, without settings (our hooks) or session persistence", () => {
    expect(REFRESH_ARGS).toEqual([
      "-p",
      "/cost",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--setting-sources",
      "",
    ]);
  });

  it("an unchanged, still valid file is no refresh and logs no change", async () => {
    const { r, lines } = refresher(null, 10 * HOUR);
    expect(await r.request(HOUR)).toBe(false);
    expect(lines).toEqual(["token refresh: no change"]);
  });

  it("a file that moves but stays in the past is no refresh", async () => {
    const { r } = refresher(1);
    expect(await r.request(HOUR)).toBe(false);
  });

  it("a throwing run or read resolves to false and logs no change, never the token", async () => {
    const lines: string[] = [];
    const throwing = new TokenRefresher({
      run: async () => {
        throw new Error("spawn failed sk-ant-secret");
      },
      readExpiresAt: async () => 0,
      log: (line) => lines.push(line),
    });
    await expect(throwing.request(HOUR)).resolves.toBe(false);
    const unreadable = new TokenRefresher({
      run: async () => true,
      readExpiresAt: async () => {
        throw new Error("EACCES");
      },
      log: (line) => lines.push(line),
    });
    await expect(unreadable.request(HOUR)).resolves.toBe(false);
    expect(lines).toEqual(["token refresh: no change", "token refresh: no change"]);
  });

  it("an attempt after the clock stepped backwards is allowed", async () => {
    const { r, ran } = refresher(null);
    await r.request(10 * HOUR);
    await r.request(5 * HOUR);
    expect(ran).toHaveLength(2);
  });

  it("a failed attempt followed by an immediate retry is blocked", async () => {
    const { r, ran } = refresher(null);
    expect(await r.request(HOUR)).toBe(false);
    expect(await r.request(HOUR + 1)).toBe(false);
    expect(ran).toHaveLength(1);
  });

  it("an attempt exactly one interval later is allowed, one millisecond short is not", async () => {
    const { r, ran } = refresher(null);
    await r.request(HOUR);
    await r.request(2 * HOUR - 1);
    expect(ran).toHaveLength(1);
    await r.request(2 * HOUR);
    expect(ran).toHaveLength(2);
  });
});

describe("UsagePoller", () => {
  it("ingests a reading, caches it and waits POLL_MS", async () => {
    const hub = new Hub();
    const { p, calls } = ports();
    const poller = new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) });
    expect(await poller.poll(HOUR)).toBe(POLL_MS);
    expect(hub.state(HOUR).limits.fiveHour?.usedPct).toBe(20);
    expect(calls.saved).toBe(1);
  });

  it("backs off on 429, doubling up to 30 minutes, and resets after a success", async () => {
    const hub = new Hub();
    const limited = { kind: "rate_limited" } as UsageResult;
    const { p } = ports({
      results: [limited, limited, limited, limited, { kind: "ok", input: okInput }, limited],
    });
    const poller = new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) });
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) delays.push(await poller.poll(HOUR));
    expect(delays).toEqual([
      2 * POLL_MS,
      4 * POLL_MS,
      MAX_BACKOFF_MS,
      MAX_BACKOFF_MS,
      POLL_MS,
      2 * POLL_MS,
    ]);
    // the last 429 came one poll after a success at the same instant: the reading is fresh, no outage
    expect(hub.state(HOUR).sources.usage?.error).toBeNull();
  });

  it("a 429 one minute after a success keeps usage health ok and the reading", async () => {
    const hub = new Hub();
    const limited = { kind: "rate_limited" } as UsageResult;
    const { p } = ports({ results: [{ kind: "ok", input: okInput }, limited] });
    const logs: string[] = [];
    const poller = new UsagePoller({
      hub,
      ports: p,
      refresher: fakeRefresher(false),
      log: (l) => logs.push(l),
    });
    expect(await poller.poll(HOUR)).toBe(POLL_MS);
    expect(await poller.poll(HOUR + 60_000)).toBe(2 * POLL_MS);
    const state = hub.state(HOUR + 60_000);
    expect(state.sources.usage).toMatchObject({ health: "ok", error: null });
    expect(state.limits.fiveHour?.usedPct).toBe(20);
    expect(logs).toEqual(["usage rate limited; keeping the reading from 60 s ago"]);
  });

  it("a 429 once the last reading is 15 minutes old marks rate limited", async () => {
    const hub = new Hub();
    const limited = { kind: "rate_limited" } as UsageResult;
    const { p } = ports({ results: [{ kind: "ok", input: okInput }, limited] });
    const poller = new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) });
    await poller.poll(HOUR);
    await poller.poll(HOUR + FRESH_MS);
    expect(hub.state(HOUR + FRESH_MS).sources.usage?.error).toBe("rate limited");
  });

  it("a 429 with no prior reading marks rate limited", async () => {
    const hub = new Hub();
    const { p } = ports({ results: [{ kind: "rate_limited" } as UsageResult] });
    const poller = new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) });
    await poller.poll(HOUR);
    expect(hub.state(HOUR).sources.usage?.error).toBe("rate limited");
  });

  it("an error result neither ingests nor caches and does not reset a growing backoff", async () => {
    const hub = new Hub();
    const limited = { kind: "rate_limited" } as UsageResult;
    const { p, calls } = ports({
      results: [limited, { kind: "error", message: "HTTP 500" }, limited],
    });
    const poller = new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) });
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) delays.push(await poller.poll(HOUR));
    expect(delays).toEqual([2 * POLL_MS, POLL_MS, 4 * POLL_MS]);
    expect(calls.saved).toBe(0);
    expect(hub.state(HOUR).limits.fiveHour).toBeNull();
    expect(hub.state(HOUR).sources.usage?.error).toBe("rate limited");
  });

  it("does not call the endpoint with an expired token: requests a refresh, then marks expired", async () => {
    const hub = new Hub();
    const refresher = fakeRefresher(false);
    const { p, calls } = ports({ readCredentials: async () => creds(0) });
    await new UsagePoller({ hub, ports: p, refresher }).poll(HOUR);
    expect(calls.fetch).toBe(0);
    expect(refresher.requests).toBe(1);
    expect(hub.state(HOUR).limits.auth).toBe("expired");
  });

  it("an expired token plus a refresher whose run throws leaves auth expired", async () => {
    const hub = new Hub();
    const refresher = new TokenRefresher({
      run: async () => {
        throw new Error("boom");
      },
      readExpiresAt: async () => 0,
      log: () => {},
    });
    const { p, calls } = ports({ readCredentials: async () => creds(0) });
    await expect(new UsagePoller({ hub, ports: p, refresher }).poll(HOUR)).resolves.toBe(POLL_MS);
    expect(calls.fetch).toBe(0);
    expect(hub.state(HOUR).limits.auth).toBe("expired");
  });

  it("refreshes ahead of expiry but still uses the valid token when the refresh fails", async () => {
    const hub = new Hub();
    const refresher = fakeRefresher(false);
    const { p, calls } = ports({ readCredentials: async () => creds(HOUR + 60_000) });
    expect(await new UsagePoller({ hub, ports: p, refresher }).poll(HOUR)).toBe(POLL_MS);
    expect(refresher.requests).toBe(1);
    expect(calls.fetch).toBe(1);
    expect(hub.state(HOUR).limits.auth).toBe("ok");
  });

  it("a far-future token makes no refresh request", async () => {
    const hub = new Hub();
    const refresher = fakeRefresher(true);
    const { p } = ports({ readCredentials: async () => creds(10 * HOUR) });
    await new UsagePoller({ hub, ports: p, refresher }).poll(HOUR);
    expect(refresher.requests).toBe(0);
  });

  it("refreshes at exactly REFRESH_AHEAD_MS left, not one millisecond more", async () => {
    const withinWindow = fakeRefresher(false);
    await new UsagePoller({
      hub: new Hub(),
      ports: ports({ readCredentials: async () => creds(HOUR + 240_000) }).p,
      refresher: withinWindow,
    }).poll(HOUR);
    expect(withinWindow.requests).toBe(1);

    const outsideWindow = fakeRefresher(false);
    await new UsagePoller({
      hub: new Hub(),
      ports: ports({ readCredentials: async () => creds(HOUR + 240_001) }).p,
      refresher: outsideWindow,
    }).poll(HOUR);
    expect(outsideWindow.requests).toBe(0);
  });

  it("an expired token plus a successful refresh fetches with the new token", async () => {
    const hub = new Hub();
    const files = [creds(0, "old"), creds(10 * HOUR, "new")];
    const { p, calls } = ports({
      readCredentials: async () => files.shift() ?? creds(10 * HOUR, "new"),
    });
    await new UsagePoller({ hub, ports: p, refresher: fakeRefresher(true) }).poll(HOUR);
    expect(calls.tokens).toEqual(["new"]);
    expect(hub.state(HOUR).limits.auth).toBe("ok");
  });

  it("on 401 marks expired, refreshes and retries once when the refresh succeeded", async () => {
    const hub = new Hub();
    const files = [creds(HOUR + 60_000, "old")];
    const { p, calls } = ports({
      readCredentials: async () => files.shift() ?? creds(HOUR + 60_000, "new"),
      results: [{ kind: "unauthorized" }, { kind: "ok", input: okInput }],
    });
    expect(
      await new UsagePoller({ hub, ports: p, refresher: fakeRefresher(true) }).poll(HOUR),
    ).toBe(POLL_MS);
    expect(calls.fetch).toBe(2);
    expect(calls.tokens).toEqual(["new", "new"]);
    expect(calls.tokens).not.toContain("old");
    expect(hub.state(HOUR).limits.auth).toBe("ok");
  });

  it("on 401 with a clock-valid token marks expired and does not ask the CLI to refresh", async () => {
    const hub = new Hub();
    const refresher = fakeRefresher(true);
    const { p, calls } = ports({ results: [{ kind: "unauthorized" }] });
    expect(await new UsagePoller({ hub, ports: p, refresher }).poll(HOUR)).toBe(POLL_MS);
    expect(refresher.requests).toBe(0);
    expect(calls.fetch).toBe(1);
    expect(hub.state(HOUR).limits.auth).toBe("expired");
  });

  it("on 401 twice, retries only once", async () => {
    const hub = new Hub();
    const refresher = fakeRefresher(true);
    const { p, calls } = ports({
      readCredentials: async () => creds(HOUR + 60_000),
      results: [{ kind: "unauthorized" }, { kind: "unauthorized" }],
    });
    expect(await new UsagePoller({ hub, ports: p, refresher }).poll(HOUR)).toBe(POLL_MS);
    expect(calls.fetch).toBe(2);
    expect(hub.state(HOUR).limits.auth).toBe("expired");
  });

  it("on 401 with a failed refresh stays expired without retrying", async () => {
    const hub = new Hub();
    const { p, calls } = ports({ results: [{ kind: "unauthorized" }] });
    expect(
      await new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) }).poll(HOUR),
    ).toBe(POLL_MS);
    expect(calls.fetch).toBe(1);
    expect(hub.state(HOUR).limits.auth).toBe("expired");
  });

  it("a throwing saveCache is best effort: the reading is still shown and POLL_MS returned", async () => {
    const hub = new Hub();
    const { p } = ports({
      saveCache: async () => {
        throw new Error("disk full");
      },
    });
    expect(
      await new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) }).poll(HOUR),
    ).toBe(POLL_MS);
    expect(hub.state(HOUR).limits.fiveHour?.usedPct).toBe(20);
  });

  it("start() shows the cached reading immediately", async () => {
    const hub = new Hub();
    const { p } = ports({ loadCache: async () => ({ input: okInput, at: HOUR - 60_000 }) });
    await new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) }).start();
    expect(hub.state(HOUR).limits.fiveHour?.usedPct).toBe(20);
  });

  it("without credentials reports missing and waits POLL_MS", async () => {
    const hub = new Hub();
    const { p } = ports({ readCredentials: async () => null });
    expect(
      await new UsagePoller({ hub, ports: p, refresher: fakeRefresher(false) }).poll(HOUR),
    ).toBe(POLL_MS);
    expect(hub.state(HOUR).sources.usage).toMatchObject({
      health: "missing",
      error: "no credentials",
    });
  });
});
