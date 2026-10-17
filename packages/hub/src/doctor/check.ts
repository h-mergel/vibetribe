import { INVALID_RESPONSE, UNEXPECTED_RESPONSE } from "../oauth";

/** One assumption about an undocumented interface: it holds, it has changed, or it could not be checked. */
export type Outcome = "ok" | "changed" | "skipped";

export interface CheckResult {
  /** short and stable, e.g. "desktop pins"; the hourly self-check keys its log lines on it */
  name: string;
  outcome: Outcome;
  /** what was seen: counts, ages, known words; never titles, ids, contents or tokens */
  detail: string;
}

export const ok = (name: string, detail = ""): CheckResult => ({ name, outcome: "ok", detail });

export const changed = (name: string, detail: string): CheckResult => ({
  name,
  outcome: "changed",
  detail,
});

export const skipped = (name: string, detail: string): CheckResult => ({
  name,
  outcome: "skipped",
  detail,
});

/** `name: ok (detail)`, `name: changed: detail` or `name: skipped: detail`. */
export function formatResult(r: CheckResult): string {
  if (r.outcome === "ok") return `${r.name}: ok${r.detail ? ` (${r.detail})` : ""}`;
  return `${r.name}: ${r.outcome}: ${r.detail}`;
}

export const hasDrift = (results: readonly CheckResult[]): boolean =>
  results.some((r) => r.outcome === "changed");

/** The fetchers' messages for a reply that no longer has the expected shape: drift, not an outage. */
export const isShapeError = (message: string): boolean =>
  message === UNEXPECTED_RESPONSE || message === INVALID_RESPONSE;

/** An error's code such as "EBUSY", or "error": never its text, which can hold paths. */
export const codeOf = (err: unknown): string =>
  (err as NodeJS.ErrnoException | null)?.code ?? "error";

/** A value from a foreign format for a detail: quoted when it is a plain word, else never shown. */
export const wordOf = (value: string): string =>
  /^[a-z_]{1,32}$/.test(value) ? JSON.stringify(value) : "a non-word value";

/** "3.5 h" between `at` and `now`, for details such as "newest 3.5 h ago". */
export const hoursBetween = (at: number, now: number): string =>
  `${(Math.abs(now - at) / 3_600_000).toFixed(1)} h`;
