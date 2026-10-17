import { request } from "node:http";
import type { Envelope } from "@vibetribe/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createIngress, type IngressOptions, isLoopback } from "../src/http/ingress";
import { Hub } from "../src/hub";

const valid = {
  v: 1,
  kind: "hook",
  source: { host: "win", os: "windows", distro: null, entrypoint: "claude-desktop" },
  session: { id: "s1", cwd: "C:/p", pid: 1, hostSessionId: null },
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
};

const statusline = {
  v: 1,
  kind: "statusline",
  source: { host: "win", os: "windows", distro: null, entrypoint: "claude-desktop" },
  session: { id: "s1", cwd: "C:/p", pid: 1, hostSessionId: null },
  ts: 1,
  fiveHour: null,
  sevenDay: null,
};

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function start(over: Partial<IngressOptions> = {}) {
  const received: Envelope[] = [];
  const ats: number[] = [];
  let invalid = 0;
  const errors: unknown[] = [];
  const hub = new Hub();
  const ing = createIngress({
    token: "secret-token",
    now: () => 42,
    onEnvelope: (env, at) => {
      received.push(env);
      ats.push(at);
    },
    onInvalid: () => invalid++,
    state: () => hub.state(42),
    debugHtml: () => "<html>debug</html>",
    onError: (err) => errors.push(err),
    ...over,
  });
  const port = await ing.listen(0);
  close = ing.close;
  return { port, received, ats, invalid: () => invalid, errors, stop: ing.close };
}

type Reply = {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
};

function send(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string>; body?: string },
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "POST",
        path: opts.path,
        headers: { host: `127.0.0.1:${port}`, ...opts.headers },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => {
          b += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: b, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}
