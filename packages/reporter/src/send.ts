export type Post = (path: string, body: unknown) => Promise<boolean>;

/** POST JSON to the hub. Never throws; gives up after timeoutMs. Node's fetch sends no Origin header. */
export function makePost(
  hubUrl: string,
  token: string | null,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Post {
  return async (path, body) => {
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetchImpl(new URL(path, hubUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}
