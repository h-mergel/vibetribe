import { describe, expect, it } from "vitest";
import { checkApis, checkCredentials, checkRemoteList, checkUsage } from "../src/doctor/api";
import { changed, ok, skipped } from "../src/doctor/check";
import { parseRemoteSessions, REMOTE_SESSIONS_URL, type RemoteResult } from "../src/remote/api";
import { mapUsageResponse, USAGE_URL } from "../src/usage/usage";

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;
const TOKEN = "sk-ant-oat-secret";
const entry = (fields: Record<string, unknown> = {}) => ({
  id: "cse_01Abc",
  title: "Secret plans",
  connection_status: "connected",
  status: "active",
  status_bucket: "completed",
  worker_status: "idle",
  environment_kind: "bridge",
  unread: true,
  external_metadata: { post_turn_summary: { status_category: "completed" } },
  ...fields,
});
const list = (data: unknown[]) => ({ data });
const listed = (raw: { data: unknown[] }): RemoteResult => ({
  kind: "ok",
  sessions: parseRemoteSessions(raw) ?? [],
});
const usage = (extra: Record<string, unknown> = { is_enabled: true }) => ({
  five_hour: { utilization: 12, resets_at: "2026-10-17T12:00:00Z" },
  seven_day: { utilization: 40, resets_at: "2026-10-20T08:00:00Z" },
  extra_usage: { used_credits: 1234, monthly_limit: 5000, currency: "EUR", ...extra },
});

describe("checkCredentials", () => {
  it("says whether the login can be used, never the token", () => {
    const creds = { accessToken: TOKEN, expiresAt: NOW + 2 * HOUR };
    expect(checkCredentials(creds, 2, NOW)).toEqual(ok("credentials", "expires in 2.0 h"));
    expect(checkCredentials({ ...creds, expiresAt: NOW - HOUR }, 1, NOW)).toEqual(
      ok("credentials", "expired 1.0 h ago"),
    );
    expect(checkCredentials(null, 2, NOW)).toEqual(
      changed("credentials", "no claudeAiOauth with accessToken and expiresAt"),
    );
    expect(checkCredentials(null, 0, NOW)).toEqual(skipped("credentials", "no credentials file"));
  });
});

describe("checkRemoteList", () => {
  it("accepts a list whose words the mapper knows", () => {
    const raw = list([entry(), entry({ status_bucket: "blocked", unread: false })]);
    expect(checkRemoteList(listed(raw), raw)).toEqual(
      ok("remote session list", "entries: 2, all values known"),
    );
  });

  it("names each unknown word with its field, never a title or an id", () => {
    const raw = list([
      entry({ status_bucket: "paused", worker_status: "stalled" }),
      entry({ external_metadata: { post_turn_summary: { status_category: "waiting_on_ci" } } }),
      entry({ environment_kind: "cloud", status_bucket: "paused", worker_status: "Secret plans" }),
    ]);
    const result = checkRemoteList(listed(raw), raw);
    expect(result).toEqual(
      changed(
        "remote session list",
        'status_bucket "paused"; status_category "waiting_on_ci"; worker_status "stalled", a non-word value; environment_kind "cloud"',
      ),
    );
    expect(result.detail).not.toMatch(/Secret|cse_/);
  });

  it("calls a list without any boolean unread drift and skips an empty one", () => {
    const raw = list([entry({ unread: undefined }), entry({ unread: "yes" })]);
    expect(checkRemoteList(listed(raw), raw)).toEqual(
      changed("remote session list", "no boolean unread"),
    );
    expect(checkRemoteList(listed(list([])), list([]))).toEqual(
      skipped("remote session list", "the list is empty"),
    );
  });

  it("calls a list whose ids no longer map drift, without showing an id", () => {
    const raw = list([entry({ id: "ses_01Abc" }), entry({ id: "ses_02Abc" })]);
    const result = checkRemoteList(listed(raw), raw);
    expect(result).toEqual(changed("remote session list", "no usable id"));
    expect(result.detail).not.toMatch(/ses_/);
  });

  it("calls a list drift when only entries without a status have lost their ids", () => {
    const raw = list([entry({ id: "ses_01Abc", status: undefined })]);
    expect(checkRemoteList(listed(raw), raw)).toEqual(
      changed("remote session list", "no string status; no usable id"),
    );
  });

  it("calls a list in which a field is gone from every entry drift", () => {
    const raw = list([
      entry({ connection_status: undefined }),
      entry({ connection_status: undefined }),
    ]);
    expect(checkRemoteList(listed(raw), raw)).toEqual(
      changed("remote session list", "no string connection_status"),
    );
  });

  it.each([
    [{ kind: "unauthorized" } as const, skipped("remote session list", "login rejected (401)")],
    [{ kind: "rate_limited" } as const, skipped("remote session list", "rate limited (429)")],
    [
      { kind: "error", message: "network error" } as const,
      skipped("remote session list", "network error"),
    ],
    [
      { kind: "error", message: "unexpected response" } as const,
      changed(
        "remote session list",
        "unexpected response: the reply no longer has the expected shape",
      ),
    ],
  ])("maps a failed request %o", (result, expected) => {
    expect(checkRemoteList(result, undefined)).toEqual(expected);
  });
});

