import { describe, expect, it } from "vitest";
import {
  fetchUsage,
  mapUsageResponse,
  parseUsageCache,
  pickCredentials,
  USAGE_URL,
} from "../src/usage/usage";

describe("parseUsageCache", () => {
  it("round-trips a saved reading", () => {
    const input = {
      fiveHour: { usedPct: 20, resetsAt: 5 },
      sevenDay: null,
      extra: { enabled: false, usedCredits: 0, monthlyLimit: 50, currency: "EUR" },
    };
    expect(parseUsageCache(JSON.stringify({ input, at: 7 }))).toEqual({ input, at: 7 });
  });

  it("drops unknown keys and rebuilds from whitelisted fields", () => {
    const text = JSON.stringify({
      input: {
        fiveHour: { usedPct: 20, resetsAt: 5, junk: 1 },
        sevenDay: null,
        extra: { enabled: true, usedCredits: 1, monthlyLimit: null, currency: "EUR", junk: 2 },
        junk: "x",
      },
      at: 7,
      junk: true,
    });
    expect(parseUsageCache(text)).toEqual({
      input: {
        fiveHour: { usedPct: 20, resetsAt: 5 },
        sevenDay: null,
        extra: { enabled: true, usedCredits: 1, monthlyLimit: null, currency: "EUR" },
      },
      at: 7,
    });
  });

  it("accepts resetsAt null and extra null", () => {
    const input = { fiveHour: { usedPct: 1, resetsAt: null }, sevenDay: null, extra: null };
    expect(parseUsageCache(JSON.stringify({ input, at: 1 }))).toEqual({ input, at: 1 });
  });

  it.each([
    ["broken json", "{"],
    ["empty object", "{}"],
    ["missing at", JSON.stringify({ input: { fiveHour: null } })],
    ["string at", JSON.stringify({ input: { fiveHour: null }, at: "1" })],
    ["missing input", JSON.stringify({ at: 1 })],
    ["bad window", JSON.stringify({ input: { fiveHour: { usedPct: "x" } }, at: 1 })],
    [
      "bad sevenDay",
      JSON.stringify({ input: { sevenDay: { usedPct: "x", resetsAt: null } }, at: 1 }),
    ],
    [
      "resetsAt string",
      JSON.stringify({ input: { fiveHour: { usedPct: 1, resetsAt: "x" } }, at: 1 }),
    ],
    ["bad extra", JSON.stringify({ input: { extra: { enabled: "yes" } }, at: 1 })],
    [
      "monthlyLimit string",
      JSON.stringify({
        input: { extra: { enabled: true, usedCredits: 1, monthlyLimit: "50", currency: "EUR" } },
        at: 1,
      }),
    ],
    [
      "monthlyLimit missing",
      JSON.stringify({
        input: { extra: { enabled: true, usedCredits: 1, currency: "EUR" } },
        at: 1,
      }),
    ],
    [
      "currency missing",
      JSON.stringify({
        input: { extra: { enabled: false, usedCredits: 0, monthlyLimit: null } },
        at: 1,
      }),
    ],
    ["array", "[]"],
  ])("rejects %s", (_n, text) => {
    expect(parseUsageCache(text)).toBeNull();
  });
});

const creds = (expiresAt: number, token = "tok") =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: "r", expiresAt } });

describe("pickCredentials", () => {
  it("chooses the file with the latest expiresAt and ignores broken files", () => {
    expect(
      pickCredentials([
        creds(100, "old"),
        creds(200, "new"),
        "{oops",
        JSON.stringify({ claudeAiOauth: { expiresAt: 999 } }),
      ]),
    ).toEqual({ accessToken: "new", expiresAt: 200 });
    expect(pickCredentials([])).toBeNull();
  });

  it("skips a token without expiresAt", () => {
    expect(pickCredentials([JSON.stringify({ claudeAiOauth: { accessToken: "t" } })])).toBeNull();
  });

  it("keeps the first file on equal expiresAt", () => {
    expect(pickCredentials([creds(100, "first"), creds(100, "second")])).toEqual({
      accessToken: "first",
      expiresAt: 100,
    });
  });

  it("skips an array root", () => {
    expect(
      pickCredentials([
        JSON.stringify([{ claudeAiOauth: { accessToken: "arr", expiresAt: 999 } }]),
      ]),
    ).toBeNull();
  });
});

