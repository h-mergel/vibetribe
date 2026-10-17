import { buildStatuslineEnvelope, parseJson } from "../build";
import type { PreviousStatusline } from "../config";
import type { Env } from "../env";
import type { HostInfo } from "../host";
import type { Post } from "../send";

export type RunPrevious = (command: string, stdin: string, shell?: string) => Promise<string>;

export interface StatuslineDeps {
  stdin: string;
  env: Env;
  host: HostInfo | null;
  now: number;
  post: Post;
  previous: PreviousStatusline | null;
  runPrevious: RunPrevious;
}

/**
 * Starts the previous statusline and the hub POST at the same time and returns the previous
 * output unchanged. The hub never influences the output.
 */
export async function runStatusline(d: StatuslineDeps): Promise<string> {
  const prev = d.previous;
  const output = prev?.command.trim()
    ? Promise.resolve()
        .then(() => d.runPrevious(prev.command, d.stdin, prev.shell))
        .catch(() => "")
    : Promise.resolve("");
  const envelope = d.host
    ? buildStatuslineEnvelope(parseJson(d.stdin), d.env, d.host, d.now)
    : null;
  const sent = envelope ? d.post("/v1/statusline", envelope) : Promise.resolve(false);
  const [out] = await Promise.all([output, sent]);
  return out;
}
