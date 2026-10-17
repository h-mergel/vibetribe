import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fetchRemoteSessions,
  mapRemoteSession,
  parseRemoteSessions,
  REMOTE_ENVIRONMENT_KINDS,
  REMOTE_SESSIONS_URL,
} from "../src/remote/api";

const live = (over: Record<string, unknown> = {}) => ({
  id: "cse_01Abc",
  title: "Mac Build",
  connection_status: "connected",
  status: "active",
  status_bucket: "completed",
  worker_status: "idle",
  unread: false,
  ...over,
});

describe("mapRemoteSession", () => {
  it.each([
    [
      "blocked + need_input, unread",
      {
        status_bucket: "blocked",
        unread: true,
        external_metadata: { post_turn_summary: { status_category: "need_input" } },
      },
      "waiting",
      false,
    ],
    [
      "blocked without a category, unread",
      { status_bucket: "blocked", unread: true },
      "waiting",
      false,
    ],
    [
      "need_input in another bucket, unread",
      {
        status_bucket: "x",
        unread: true,
        external_metadata: { post_turn_summary: { status_category: "need_input" } },
      },
      "waiting",
      false,
    ],
    [
      "blocked + need_input, read: the user has seen the question",
      {
        status_bucket: "blocked",
        unread: false,
        external_metadata: { post_turn_summary: { status_category: "need_input" } },
      },
      "idle",
      false,
    ],
    [
      "need_input in another bucket, read",
      {
        status_bucket: "x",
        unread: false,
        external_metadata: { post_turn_summary: { status_category: "need_input" } },
      },
      "idle",
      false,
    ],
    [
      "blocked with a running worker, read: a live prompt stays input",
      { status_bucket: "blocked", worker_status: "running", unread: false },
      "waiting",
      false,
    ],
    [
      "blocked with an unknown worker_status, read",
      { status_bucket: "blocked", worker_status: "thinking", unread: false },
      "waiting",
      false,
    ],
    [
      "blocked without an unread field stays input",
      { status_bucket: "blocked", unread: undefined },
      "waiting",
      false,
    ],
    [
      "an unknown worker_status",
      { status_bucket: "running", worker_status: "thinking" },
      "busy",
      false,
    ],
    [
      "running wins over a stale need_input",
      {
        status_bucket: "running",
        worker_status: "running",
        external_metadata: { post_turn_summary: { status_category: "need_input" } },
      },
      "busy",
      false,
    ],
    ["completed + unread", { unread: true }, "idle", true],
    [
      "completed by category + unread",
      {
        status_bucket: "x",
        unread: true,
        external_metadata: { post_turn_summary: { status_category: "completed" } },
      },
      "idle",
      true,
    ],
    ["completed and read", { unread: false }, "idle", false],
    ["unread but not completed", { status_bucket: "x", unread: true }, "idle", false],
    [
      "no worker_status at all",
      { worker_status: undefined, status_bucket: undefined },
      "idle",
      false,
    ],
  ])("%s", (_name, over, status, doneUnread) => {
    expect(mapRemoteSession(live(over))).toMatchObject({ status, doneUnread });
  });

  describe("review_ready (probe 2026-10-14)", () => {
    /** the shape the probe saw on a connected idle session the deck showed as Idle */
    const probe = (over: Record<string, unknown> = {}) =>
      live({
        status_bucket: "review_ready",
        worker_status: "idle",
        unread: true,
        external_metadata: { post_turn_summary: { status_category: "review_ready" } },
        ...over,
      });
    const category = (c: string) => ({
      external_metadata: { post_turn_summary: { status_category: c } },
    });

    it.each([
      ["bucket and category review_ready, unread", probe(), "idle", true],
      ["the same, read", probe({ unread: false }), "idle", false],
      ["review_ready only as bucket", probe(category("x")), "idle", true],
      ["review_ready only as category", probe({ status_bucket: "x" }), "idle", true],
      // a turn that ends with a question is input: need_input wins
      ["review_ready bucket, need_input category", probe(category("need_input")), "waiting", false],
      ["review_ready while the worker runs", probe({ worker_status: "running" }), "busy", false],
      ["review_ready but blocked", probe({ status_bucket: "blocked" }), "waiting", false],
      [
        "review_ready bucket, need_input category, read",
        probe({ ...category("need_input"), unread: false }),
        "idle",
        false,
      ],
    ])("%s", (_name, raw, status, doneUnread) => {
      expect(mapRemoteSession(raw)).toMatchObject({ status, doneUnread });
    });
  });

  it("drops archived, not connected and id-less sessions", () => {
    expect(mapRemoteSession(live({ status: "archived" }))).toBeNull();
    expect(mapRemoteSession(live({ connection_status: "disconnected" }))).toBeNull();
    expect(mapRemoteSession(live({ connection_status: undefined }))).toBeNull();
    expect(mapRemoteSession(live({ id: "local_123" }))).toBeNull();
    expect(mapRemoteSession(live({ id: "cse_01;calc" }))).toBeNull();
    expect(mapRemoteSession(live({ id: "session_01;calc" }))).toBeNull();
    expect(mapRemoteSession(live({ id: "cse_" }))).toBeNull();
    expect(mapRemoteSession(live({ id: 7 }))).toBeNull();
    expect(mapRemoteSession("cse_01Abc")).toBeNull();
  });

  it("normalizes the id to the session_ form (R3)", () => {
    expect(mapRemoteSession(live({ id: "cse_01Abc" }))?.id).toBe("session_01Abc");
    expect(mapRemoteSession(live({ id: "session_01Abc" }))?.id).toBe("session_01Abc");
  });

  it("uses the title (trimmed, at most 200 chars) and last_event_at", () => {
    const s = mapRemoteSession(
      live({ title: `  ${"x".repeat(300)}  `, last_event_at: "2026-10-13T10:00:00.000Z" }),
    );
    expect(s?.title).toHaveLength(200);
    expect(s?.at).toBe(Date.parse("2026-10-13T10:00:00.000Z"));
    expect(mapRemoteSession(live({ title: "   " }))?.title).toBe("Remote");
    expect(mapRemoteSession(live({ title: 5, last_event_at: "gestern" }))).toMatchObject({
      title: "Remote",
      at: null,
    });
  });

  it("never throws on odd field types", () => {
    const odd = live({
      status_bucket: 3,
      worker_status: { a: 1 },
      unread: "yes",
      external_metadata: "nope",
      last_event_at: 12,
    });
    expect(mapRemoteSession(odd)).toMatchObject({ status: "idle", doneUnread: false, at: null });
    expect(mapRemoteSession(live({ external_metadata: { post_turn_summary: [1] } }))).toMatchObject(
      { status: "idle" },
    );
  });
});

