/**
 * CLI arguments that make `claude` refresh its OAuth token without a model call (research
 * 2026-10-10 §2.4): `/cost` talks to the server with the token. `--setting-sources ""` skips user
 * settings — and with them our own hooks, so the refresh never shows up as a session.
 * `--no-session-persistence` keeps it out of the session list.
 */
export const REFRESH_ARGS: string[] = [
  "-p",
  "/cost",
  "--output-format",
  "json",
  "--no-session-persistence",
  "--setting-sources",
  "",
];

export type RunCommand = (args: string[]) => Promise<boolean>;

const REFRESH_MIN_INTERVAL_MS = 3_600_000;

/**
 * Asks the installed CLI to refresh the credentials file — VibeTribe never refreshes tokens itself.
 * Success = expiresAt moved forward and lies in the future. At most one attempt per hour; each
 * attempt logs one line without token content.
 */
export class TokenRefresher {
  readonly #run: RunCommand;
  readonly #readExpiresAt: () => Promise<number | null>;
  readonly #log: (line: string) => void;
  #lastAttemptAt: number | null = null;

  constructor(p: {
    run: RunCommand;
    readExpiresAt: () => Promise<number | null>;
    log: (line: string) => void;
  }) {
    this.#run = p.run;
    this.#readExpiresAt = p.readExpiresAt;
    this.#log = p.log;
  }

  /** Never rejects: a throwing spawn or read counts as "not refreshed". */
  async request(now: number): Promise<boolean> {
    const last = this.#lastAttemptAt;
    // A clock that stepped backwards (now < last) is treated as a reset, so the attempt is allowed.
    if (last !== null && now >= last && now - last < REFRESH_MIN_INTERVAL_MS) return false;
    this.#lastAttemptAt = now;
    let refreshed = false;
    try {
      const before = (await this.#readExpiresAt()) ?? Number.NEGATIVE_INFINITY;
      await this.#run(REFRESH_ARGS);
      const after = await this.#readExpiresAt();
      refreshed = after !== null && after > before && after > now;
    } catch {
      // a failed spawn or read leaves the login as it was
    }
    this.#log(`token refresh: ${refreshed ? "ok" : "no change"}`);
    return refreshed;
  }
}