describe("mapUsageResponse (probe K shape)", () => {
  it("maps windows and extra usage in minor units", () => {
    const input = mapUsageResponse({
      five_hour: { utilization: 20, resets_at: "2026-10-10T21:00:00Z" },
      seven_day: { utilization: 86, resets_at: "2026-10-14T08:00:00Z" },
      extra_usage: {
        is_enabled: true,
        monthly_limit: 5000,
        used_credits: 1240,
        currency: "EUR",
        decimal_places: 2,
      },
    });
    expect(input).toEqual({
      fiveHour: { usedPct: 20, resetsAt: Date.parse("2026-10-10T21:00:00Z") },
      sevenDay: { usedPct: 86, resetsAt: Date.parse("2026-10-14T08:00:00Z") },
      extra: { enabled: true, usedCredits: 12.4, monthlyLimit: 50, currency: "EUR" },
    });
  });

  it("tolerates missing parts", () => {
    expect(mapUsageResponse({ five_hour: null })).toEqual({
      fiveHour: null,
      sevenDay: null,
      extra: null,
    });
    expect(mapUsageResponse("nope")).toEqual({ fiveHour: null, sevenDay: null, extra: null });
  });

  it("maps an invalid resets_at to null", () => {
    expect(mapUsageResponse({ five_hour: { utilization: 5, resets_at: "nope" } }).fiveHour).toEqual(
      {
        usedPct: 5,
        resetsAt: null,
      },
    );
  });

  it("parses a resets_at with offset and microseconds", () => {
    expect(
      mapUsageResponse({
        five_hour: { utilization: 5, resets_at: "2026-10-10T21:00:00.123456+00:00" },
      }).fiveHour,
    ).toEqual({
      usedPct: 5,
      resetsAt: Date.UTC(2026, 9, 10, 21, 0, 0, 123),
    });
  });

  it("passes utilization above 100 through unchanged", () => {
    expect(mapUsageResponse({ five_hour: { utilization: 150, resets_at: null } }).fiveHour).toEqual(
      {
        usedPct: 150,
        resetsAt: null,
      },
    );
  });

  it("explains an inactive extra usage (real probe object: on, but no prepaid credit)", () => {
    const extra = mapUsageResponse({
      extra_usage: {
        is_enabled: false,
        monthly_limit: 5000,
        used_credits: 0,
        utilization: 0,
        currency: "EUR",
        decimal_places: 2,
        disabled_reason: "out_of_credits",
        user_disabled: false,
        spend_limit_reached: false,
        credits_ever_enabled: true,
        daily: null,
        weekly: null,
      },
    }).extra;
    expect(extra).toEqual({
      enabled: false,
      usedCredits: 0,
      monthlyLimit: 50,
      currency: "EUR",
      inactive: "no_credit",
    });
  });

  it.each([
    ["limit_reached", { spend_limit_reached: true }],
    ["disabled", { user_disabled: true }],
    ["other", {}],
    ["other", { disabled_reason: 7, user_disabled: "yes" }],
    ["limit_reached", { disabled_reason: "out_of_credits", spend_limit_reached: true }],
    ["disabled", { disabled_reason: "out_of_credits", user_disabled: true }],
    ["disabled", { spend_limit_reached: true, user_disabled: true }],
    ["no_credit", { disabled_reason: "out_of_credits" }],
  ])("derives inactive %s from %j", (inactive, fields) => {
    const extra = mapUsageResponse({
      extra_usage: { is_enabled: false, used_credits: 0, monthly_limit: 5000, ...fields },
    }).extra;
    expect(extra?.inactive).toBe(inactive);
  });

  it("leaves inactive absent while extra usage is enabled", () => {
    const extra = mapUsageResponse({
      extra_usage: { is_enabled: true, used_credits: 0, disabled_reason: "out_of_credits" },
    }).extra;
    expect(extra).not.toHaveProperty("inactive");
  });

  it("keeps inactive through the cache and ignores an unknown value", () => {
    const input = {
      fiveHour: null,
      sevenDay: null,
      extra: {
        enabled: false,
        usedCredits: 0,
        monthlyLimit: 50,
        currency: "EUR",
        inactive: "no_credit",
      },
    };
    expect(parseUsageCache(JSON.stringify({ input, at: 7 }))).toEqual({ input, at: 7 });
    const bad = { ...input, extra: { ...input.extra, inactive: "bogus" } };
    const { inactive: _i, ...rest } = input.extra;
    expect(parseUsageCache(JSON.stringify({ input: bad, at: 7 }))?.input.extra).toEqual(rest);
  });

  it("drops a stored inactive while the cached extra is enabled", () => {
    const extra = { enabled: true, usedCredits: 0, monthlyLimit: 50, currency: "EUR" };
    const text = JSON.stringify({ input: { extra: { ...extra, inactive: "no_credit" } }, at: 1 });
    expect(parseUsageCache(text)?.input.extra).toEqual(extra);
  });

  it("gives extra null when is_enabled is not a boolean", () => {
    expect(
      mapUsageResponse({ extra_usage: { is_enabled: "yes", used_credits: 1, currency: "EUR" } })
        .extra,
    ).toBeNull();
  });

  it.each([-2, 1.5, 7, 400, "2", null])("gives extra null for decimal_places %s", (dp) => {
    expect(
      mapUsageResponse({
        extra_usage: {
          is_enabled: true,
          used_credits: 1240,
          monthly_limit: 5000,
          decimal_places: dp,
        },
      }).extra,
    ).toBeNull();
  });

  it("accepts decimal_places 0 and 6 and scales accordingly", () => {
    expect(
      mapUsageResponse({
        extra_usage: {
          is_enabled: true,
          used_credits: 100,
          monthly_limit: 5000,
          decimal_places: 0,
        },
      }).extra,
    ).toEqual({ enabled: true, usedCredits: 100, monthlyLimit: 5000, currency: "EUR" });
    expect(
      mapUsageResponse({
        extra_usage: {
          is_enabled: true,
          used_credits: 1240000,
          monthly_limit: 5000000,
          decimal_places: 6,
        },
      }).extra,
    ).toEqual({ enabled: true, usedCredits: 1.24, monthlyLimit: 5, currency: "EUR" });
  });

  it("gives extra null when used_credits is null or missing", () => {
    expect(
      mapUsageResponse({
        extra_usage: { is_enabled: true, used_credits: null, monthly_limit: 5000 },
      }).extra,
    ).toBeNull();
    expect(
      mapUsageResponse({ extra_usage: { is_enabled: true, monthly_limit: 5000 } }).extra,
    ).toBeNull();
  });

  it("gives monthlyLimit null when monthly_limit is null or missing", () => {
    expect(
      mapUsageResponse({
        extra_usage: { is_enabled: true, used_credits: 100, monthly_limit: null },
      }).extra,
    ).toEqual({
      enabled: true,
      usedCredits: 1,
      monthlyLimit: null,
      currency: "EUR",
    });
    expect(
      mapUsageResponse({ extra_usage: { is_enabled: true, used_credits: 100 } }).extra
        ?.monthlyLimit,
    ).toBeNull();
  });
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** Fake fetch that records its arguments; assertions happen in the test, never inside the fake. */
const respond = (status: number, text: string) => {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(text, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
};

const throwing = (err: unknown) =>
  (async () => {
    throw err;
  }) as unknown as typeof fetch;

describe("fetchUsage", () => {
  it.each([401, 429, 503])("cancels the unread body of a %i answer", async (status) => {
    let cancels = 0;
    const impl = (async () => ({
      ok: false,
      status,
      body: {
        cancel: async () => {
          cancels++;
        },
      },
    })) as unknown as typeof fetch;
    await fetchUsage("tok", "1", impl);
    expect(cancels).toBe(1);
  });

  it("maps 200 and sends the expected request", async () => {
    const { impl, calls } = respond(
      200,
      JSON.stringify({ five_hour: { utilization: 5, resets_at: null } }),
    );
    expect(await fetchUsage("tok", "2.1.287", impl)).toEqual({
      kind: "ok",
      input: { fiveHour: { usedPct: 5, resetsAt: null }, sevenDay: null, extra: null },
    });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] as Call;
    expect(url).toBe(USAGE_URL);
    const h = new Headers(init?.headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("anthropic-beta")).toBe("oauth-2025-04-20");
    expect(h.get("user-agent")).toBe("claude-code/2.1.287");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
  });

  it.each([
    [401, { kind: "unauthorized" }],
    [429, { kind: "rate_limited" }],
    [403, { kind: "error", message: "HTTP 403" }],
    [404, { kind: "error", message: "HTTP 404" }],
    [500, { kind: "error", message: "HTTP 500" }],
  ])("maps status %i", async (status, expected) => {
    const { impl } = respond(status, "{}");
    expect(await fetchUsage("tok", "2.1.287", impl)).toEqual(expected);
  });

  it("never puts the token into an error message", async () => {
    const r = await fetchUsage("supersecret", "1", throwing(new Error("x Bearer supersecret y")));
    expect(r).toEqual({ kind: "error", message: "network error" });
    expect(JSON.stringify(r)).not.toContain("supersecret");
  });

  it.each(["TimeoutError", "AbortError"])("maps a thrown %s to timeout", async (name) => {
    const err = new Error("operation was aborted");
    err.name = name;
    expect(await fetchUsage("tok", "1", throwing(err))).toEqual({
      kind: "error",
      message: "timeout",
    });
  });

  it("maps a non-Error throw to network error", async () => {
    expect(await fetchUsage("tok", "1", throwing("boom"))).toEqual({
      kind: "error",
      message: "network error",
    });
  });

  it("maps a non-JSON 200 body to invalid response without leaking it", async () => {
    const r = await fetchUsage("tok", "1", respond(200, "<html>oops").impl);
    expect(r).toEqual({ kind: "error", message: "invalid response" });
    expect(JSON.stringify(r)).not.toContain("html");
  });

  it("accepts a 200 with only extra_usage", async () => {
    const body = JSON.stringify({
      extra_usage: {
        is_enabled: true,
        monthly_limit: 5000,
        used_credits: 100,
        currency: "EUR",
        decimal_places: 2,
      },
    });
    expect(await fetchUsage("tok", "1", respond(200, body).impl)).toEqual({
      kind: "ok",
      input: {
        fiveHour: null,
        sevenDay: null,
        extra: { enabled: true, usedCredits: 1, monthlyLimit: 50, currency: "EUR" },
      },
    });
  });

  it("accepts a 200 with only seven_day", async () => {
    const body = JSON.stringify({ seven_day: { utilization: 86, resets_at: null } });
    expect(await fetchUsage("tok", "1", respond(200, body).impl)).toEqual({
      kind: "ok",
      input: { fiveHour: null, sevenDay: { usedPct: 86, resetsAt: null }, extra: null },
    });
  });

  it.each(["{}", "null", '"x"'])(
    "treats an empty 200 body %s as unexpected response",
    async (text) => {
      expect(await fetchUsage("tok", "1", respond(200, text).impl)).toEqual({
        kind: "error",
        message: "unexpected response",
      });
    },
  );
});