describe("parseRemoteSessions", () => {
  it("keeps only shown sessions and accepts an empty list", () => {
    expect(parseRemoteSessions({ data: [live(), live({ status: "archived" })] })).toHaveLength(1);
    expect(parseRemoteSessions({ data: [], next_cursor: null })).toEqual([]);
  });

  it("reports schema drift as null", () => {
    expect(parseRemoteSessions(null)).toBeNull();
    expect(parseRemoteSessions([])).toBeNull();
    expect(parseRemoteSessions({ sessions: [] })).toBeNull();
    expect(parseRemoteSessions({ data: [{ id: "cse_01A", connected: true }] })).toBeNull();
  });

  it("reports a non-empty list without any valid id as drift", () => {
    expect(parseRemoteSessions({ data: [live({ id: "x_01A" }), live({ id: 7 })] })).toBeNull();
    expect(parseRemoteSessions({ data: [live({ id: undefined })] })).toBeNull();
  });

  it("reports a non-empty list without any known connection_status as drift", () => {
    expect(
      parseRemoteSessions({
        data: [live({ connection_status: "online" }), live({ connection_status: "up" })],
      }),
    ).toBeNull();
  });

  it("keeps all-archived and all-disconnected lists with valid ids as valid empty lists", () => {
    expect(parseRemoteSessions({ data: [live({ status: "archived" })] })).toEqual([]);
    expect(parseRemoteSessions({ data: [live({ connection_status: "disconnected" })] })).toEqual(
      [],
    );
  });

  it("maps the headless fixture onto four sessions", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../fixtures/remote/sessions.json", import.meta.url), "utf8"),
    );
    expect(parseRemoteSessions(fixture)?.map((s) => [s.id, s.status, s.doneUnread])).toEqual([
      ["session_01SimBlocked", "waiting", false],
      ["session_01SimWorking", "busy", false],
      ["session_01SimDone", "idle", true],
      ["session_01SimRead", "idle", false],
    ]);
  });
});

type Call = { url: string; init?: RequestInit };
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

describe("fetchRemoteSessions", () => {
  it("sends the probe-J2 request and maps a 200", async () => {
    const { impl, calls } = respond(200, JSON.stringify({ data: [live()] }));
    const r = await fetchRemoteSessions("tok", "2.1.287", impl);
    expect(r).toMatchObject({ kind: "ok", sessions: [{ id: "session_01Abc", status: "idle" }] });
    const { url, init } = calls[0] as Call;
    expect(url).toBe(REMOTE_SESSIONS_URL);
    const h = new Headers(init?.headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("anthropic-beta")).toBe("oauth-2025-04-20");
    expect(h.get("anthropic-version")).toBe("2023-06-01");
    expect(h.get("user-agent")).toBe("claude-code/2.1.287");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
  });

  it.each([
    [401, { kind: "unauthorized" }],
    [429, { kind: "rate_limited" }],
    [403, { kind: "error", message: "HTTP 403" }],
    [500, { kind: "error", message: "HTTP 500" }],
    [503, { kind: "error", message: "HTTP 503" }],
  ])("maps status %i", async (status, expected) => {
    expect(await fetchRemoteSessions("tok", "1", respond(status, "{}").impl)).toEqual(expected);
  });

  it("maps a broken body and a drifted schema to fixed messages", async () => {
    expect(await fetchRemoteSessions("tok", "1", respond(200, "<html>").impl)).toEqual({
      kind: "error",
      message: "invalid response",
    });
    expect(await fetchRemoteSessions("tok", "1", respond(200, '{"items":[]}').impl)).toEqual({
      kind: "error",
      message: "unexpected response",
    });
  });

  it("never puts the token into a result", async () => {
    const r = await fetchRemoteSessions(
      "supersecret",
      "1",
      throwing(new Error("x Bearer supersecret y")),
    );
    expect(r).toEqual({ kind: "error", message: "network error" });
    expect(JSON.stringify(r)).not.toContain("supersecret");
  });

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
    await fetchRemoteSessions("tok", "1", impl);
    expect(cancels).toBe(1);
  });
});

describe("environment kinds (cloud sessions)", () => {
  it("shows Remote Control ('bridge') and entries without the field, not other kinds", () => {
    expect(mapRemoteSession(live({ environment_kind: "bridge" }))).not.toBeNull();
    expect(mapRemoteSession(live({ environment_kind: undefined }))).not.toBeNull();
    expect(mapRemoteSession(live({ environment_kind: "anthropic_cloud" }))).toBeNull();
    expect(REMOTE_ENVIRONMENT_KINDS).toEqual(["bridge"]);
  });
});