const auth = { authorization: "Bearer secret-token", "content-type": "application/json" };
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ingress", () => {
  it("accepts a valid envelope with 202 and processes it asynchronously", async () => {
    const s = await start();
    const r = await send(s.port, { path: "/v1/event", headers: auth, body: JSON.stringify(valid) });
    expect(r.status).toBe(202);
    await tick();
    expect(s.received).toHaveLength(1);
  });

  it.each([
    ["wrong token", { ...auth, authorization: "Bearer nope" }, 401],
    ["no token", { "content-type": "application/json" }, 401],
    ["browser origin", { ...auth, origin: "https://evil.example" }, 403],
    ["foreign host header", { ...auth, host: "evil.example:43710" }, 403],
    ["text/plain body (no-cors simple request)", { ...auth, "content-type": "text/plain" }, 415],
  ])("rejects %s", async (_n, headers, status) => {
    const s = await start();
    const r = await send(s.port, { path: "/v1/event", headers, body: JSON.stringify(valid) });
    expect(r.status).toBe(status);
    await tick();
    expect(s.received).toHaveLength(0);
  });

  it("rejects invalid envelopes with 400 and counts them", async () => {
    const s = await start();
    expect((await send(s.port, { path: "/v1/event", headers: auth, body: "{bad" })).status).toBe(
      400,
    );
    expect(
      (
        await send(s.port, {
          path: "/v1/event",
          headers: auth,
          body: JSON.stringify({ ...valid, v: 9 }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await send(s.port, { path: "/v1/statusline", headers: auth, body: JSON.stringify(valid) }))
        .status,
    ).toBe(400);
    expect(s.invalid()).toBe(3);
  });

  it("rejects bodies over 64 KiB with 413", async () => {
    const s = await start();
    const r = await send(s.port, { path: "/v1/event", headers: auth, body: "x".repeat(70_000) });
    expect(r.status).toBe(413);
  });

  it("treats a body of exactly 64 KiB as a body (400, not 413) and 64 KiB + 1 as too large", async () => {
    const s = await start();
    const exact = await send(s.port, {
      path: "/v1/event",
      headers: auth,
      body: "x".repeat(65_536),
    });
    expect(exact.status).toBe(400);
    const over = await send(s.port, {
      path: "/v1/event",
      headers: auth,
      body: "x".repeat(65_537),
    });
    expect(over.status).toBe(413);
  });

  it("accepts a valid statusline envelope on /v1/statusline and rejects it on /v1/event", async () => {
    const s = await start();
    const ok = await send(s.port, {
      path: "/v1/statusline",
      headers: auth,
      body: JSON.stringify(statusline),
    });
    expect(ok.status).toBe(202);
    await tick();
    expect(s.received).toHaveLength(1);
    const wrong = await send(s.port, {
      path: "/v1/event",
      headers: auth,
      body: JSON.stringify(statusline),
    });
    expect(wrong.status).toBe(400);
  });

  it("does not count 401, 403, 413 or 415 as invalid envelopes", async () => {
    const s = await start();
    await send(s.port, {
      path: "/v1/event",
      headers: { ...auth, authorization: "Bearer nope" },
      body: JSON.stringify(valid),
    });
    await send(s.port, {
      path: "/v1/event",
      headers: { ...auth, origin: "https://evil.example" },
      body: JSON.stringify(valid),
    });
    await send(s.port, { path: "/v1/event", headers: auth, body: "x".repeat(70_000) });
    await send(s.port, {
      path: "/v1/event",
      headers: { ...auth, "content-type": "text/plain" },
      body: JSON.stringify(valid),
    });
    expect(s.invalid()).toBe(0);
  });

  it("passes the acceptance time to onEnvelope and keeps the arrival order", async () => {
    const s = await start();
    const first = { ...valid, session: { ...valid.session, id: "first" } };
    const second = { ...valid, session: { ...valid.session, id: "second" } };
    await send(s.port, { path: "/v1/event", headers: auth, body: JSON.stringify(first) });
    await send(s.port, { path: "/v1/event", headers: auth, body: JSON.stringify(second) });
    await sleep(20);
    expect(s.ats).toEqual([42, 42]);
    expect(s.received.map((e) => (e.kind === "hook" ? e.session.id : ""))).toEqual([
      "first",
      "second",
    ]);
  });

  it("answers 415 when the content-type header is missing, even with a valid token", async () => {
    const s = await start();
    const r = await send(s.port, {
      path: "/v1/event",
      headers: { authorization: "Bearer secret-token" },
      body: JSON.stringify(valid),
    });
    expect(r.status).toBe(415);
  });

  it("matches the Bearer scheme case-insensitively, but the token exactly", async () => {
    const s = await start();
    const lower = await send(s.port, {
      path: "/v1/event",
      headers: { ...auth, authorization: "bearer secret-token" },
      body: JSON.stringify(valid),
    });
    expect(lower.status).toBe(202);
    const sameLength = await send(s.port, {
      path: "/v1/event",
      headers: { ...auth, authorization: "Bearer secret-tokeX" },
      body: JSON.stringify(valid),
    });
    expect(sameLength.status).toBe(401);
    const noScheme = await send(s.port, {
      path: "/v1/event",
      headers: { ...auth, authorization: "secret-token" },
      body: JSON.stringify(valid),
    });
    expect(noScheme.status).toBe(401);
  });

  it("refuses to start with an empty token", () => {
    expect(() =>
      createIngress({
        token: "",
        now: () => 0,
        onEnvelope: () => {},
        onInvalid: () => {},
        state: () => new Hub().state(0),
        debugHtml: () => "",
        onError: () => {},
      }),
    ).toThrow();
  });

  it("serves health, debug page and state.json without token, but never secrets", async () => {
    const s = await start();
    expect((await send(s.port, { method: "GET", path: "/health" })).body).toBe('{"ok":true}');
    expect((await send(s.port, { method: "GET", path: "/debug" })).body).toBe("<html>debug</html>");
    const state = await send(s.port, { method: "GET", path: "/debug/state.json" });
    expect(JSON.parse(state.body)).toMatchObject({ now: 42, sessions: [] });
    expect(state.body).not.toContain("secret-token");
  });

  it("serves the key mirror as page and JSON, null without a deck", async () => {
    const none = await start();
    const empty = await send(none.port, { method: "GET", path: "/debug/keys.json" });
    expect(empty.body).toBe("null");
    expect((await send(none.port, { method: "GET", path: "/debug/keys" })).body).toContain(
      "No deck connected",
    );
    await none.stop();
    const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
    const s = await start({
      mirror: () => ({
        at: 42,
        sentLastSecond: 3,
        pending: 0,
        keys: [
          { id: "k1", role: "slot", slot: 0, device: "d", row: 1, column: 0, image, sentAt: 40 },
        ],
      }),
    });
    const json = await send(s.port, { method: "GET", path: "/debug/keys.json" });
    expect(JSON.parse(json.body)).toMatchObject({ sentLastSecond: 3, keys: [{ id: "k1" }] });
    const page = await send(s.port, { method: "GET", path: "/debug/keys" });
    expect(page.headers["content-security-policy"]).toContain("img-src data:");
    expect(page.body).toContain(`<img src="${image}"`);
    expect(page.body).toContain("slot 1");
  });

  it("answers 500 instead of crashing when a handler throws, and keeps serving", async () => {
    const s = await start({
      state: () => {
        throw new RangeError("bad time zone");
      },
    });
    expect((await send(s.port, { method: "GET", path: "/debug/state.json" })).status).toBe(500);
    expect(s.errors).toHaveLength(1);
    expect((await send(s.port, { method: "GET", path: "/health" })).status).toBe(200);
  });

  it("answers 500 and keeps serving when the handler throws and onError throws too", async () => {
    const s = await start({
      state: () => {
        throw new RangeError("bad time zone");
      },
      onError: () => {
        throw new Error("reporter down");
      },
    });
    expect((await send(s.port, { method: "GET", path: "/debug/state.json" })).status).toBe(500);
    expect((await send(s.port, { method: "GET", path: "/health" })).status).toBe(200);
  });

  it("keeps serving when onEnvelope and onError both throw", async () => {
    const s = await start({
      onEnvelope: () => {
        throw new Error("boom");
      },
      onError: () => {
        throw new Error("reporter down");
      },
    });
    expect(
      (await send(s.port, { path: "/v1/event", headers: auth, body: JSON.stringify(valid) }))
        .status,
    ).toBe(202);
    await tick();
    expect((await send(s.port, { method: "GET", path: "/health" })).status).toBe(200);
  });

  it("reports an exception while processing an envelope instead of crashing", async () => {
    const s = await start({
      onEnvelope: () => {
        throw new Error("boom");
      },
    });
    expect(
      (await send(s.port, { path: "/v1/event", headers: auth, body: JSON.stringify(valid) }))
        .status,
    ).toBe(202);
    await tick();
    expect(s.errors).toHaveLength(1);
  });

  it("close() resolves within 1 s even while a request body is stalled", async () => {
    const s = await start();
    const stalled = request({
      host: "127.0.0.1",
      port: s.port,
      method: "POST",
      path: "/v1/event",
      headers: { host: `127.0.0.1:${s.port}`, ...auth, "content-length": "1000" },
    });
    stalled.on("error", () => {});
    stalled.write('{"v":1');
    await sleep(50);
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 1000));
    const outcome = await Promise.race([s.stop().then(() => "closed" as const), timeout]);
    stalled.destroy();
    expect(outcome).toBe("closed");
  });

  it("answers 404 for unknown paths", async () => {
    const s = await start();
    expect((await send(s.port, { method: "GET", path: "/nope" })).status).toBe(404);
  });

  it("rejects listen() when the port is taken, then listens on another port", async () => {
    const s = await start();
    const second = createIngress({
      token: "t",
      now: () => 0,
      onEnvelope: () => {},
      onInvalid: () => {},
      state: () => new Hub().state(0),
      debugHtml: () => "",
      onError: () => {},
    });
    try {
      await expect(second.listen(s.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
      const port = await second.listen(0);
      expect(port).not.toBe(s.port);
      // the host check follows the port it got
      expect((await send(port, { method: "GET", path: "/health" })).status).toBe(200);
    } finally {
      await second.close();
    }
  });

  it("failed listens leave no listener behind: eleven, then a bind, and no MaxListenersExceededWarning", async () => {
    const s = await start();
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.name);
    process.on("warning", onWarning);
    const second = createIngress({
      token: "t",
      now: () => 0,
      onEnvelope: () => {},
      onInvalid: () => {},
      state: () => new Hub().state(0),
      debugHtml: () => "",
      onError: () => {},
    });
    try {
      for (let i = 0; i < 11; i++) {
        await expect(second.listen(s.port)).rejects.toMatchObject({ code: "EADDRINUSE" });
      }
      expect(await second.listen(0)).not.toBe(s.port);
      await tick();
      expect(warnings).not.toContain("MaxListenersExceededWarning");
    } finally {
      process.off("warning", onWarning);
      await second.close();
    }
  });

  it("sends nosniff on every response", async () => {
    const s = await start();
    const health = await send(s.port, { method: "GET", path: "/health" });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    const rejected = await send(s.port, { path: "/v1/event", headers: { host: "evil" }, body: "" });
    expect(rejected.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sends a strict Content-Security-Policy on the debug page", async () => {
    const s = await start();
    const r = await send(s.port, { method: "GET", path: "/debug" });
    expect(r.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
    );
  });

  it("guards the key mirror like the other debug endpoints", async () => {
    const image = "data:image/svg+xml;utf8,<svg a='1'>&amp;</svg>";
    const s = await start({
      mirror: () => ({
        at: 1,
        sentLastSecond: 0,
        pending: 0,
        keys: [
          { id: "k", role: "slot", slot: 0, device: "d", row: 0, column: 0, image, sentAt: 1 },
        ],
      }),
    });
    for (const path of ["/debug/keys", "/debug/keys.json"]) {
      expect(
        (await send(s.port, { method: "GET", path, headers: { "sec-fetch-site": "cross-site" } }))
          .status,
      ).toBe(403);
      expect(
        (await send(s.port, { method: "GET", path, headers: { host: `evil.example:${s.port}` } }))
          .status,
      ).toBe(403);
      expect(
        (await send(s.port, { method: "GET", path, headers: { origin: "https://evil.example" } }))
          .status,
      ).toBe(403);
    }
  });

  it("returns the mirror image string byte-for-byte in the JSON", async () => {
    const image = `data:image/svg+xml;utf8,<svg a="1" b='2'>&amp;</svg>ä`;
    const s = await start({
      mirror: () => ({
        at: 1,
        sentLastSecond: 0,
        pending: 0,
        keys: [
          { id: "k", role: "slot", slot: 0, device: "d", row: 0, column: 0, image, sentAt: 1 },
        ],
      }),
    });
    const json = await send(s.port, { method: "GET", path: "/debug/keys.json" });
    expect(JSON.parse(json.body).keys[0].image).toBe(image);
    expect(json.body).toContain(JSON.stringify(image));
  });

  it("tolerates a throwing mirror: the page says so, the JSON answers 503", async () => {
    const s = await start({
      mirror: () => {
        throw new Error("plugin gone");
      },
    });
    const page = await send(s.port, { method: "GET", path: "/debug/keys" });
    expect(page.status).toBe(200);
    expect(page.body).toContain("Mirror unavailable");
    expect((await send(s.port, { method: "GET", path: "/debug/keys.json" })).status).toBe(503);
    expect(s.errors).toHaveLength(0);
    expect((await send(s.port, { method: "GET", path: "/health" })).status).toBe(200);
  });

  it("refuses cross-site GET requests to the debug endpoints but allows same-origin ones", async () => {
    const s = await start();
    for (const path of ["/debug", "/debug/state.json", "/debug/keys", "/debug/keys.json"]) {
      expect(
        (await send(s.port, { method: "GET", path, headers: { "sec-fetch-site": "cross-site" } }))
          .status,
      ).toBe(403);
      expect(
        (await send(s.port, { method: "GET", path, headers: { "sec-fetch-site": "same-origin" } }))
          .status,
      ).toBe(200);
    }
  });

  it("accepts the host spelled as localhost and rejects a bare host without port", async () => {
    const s = await start();
    expect(
      (
        await send(s.port, {
          method: "GET",
          path: "/debug",
          headers: { host: `localhost:${s.port}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (await send(s.port, { method: "GET", path: "/debug", headers: { host: "127.0.0.1" } }))
        .status,
    ).toBe(403);
    expect(
      (
        await send(s.port, {
          method: "GET",
          path: "/debug/state.json",
          headers: { host: "127.0.0.1" },
        })
      ).status,
    ).toBe(403);
  });

  it("rejects a foreign host and any origin header, including null and empty, on the debug endpoints", async () => {
    const s = await start();
    for (const path of ["/debug", "/debug/state.json", "/debug/keys", "/debug/keys.json"]) {
      expect(
        (await send(s.port, { method: "GET", path, headers: { host: `evil.example:${s.port}` } }))
          .status,
      ).toBe(403);
      expect(
        (await send(s.port, { method: "GET", path, headers: { origin: "null" } })).status,
      ).toBe(403);
      expect((await send(s.port, { method: "GET", path, headers: { origin: "" } })).status).toBe(
        403,
      );
    }
  });

  it("recognises loopback peer addresses only", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("192.168.1.10")).toBe(false);
    expect(isLoopback("::ffff:10.0.0.5")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});
