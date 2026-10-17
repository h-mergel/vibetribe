import { buildHookEnvelope, parseJson } from "../build";
import type { Env } from "../env";
import type { HostInfo } from "../host";
import type { Post } from "../send";

export interface HookDeps {
  stdin: string;
  env: Env;
  host: HostInfo | null;
  now: number;
  post: Post;
}

/** Fail-open: invalid input or an unsupported host sends nothing. */
export async function runHook(d: HookDeps): Promise<void> {
  if (!d.host) return;
  const envelope = buildHookEnvelope(parseJson(d.stdin), d.env, d.host, d.now);
  if (envelope) await d.post("/v1/event", envelope);
}
