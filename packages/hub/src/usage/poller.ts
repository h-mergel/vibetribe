import type { EndpointInput } from "@vibetribe/core";
import type { Hub } from "../hub";
import type { TokenRefresher } from "./refresh";
import type { Credentials, UsageCache, UsageResult } from "./usage";

export const POLL_MS = 300_000;
export const MAX_BACKOFF_MS = 1_800_000;
/** The CLI only refreshes inside its own 5 min window; ask a little later than that. */
export const REFRESH_AHEAD_MS = 240_000;
/** A 429 does not replace a reading younger than this: the numbers are still good (not an outage). */
export const FRESH_MS = 15 * 60_000;

export interface UsagePorts {
  readCredentials(): Promise<Credentials | null>;
  fetchUsage(token: string): Promise<UsageResult>;
  loadCache(): Promise<UsageCache | null>;
  saveCache(input: EndpointInput, at: number): Promise<void>;
}

/** Polls the usage endpoint (spec §7.1); the runtime schedules poll() with the returned delay. */
export class UsagePoller {
  readonly #hub: Hub;
  readonly #ports: UsagePorts;
  readonly #refresher: TokenRefresher;
  readonly #log: (line: string) => void;
  #backoff = POLL_MS;
  /** When the last good reading was taken (cache or endpoint); null when there has been none. */
  #lastSuccessAt: number | null = null;

  constructor(p: {
    hub: Hub;
    ports: UsagePorts;
    refresher: TokenRefresher;
    log?: (line: string) => void;
  }) {
    this.#hub = p.hub;
    this.#ports = p.ports;
    this.#refresher = p.refresher;
    this.#log = p.log ?? (() => {});
  }

  /** Shows the last known reading right away, before the first request. */
  async start(): Promise<void> {
    const cached = await this.#ports.loadCache();
    if (cached) {
      this.#hub.ingestUsage(cached.input, cached.at);
      this.#lastSuccessAt = cached.at;
    }
  }

  /** One poll; returns the delay until the next. The runtime never starts two at once. */
  async poll(now: number): Promise<number> {
    let creds = await this.#ports.readCredentials();
    if (!creds) {
      this.#hub.markError("usage", "no credentials");
      return POLL_MS;
    }
    if (creds.expiresAt - now <= REFRESH_AHEAD_MS) {
      if (await this.#refresher.request(now))
        creds = (await this.#ports.readCredentials()) ?? creds;
      if (creds.expiresAt <= now) {
        this.#hub.usageExpired();
        return POLL_MS;
      }
    }
    let result = await this.#ports.fetchUsage(creds.accessToken);
    if (result.kind === "unauthorized") {
      this.#hub.usageExpired();
      // A token the clock still calls valid is not something the CLI refresh can fix.
      if (creds.expiresAt - now > REFRESH_AHEAD_MS) return POLL_MS;
      if (await this.#refresher.request(now)) {
        const fresh = await this.#ports.readCredentials();
        if (fresh) result = await this.#ports.fetchUsage(fresh.accessToken);
      }
    }
    switch (result.kind) {
      case "ok":
        this.#backoff = POLL_MS;
        this.#lastSuccessAt = now;
        this.#hub.ingestUsage(result.input, now);
        try {
          await this.#ports.saveCache(result.input, now);
        } catch {
          // The cache is best effort; the reading is already shown.
        }
        return POLL_MS;
      case "rate_limited":
        this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
        if (this.#lastSuccessAt === null || now - this.#lastSuccessAt >= FRESH_MS) {
          this.#hub.markError("usage", "rate limited");
        } else {
          const ago = Math.round((now - this.#lastSuccessAt) / 1000);
          this.#log(`usage rate limited; keeping the reading from ${ago} s ago`);
        }
        return this.#backoff;
      case "unauthorized":
        return POLL_MS;
      case "error":
        this.#hub.markError("usage", result.message);
        return POLL_MS;
    }
  }
}
