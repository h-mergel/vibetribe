import {
  type EndpointInput,
  EXTRA_INACTIVE,
  type ExtraInactive,
  type ExtraInput,
  type WindowInput,
} from "@vibetribe/core";
import { isFiniteNumber, isObj, type Obj } from "@vibetribe/protocol";
import { getOAuthJson, type OAuthFailure, UNEXPECTED_RESPONSE } from "../oauth";

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface Credentials {
  accessToken: string;
  /** ms epoch */
  expiresAt: number;
}

const num = (v: unknown): number | null => (isFiniteNumber(v) ? v : null);

/** The credentials file refreshed last wins (Claude Desktop does not refresh these files, probe K). */
export function pickCredentials(texts: string[]): Credentials | null {
  let best: Credentials | null = null;
  for (const text of texts) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      continue;
    }
    const oauth = isObj(raw) && isObj(raw.claudeAiOauth) ? raw.claudeAiOauth : null;
    const token = oauth && typeof oauth.accessToken === "string" ? oauth.accessToken : null;
    const expiresAt = oauth ? num(oauth.expiresAt) : null;
    if (!token || expiresAt === null) continue;
    if (!best || expiresAt > best.expiresAt) best = { accessToken: token, expiresAt };
  }
  return best;
}

function windowOf(v: unknown): WindowInput | null {
  if (!isObj(v)) return null;
  const pct = num(v.utilization);
  if (pct === null) return null;
  const resets = typeof v.resets_at === "string" ? Date.parse(v.resets_at) : Number.NaN;
  return { usedPct: pct, resetsAt: Number.isFinite(resets) ? resets : null };
}

/** Scale factor 10^decimal_places. Missing means the default 2; anything but an integer 0..6 is invalid. */
function scaleOf(v: unknown): number | null {
  if (v === undefined) return 100;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6 ? 10 ** v : null;
}

/** An explicit user switch-off wins, then the spend limit, then no credit. Tolerant: unknown fields give "other". */
function inactiveOf(v: Obj): ExtraInactive {
  if (v.user_disabled === true) return "disabled";
  if (v.spend_limit_reached === true) return "limit_reached";
  if (v.disabled_reason === "out_of_credits") return "no_credit";
  return "other";
}

function extraOf(v: unknown): ExtraInput | null {
  if (!isObj(v) || typeof v.is_enabled !== "boolean") return null;
  const scale = scaleOf(v.decimal_places);
  const used = num(v.used_credits);
  if (scale === null || used === null) return null;
  const limit = num(v.monthly_limit);
  return {
    enabled: v.is_enabled,
    usedCredits: used / scale,
    monthlyLimit: limit === null ? null : limit / scale,
    currency: typeof v.currency === "string" ? v.currency : "EUR",
    ...(v.is_enabled ? {} : { inactive: inactiveOf(v) }),
  };
}

export function mapUsageResponse(json: unknown): EndpointInput {
  const o = isObj(json) ? json : {};
  return {
    fiveHour: windowOf(o.five_hour),
    sevenDay: windowOf(o.seven_day),
    extra: extraOf(o.extra_usage),
  };
}

export interface UsageCache {
  input: EndpointInput;
  at: number;
}

/** Rebuilds a window from whitelisted fields. Absent or null means null; undefined means invalid. */
function cacheWindow(v: unknown): WindowInput | null | undefined {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || !isFiniteNumber(v.usedPct)) return undefined;
  const resetsAt = v.resetsAt;
  if (resetsAt === null) return { usedPct: v.usedPct, resetsAt: null };
  return isFiniteNumber(resetsAt) ? { usedPct: v.usedPct, resetsAt } : undefined;
}

/** Rebuilds extra usage from whitelisted fields. Absent or null means null; undefined means invalid. */
function cacheExtra(v: unknown): ExtraInput | null | undefined {
  if (v === undefined || v === null) return null;
  if (
    !isObj(v) ||
    typeof v.enabled !== "boolean" ||
    !isFiniteNumber(v.usedCredits) ||
    typeof v.currency !== "string"
  ) {
    return undefined;
  }
  const limit = v.monthlyLimit;
  if (limit !== null && !isFiniteNumber(limit)) return undefined;
  const inactive = v.enabled ? undefined : EXTRA_INACTIVE.find((i) => i === v.inactive);
  return {
    enabled: v.enabled,
    usedCredits: v.usedCredits,
    monthlyLimit: limit,
    currency: v.currency,
    ...(inactive ? { inactive } : {}),
  };
}

/** Our own cache file, but still untrusted on disk: anything unexpected means "no cache". */
export function parseUsageCache(text: string): UsageCache | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || !isFiniteNumber(raw.at) || !isObj(raw.input)) return null;
  const fiveHour = cacheWindow(raw.input.fiveHour);
  const sevenDay = cacheWindow(raw.input.sevenDay);
  const extra = cacheExtra(raw.input.extra);
  if (fiveHour === undefined || sevenDay === undefined || extra === undefined) return null;
  return { input: { fiveHour, sevenDay, extra }, at: raw.at };
}

export type UsageResult = { kind: "ok"; input: EndpointInput } | OAuthFailure;

export async function fetchUsage(
  token: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageResult> {
  const res = await getOAuthJson(USAGE_URL, token, version, {}, fetchImpl);
  if (res.kind !== "ok") return res;
  const input = mapUsageResponse(res.json);
  if (input.fiveHour === null && input.sevenDay === null && input.extra === null) {
    return { kind: "error", message: UNEXPECTED_RESPONSE };
  }
  return { kind: "ok", input };
}
