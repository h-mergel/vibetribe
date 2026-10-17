import type { Hub } from "../hub";
import { renderDebugHtml } from "./debug";
import { createIngress } from "./ingress";
import { type DeckMirror, readMirror } from "./keys";

/**
 * Ingress alert texts. The plugin's status tile matches on these, so the hub builds them here and
 * nothing else spells them out.
 */
export const INGRESS_PORT_PREFIX = "Port ";
export const INGRESS_TOKEN_MESSAGE = "Token missing: run setup";

/** A port the ingress could not bind, with the listen error code (e.g. EADDRINUSE). */
export interface PortRefusal {
  port: number;
  code: string;
}

/** The ingress error when no port could be bound: the ports tried and their codes, in order. */
export function ingressPortError(refused: readonly PortRefusal[]): string {
  const ports = refused.map((r) => r.port).join(", ");
  const codes = refused.map((r) => r.code).join(", ");
  return `${INGRESS_PORT_PREFIX}${ports} in use or blocked (${codes}; check the WSL port range and netsh excludedportrange)`;
}

const refusalList = (refused: readonly PortRefusal[]): string =>
  refused.map((r) => `${r.port} ${r.code}`).join(", ");

/** While no port binds, all of them are tried again after this long. */
export const BIND_RETRY_MS = 5_000;

export interface ListenerOptions {
  hub: Hub;
  /** tried in this order */
  ports: readonly number[];
  token: string;
  /** setup never ran: `token` is a throwaway, the ingress health says INGRESS_TOKEN_MESSAGE */
  tokenMissing: boolean;
  /** records the bound port for the reporters; null = not recorded */
  savePort: ((port: number) => Promise<void>) | null;
  mirror: (() => DeckMirror | null) | undefined;
  now: () => number;
  log: (line: string) => void;
  /** schedules the next attempt; the hub's timer, which runs nothing once the hub stopped */
  later: (ms: number, retry: () => Promise<void>) => unknown;
}

/** The hub's HTTP ingress on the first port that binds; its outcome is the `ingress` health. */
export interface Listener {
  /** the bound port; null while none could be bound */
  readonly port: number | null;
  /**
   * Tries the ports in order; while none binds, all again every BIND_RETRY_MS. Never throws: a
   * failure becomes health and one log line per distinct failure.
   */
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createListener(o: ListenerOptions): Listener {
  const { hub, now, log } = o;
  const ingress = createIngress({
    token: o.token,
    now,
    onEnvelope: (env, at) => hub.ingest(env, at),
    onInvalid: () => hub.countInvalid(),
    state: () => hub.state(now()),
    debugHtml: () => renderDebugHtml(hub.state(now()), undefined, readMirror(o.mirror)),
    mirror: o.mirror,
    onError: (err) => log(`ingress error: ${String(err)}`),
  });
  // a missing token stays visible next to a port problem: the status key ranks them
  const setHealth = (portFailure: string | null): void => {
    const reasons = [portFailure, o.tokenMissing ? INGRESS_TOKEN_MESSAGE : null].filter(
      (r) => r !== null,
    );
    if (reasons.length === 0) hub.markOk("ingress", now());
    else hub.markError("ingress", reasons.join("; "));
  };
  let port: number | null = null;
  let lastFailure: string | null = null;
  let closed = false;

  const listen = async (): Promise<void> => {
    const refused: PortRefusal[] = [];
    for (const candidate of o.ports) {
      if (closed) return;
      const bound = await ingress.listen(candidate).catch((err: NodeJS.ErrnoException) => {
        refused.push({ port: candidate, code: err.code ?? "error" });
        return null;
      });
      // close() ran while this bind was pending: a bind that still succeeded must not stay open
      if (closed) {
        if (bound !== null) await ingress.close();
        return;
      }
      if (bound === null) continue;
      port = bound;
      setHealth(null);
      const after = refused.length > 0 ? ` (${refusalList(refused)})` : "";
      log(`hub listening on 127.0.0.1:${bound}${after}`);
      try {
        await o.savePort?.(bound);
      } catch (err) {
        log(`port file not saved: ${String(err)}`);
      }
      return;
    }
    const failure = ingressPortError(refused);
    setHealth(failure);
    if (failure !== lastFailure) {
      log(`ingress failed: ${refusalList(refused)}; retrying every ${BIND_RETRY_MS / 1_000} s`);
    }
    lastFailure = failure;
    o.later(BIND_RETRY_MS, listen);
  };

  if (o.tokenMissing)
    log("no token: run the reporter setup; the ingress accepts nothing until then");
  return {
    get port() {
      return port;
    },
    listen,
    close: () => {
      closed = true;
      port = null;
      return ingress.close();
    },
  };
}
