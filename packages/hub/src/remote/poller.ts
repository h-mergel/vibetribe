import type { Hub } from "../hub";
import type { Credentials } from "../usage/usage";
import type { RemoteResult } from "./api";
import { REMOTE_SOURCE } from "./names";

/**
 * Spec §4.3: the remote list is polled every 20 s (probe J2). There
 * is no push, so a new wait shows up with up to this delay.
 */
export const REMOTE_POLL_MS = 20_000;

/** Longest pause after repeated failures; the store has shown the sessions as no_signal long before. */
export const REMOTE_MAX_BACKOFF_MS = 300_000;

export interface RemotePorts {
  /** the same read-only credentials pick as the usage poller (latest expiresAt) */
  readCredentials(): Promise<Credentials | null>;
  fetchSessions(token: string): Promise<RemoteResult>;
}

const MESSAGE = { unauthorized: "login expired", rate_limited: "rate limited" } as const;

/** Polls the account's session list (spec §4, probe J2); the runtime schedules poll() with the returned delay. */
export class RemotePoller {
  readonly #hub: Hub;
  readonly #ports: RemotePorts;
  readonly #log: (line: string) => void;
  #delay = REMOTE_POLL_MS;
  #expiresAt: number | null = null;

  constructor(p: { hub: Hub; ports: RemotePorts; log?: (line: string) => void }) {
    this.#hub = p.hub;
    this.#ports = p.ports;
    this.#log = p.log ?? (() => {});
  }

  /** One request at most; returns the delay until the next poll. Endpoint failures never throw. */
  async poll(now: number): Promise<number> {
    const creds = await this.#ports.readCredentials();
    // no request without a usable token; the usage poller asks the CLI to refresh it
    if (!creds || creds.expiresAt <= now) {
      this.#hub.markError(REMOTE_SOURCE, creds ? "login expired" : "no credentials");
      return REMOTE_POLL_MS;
    }
    // a new token (the CLI refreshed it) starts over: repeated 401s must not back off forever
    if (this.#expiresAt !== null && creds.expiresAt !== this.#expiresAt)
      this.#delay = REMOTE_POLL_MS;
    this.#expiresAt = creds.expiresAt;
    const result = await this.#ports.fetchSessions(creds.accessToken);
    if (result.kind === "ok") {
      this.#delay = REMOTE_POLL_MS;
      this.#hub.ingestRemote(result.sessions, now);
      return REMOTE_POLL_MS;
    }
    // back off on everything else: 429, 5xx, timeouts, a drifted schema, a rejected login
    this.#delay = Math.min(this.#delay * 2, REMOTE_MAX_BACKOFF_MS);
    const message = result.kind === "error" ? result.message : MESSAGE[result.kind];
    this.#hub.markError(REMOTE_SOURCE, message);
    this.#log(`remote sessions: ${message}; next try in ${Math.round(this.#delay / 1000)} s`);
    return this.#delay;
  }
}
