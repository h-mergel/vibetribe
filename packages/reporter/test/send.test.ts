import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { makePost } from "../src/send";

let server: Server | null = null;
afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler);
  server = s;
  return new Promise((resolve) =>
    s.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    ),
  );
}

describe("makePost", () => {
  it("posts JSON with bearer token and no Origin header", async () => {
    let seen: { auth?: string; type?: string; origin?: string; body?: string } = {};
    const url = await listen((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = {
          auth: req.headers.authorization,
          type: req.headers["content-type"],
          origin: req.headers.origin,
          body,
        };
        res.writeHead(202).end();
      });
    });
    const ok = await makePost(url, "tok", 300)("/v1/event", { a: 1 });
    expect(ok).toBe(true);
    expect(seen).toEqual({
      auth: "Bearer tok",
      type: "application/json",
      origin: undefined,
      body: '{"a":1}',
    });
  });

  it("returns false instead of throwing when the hub is down", async () => {
    expect(await makePost("http://127.0.0.1:1", null, 300)("/v1/event", {})).toBe(false);
  });

  it("returns false for a 500 response", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(500).end();
    });
    expect(await makePost(url, "tok", 300)("/v1/event", {})).toBe(false);
  });

  it("sends no authorization header when the token is null", async () => {
    let auth: string | undefined = "unset";
    const url = await listen((req, res) => {
      auth = req.headers.authorization;
      res.writeHead(202).end();
    });
    expect(await makePost(url, null, 300)("/v1/event", {})).toBe(true);
    expect(auth).toBeUndefined();
  });

  it("returns false for an invalid hub URL", async () => {
    expect(await makePost("not a url", "tok", 300)("/v1/event", {})).toBe(false);
  });

  it("gives up after the timeout when the hub hangs", async () => {
    const url = await listen(() => {
      /* never answer */
    });
    const t0 = Date.now();
    expect(await makePost(url, null, 50)("/v1/event", {})).toBe(false);
    expect(Date.now() - t0).toBeLessThan(300);
  });
});
