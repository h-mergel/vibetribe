/** The error for a reply that is no JSON. */
export const INVALID_RESPONSE = "invalid response";
/** The error for JSON that no longer has the shape its endpoint had. */
export const UNEXPECTED_RESPONSE = "unexpected response";

/** What a failed OAuth request means to its poller. */
export type OAuthFailure =
  | { kind: "unauthorized" }
  | { kind: "rate_limited" }
  | { kind: "error"; message: string };

/**
 * Only fixed strings leave this module as error messages: thrown errors may carry the token.
 * This is the one place to audit for that.
 */
function networkErrorMessage(err: unknown): "timeout" | "network error" {
  const name = typeof err === "object" && err !== null && "name" in err ? err.name : undefined;
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error";
}

/**
 * One GET to an undocumented api.anthropic.com endpoint with the CLI's OAuth token (probes K and
 * J2): no redirects, 10 s timeout, the body of a failed answer released at once.
 */
export async function getOAuthJson(
  url: string,
  token: string,
  version: string,
  extraHeaders: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ kind: "ok"; json: unknown } | OAuthFailure> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        ...extraHeaders,
        "user-agent": `claude-code/${version}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { kind: "error", message: networkErrorMessage(err) };
  }
  if (!res.ok) {
    // an unread body keeps the connection busy until it is collected
    await res.body?.cancel().catch(() => {});
    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 429) return { kind: "rate_limited" };
    return { kind: "error", message: `HTTP ${res.status}` };
  }
  try {
    return { kind: "ok", json: await res.json() };
  } catch {
    return { kind: "error", message: INVALID_RESPONSE };
  }
}
