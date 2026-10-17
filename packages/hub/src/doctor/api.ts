import { isObj } from "@vibetribe/protocol";
import type { OAuthFailure } from "../oauth";
import {
  fetchRemoteSessions,
  isShownRemote,
  KNOWN_REMOTE_VALUES,
  type RemoteResult,
  type RemoteValues,
  remoteValuesOf,
} from "../remote/api";
import { type Credentials, fetchUsage, type UsageResult } from "../usage/usage";
import {
  type CheckResult,
  changed,
  hoursBetween,
  isShapeError,
  ok,
  skipped,
  wordOf,
} from "./check";

/** The credentials files carry a token the API checks can use (shape only; the token stays here). */
export function checkCredentials(
  credentials: Credentials | null,
  files: number,
  now: number,
): CheckResult {
  if (files === 0) return skipped("credentials", "no credentials file");
  if (credentials === null)
    return changed("credentials", "no claudeAiOauth with accessToken and expiresAt");
  const at = hoursBetween(credentials.expiresAt, now);
  return ok("credentials", credentials.expiresAt > now ? `expires in ${at}` : `expired ${at} ago`);
}

/** A failed request: a reply that no longer parses is drift, anything else (login, 429, network) is not checkable now. */
function failure(name: string, f: OAuthFailure): CheckResult {
  if (f.kind === "unauthorized") return skipped(name, "login rejected (401)");
  if (f.kind === "rate_limited") return skipped(name, "rate limited (429)");
  if (isShapeError(f.message))
    return changed(name, `${f.message}: the reply no longer has the expected shape`);
  return skipped(name, f.message);
}

/** Unknown values per field across the list's entries, e.g. `status_bucket "paused"`; values only. */
function unknownValues(data: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const field of Object.keys(KNOWN_REMOTE_VALUES) as (keyof RemoteValues)[]) {
    const seen = new Set<string>();
    for (const entry of data) {
      const value = isObj(entry) ? remoteValuesOf(entry)[field] : null;
      if (value !== null && !KNOWN_REMOTE_VALUES[field].includes(value)) seen.add(wordOf(value));
    }
    if (seen.size > 0) out.push(`${field} ${[...seen].join(", ")}`);
  }
  return out;
}

/** The account's session list as the mapper reads it; `raw` is the reply's body. */
export function checkRemoteList(result: RemoteResult, raw: unknown): CheckResult {
  const name = "remote session list";
  if (result.kind !== "ok") return failure(name, result);
  const data: unknown[] = isObj(raw) && Array.isArray(raw.data) ? raw.data : [];
  if (data.length === 0) return skipped(name, "the list is empty");
  const unknown = unknownValues(data);
  const values = data.map((e) => (isObj(e) ? remoteValuesOf(e) : null));
  for (const field of ["connection_status", "status", "environment_kind"] as const) {
    if (!values.some((v) => v?.[field] != null)) unknown.push(`no string ${field}`);
  }
  if (result.sessions.length === 0 && values.some((v) => v && isShownRemote(v)))
    unknown.push("no usable id");
  if (!data.some((e) => isObj(e) && typeof e.unread === "boolean"))
    unknown.push("no boolean unread");
  if (unknown.length > 0) return changed(name, unknown.join("; "));
  return ok(name, `entries: ${data.length}, all values known`);
}

/** The usage reply as the limit and extra tiles read it. */
export function checkUsage(result: UsageResult): CheckResult {
  if (result.kind !== "ok") return failure("usage", result);
  const { fiveHour, sevenDay, extra } = result.input;
  const missing = [
    fiveHour ? null : "five_hour",
    sevenDay ? null : "seven_day",
    extra ? null : "extra_usage",
  ].filter((m) => m !== null);
  if (missing.length > 0) return changed("usage", `${missing.join(", ")} missing or reshaped`);
  if (extra?.inactive === "other")
    return changed("usage", "extra_usage is off for a reason the tile does not know");
  return ok("usage", `five_hour, seven_day, extra_usage ${extra?.enabled ? "on" : "off"}`);
}

/**
 * One GET of the session list and one of the usage endpoint, with the production fetchers, and
 * their checks. Without a usable login nothing is requested.
 */
export async function checkApis(o: {
  credentials: Credentials | null;
  now: number;
  version: string;
  fetchImpl?: typeof fetch;
}): Promise<CheckResult[]> {
  const { credentials } = o;
  if (credentials === null || credentials.expiresAt <= o.now) {
    const why = credentials === null ? "no usable credentials" : "login expired";
    return [skipped("remote session list", why), skipped("usage", why)];
  }
  const fetchImpl = o.fetchImpl ?? fetch;
  let body: unknown;
  // the mapper drops what it does not know: the drift check needs the raw entries too
  const keepBody: typeof fetch = async (input, init) => {
    const res = await fetchImpl(input, init);
    body = await res
      .clone()
      .json()
      .catch(() => undefined);
    return res;
  };
  const remote = await fetchRemoteSessions(credentials.accessToken, o.version, keepBody);
  const usage = await fetchUsage(credentials.accessToken, o.version, fetchImpl);
  return [checkRemoteList(remote, body), checkUsage(usage)];
}