describe("checkUsage", () => {
  it("accepts the fields the limit and extra tiles read", () => {
    expect(checkUsage({ kind: "ok", input: mapUsageResponse(usage()) })).toEqual(
      ok("usage", "five_hour, seven_day, extra_usage on"),
    );
    const off = usage({ is_enabled: false, disabled_reason: "out_of_credits" });
    expect(checkUsage({ kind: "ok", input: mapUsageResponse(off) })).toEqual(
      ok("usage", "five_hour, seven_day, extra_usage off"),
    );
  });

  it("names the parts that are gone and an unknown reason for extra usage being off", () => {
    const { seven_day: _, ...withoutWeek } = usage();
    expect(checkUsage({ kind: "ok", input: mapUsageResponse(withoutWeek) })).toEqual(
      changed("usage", "seven_day missing or reshaped"),
    );
    const off = usage({ is_enabled: false, disabled_reason: "paused_by_admin" });
    expect(checkUsage({ kind: "ok", input: mapUsageResponse(off) })).toEqual(
      changed("usage", "extra_usage is off for a reason the tile does not know"),
    );
    expect(checkUsage({ kind: "error", message: "unexpected response" })).toEqual(
      changed("usage", "unexpected response: the reply no longer has the expected shape"),
    );
  });
});

describe("checkApis", () => {
  it("requests nothing without a usable login", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response("{}");
    }) as typeof fetch;
    const expired = { accessToken: TOKEN, expiresAt: NOW };
    expect(
      await checkApis({ credentials: expired, now: NOW, version: "2.1.0", fetchImpl }),
    ).toEqual([skipped("remote session list", "login expired"), skipped("usage", "login expired")]);
    expect(await checkApis({ credentials: null, now: NOW, version: "2.1.0", fetchImpl })).toEqual([
      skipped("remote session list", "no usable credentials"),
      skipped("usage", "no usable credentials"),
    ]);
    expect(urls).toEqual([]);
  });

  it("checks one reply of each endpoint, fetched the way the hub fetches them", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
      return new Response(JSON.stringify(url === USAGE_URL ? usage() : list([entry()])));
    }) as typeof fetch;
    const credentials = { accessToken: TOKEN, expiresAt: NOW + HOUR };
    const results = await checkApis({ credentials, now: NOW, version: "2.1.0", fetchImpl });
    expect(results).toEqual([
      ok("remote session list", "entries: 1, all values known"),
      ok("usage", "five_hour, seven_day, extra_usage on"),
    ]);
    expect(urls).toEqual([REMOTE_SESSIONS_URL, USAGE_URL]);
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });
});
