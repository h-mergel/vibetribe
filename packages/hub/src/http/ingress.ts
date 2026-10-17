import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type Envelope, parseEnvelope } from "@vibetribe/protocol";
import type { HubState } from "../state";
import { type DeckMirror, readMirror, renderKeysHtml } from "./keys";

export const MAX_BODY = 65_536;

const BEARER = /^Bearer /i;
/** Key images are inline data URLs, nothing else may load. */
const DEBUG_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'";

export interface IngressOptions {
  token: string;
  now(): number;
  onEnvelope(env: Envelope, at: number): void;
  onInvalid(): void;
  state(): HubState;
  debugHtml(): string;
  /** Last images sent to the deck (plugin); null without a deck, e.g. in the standalone hub. */
  mirror?(): DeckMirror | null;
  /** Unexpected exception while handling a request or an envelope; never terminates the process. */
  onError(err: unknown): void;
}

/** Loopback peers only; the listener is 127.0.0.1, but a dual-stack socket reports ::ffff:127.0.0.1. */
export function isLoopback(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/** RFC 7235: the auth scheme is case-insensitive; the token itself is compared exactly, in constant time. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header !== undefined && BEARER.test(header) ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // answer 413 on the still-open socket; Node discards the rest of the body once the response ends
        resolve(null);
        chunks.length = 0;
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function reply(
  res: ServerResponse,
  status: number,
  body = "",
  type = "text/plain",
  extra: Record<string, string> = {},
): void {
  if (res.headersSent) return;
  res
    .writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    })
    .end(body);
}

/** Loopback HTTP ingress (spec §8.2): host + origin checks against browsers, bearer token, 202 then async processing. */
export function createIngress(o: IngressOptions): {
  /** Binds 127.0.0.1:`port` (0 = any free port); after a failed bind it can try another port. */
  listen(port: number): Promise<number>;
  close(): Promise<void>;
} {
  if (o.token.length === 0) throw new Error("ingress token must not be empty");
  let boundPort = 0;
  // A throwing reporter must not become an unhandled rejection or uncaught exception.
  const safeOnError = (err: unknown): void => {
    try {
      o.onError(err);
    } catch {
      // nothing left to report to; the server keeps answering
    }
  };
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopback(req.socket.remoteAddress)) return reply(res, 403, "forbidden peer");
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`)
      return reply(res, 403, "forbidden host");
    if (req.headers.origin !== undefined)
      return reply(res, 403, "browser requests are not allowed");
    const url = req.url ?? "/";
    if (req.method === "GET") {
      if (url === "/health") return reply(res, 200, '{"ok":true}', "application/json");
      if (url.startsWith("/debug") && req.headers["sec-fetch-site"] === "cross-site")
        return reply(res, 403, "cross-site request");
      if (url === "/debug")
        return reply(res, 200, o.debugHtml(), "text/html; charset=utf-8", {
          "content-security-policy": DEBUG_CSP,
        });
      if (url === "/debug/state.json")
        return reply(res, 200, JSON.stringify(o.state()), "application/json");
      if (url === "/debug/keys")
        return reply(res, 200, renderKeysHtml(readMirror(o.mirror)), "text/html; charset=utf-8", {
          "content-security-policy": DEBUG_CSP,
        });
      if (url === "/debug/keys.json") {
        const mirror = readMirror(o.mirror);
        if (mirror === "failed") return reply(res, 503, "mirror unavailable");
        return reply(res, 200, JSON.stringify(mirror), "application/json");
      }
      return reply(res, 404, "not found");
    }
    if (req.method !== "POST" || (url !== "/v1/event" && url !== "/v1/statusline"))
      return reply(res, 404, "not found");
    if (!(req.headers["content-type"] ?? "").startsWith("application/json"))
      return reply(res, 415, "json only");
    if (!tokenMatches(req.headers.authorization, o.token)) return reply(res, 401, "unauthorized");
    const body = await readBody(req);
    if (body === null) return reply(res, 413, "too large");
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      o.onInvalid();
      return reply(res, 400, "invalid json");
    }
    const parsed = parseEnvelope(raw);
    const expectedKind = url === "/v1/statusline" ? "statusline" : "hook";
    if (!parsed.ok || parsed.value.kind !== expectedKind) {
      o.onInvalid();
      return reply(res, 400, parsed.ok ? "wrong kind for this endpoint" : parsed.error);
    }
    const at = o.now();
    reply(res, 202);
    setImmediate(() => {
      try {
        o.onEnvelope(parsed.value, at);
      } catch (err) {
        safeOnError(err);
      }
    });
  };
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      reply(res, 500, "internal error");
      safeOnError(err);
    });
  });
  server.requestTimeout = 10_000;

  return {
    // each attempt removes both of its handlers: a failed bind must not leave one behind
    listen: (port) =>
      new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.off("error", onError);
          boundPort = (server.address() as AddressInfo).port;
          // an unhandled "error" event would terminate the process; the listen-time handler is gone by now
          server.on("error", safeOnError);
          resolve(boundPort);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      }),
    close: () =>
      new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        // a client that stalls mid-body would otherwise keep close() pending indefinitely
        server.closeAllConnections();
      }),
  };
}
