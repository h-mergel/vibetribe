import type { FileStatus } from "@vibetribe/core";
import { isObj, type Obj } from "@vibetribe/protocol";
import { getOAuthJson, type OAuthFailure, UNEXPECTED_RESPONSE } from "../oauth";

/** Probe J2: the session list Claude Desktop and claude.ai use (undocumented, OAuth). */
export const REMOTE_SESSIONS_URL = "https://api.anthropic.com/v1/code/sessions?limit=50";

/** Ids as the API delivers them: `cse_<X>`, the same session as local `session_<X>` (probe J2c). */
const RAW_REMOTE_ID = /^(?:cse|session)_([A-Za-z0-9]{1,64})$/;

/**
 * Which `environment_kind` values are shown (the one switch for cloud sessions): `bridge` =
 * Remote Control on some machine (probe J2). `"all"` would also show e.g. cloud sessions.
 * Entries without the field are always kept.
 */
export const REMOTE_ENVIRONMENT_KINDS: readonly string[] | "all" = ["bridge"];

const MAX_TITLE = 200;

/** status_bucket / status_category of a finished turn (probes J2 and 2026-10-14). */
const DONE_VALUES: ReadonlySet<string> = new Set(["completed", "review_ready"]);

/** One live session of the account list, mapped onto what the hub needs (spec §4, probe J2). */
export interface RemoteSession {
  /** the bridgeSessionId, always in the `session_…` form */
  id: string;
  title: string;
  /** waiting = blocked on the user (needs input), busy = working, idle = anything else */
  status: FileStatus;
  /** finished a turn the user has not read on any device yet (done unseen) */
  doneUnread: boolean;
  /** last_event_at in ms; null when missing or unparseable */
  at: number | null;
}

export type RemoteResult = { kind: "ok"; sessions: RemoteSession[] } | OAuthFailure;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The word-valued fields the mapping reads; null when absent or not a string. */
export interface RemoteValues {
  status: string | null;
  status_bucket: string | null;
  /** external_metadata.post_turn_summary.status_category */
  status_category: string | null;
  worker_status: string | null;
  connection_status: string | null;
  environment_kind: string | null;
}

/** Every value the mapping was built on (probes J2, J2b, 2026-10-14); `pnpm drift` reports others. */
export const KNOWN_REMOTE_VALUES: Readonly<Record<keyof RemoteValues, readonly string[]>> = {
  status: ["active", "archived"],
  status_bucket: ["blocked", "completed", "review_ready", "working"],
  status_category: ["completed", "need_input", "review_ready"],
  worker_status: ["idle", "running"],
  connection_status: ["connected", "disconnected"],
  environment_kind: ["bridge"],
};

export function remoteValuesOf(raw: Obj): RemoteValues {
  const meta = isObj(raw.external_metadata) ? raw.external_metadata : null;
  const summary = meta && isObj(meta.post_turn_summary) ? meta.post_turn_summary : null;
  return {
    status: str(raw.status),
    status_bucket: str(raw.status_bucket),
    status_category: summary ? str(summary.status_category) : null,
    worker_status: str(raw.worker_status),
    connection_status: str(raw.connection_status),
    environment_kind: str(raw.environment_kind),
  };
}

/** Whether the mapping shows a session with these values: not archived, connected, a shown kind. */
export function isShownRemote(v: RemoteValues): boolean {
  if (v.status === "archived" || v.connection_status !== "connected") return false;
  const kind = v.environment_kind;
  return (
    REMOTE_ENVIRONMENT_KINDS === "all" || kind === null || REMOTE_ENVIRONMENT_KINDS.includes(kind)
  );
}

/**
 * Field mapping (probe J2). Null for sessions that are not shown: archived, not connected (the
 * session no longer runs on its machine; the list keeps such sessions for days), an environment
 * kind outside REMOTE_ENVIRONMENT_KINDS, no usable id. The id is normalized from `cse_<X>` to
 * `session_<X>` (probe J2c). Unknown values never throw: an unknown worker_status other than
 * "idle" counts as working.
 */
export function mapRemoteSession(raw: unknown): RemoteSession | null {
  if (!isObj(raw)) return null;
  const suffix = RAW_REMOTE_ID.exec(str(raw.id) ?? "")?.[1];
  if (suffix === undefined) return null;
  const id = `session_${suffix}`;
  const v = remoteValuesOf(raw);
  if (!isShownRemote(v)) return null;
  const bucket = v.status_bucket;
  const category = v.status_category;
  const worker = v.worker_status;
  let status: FileStatus = "idle";
  // a running worker beats need_input: that category describes the previous turn
  if (bucket === "blocked") status = "waiting";
  else if (worker === "running") status = "busy";
  else if (category === "need_input") status = "waiting";
  else if (worker !== null && worker !== "idle") status = "busy";
  // the summary also files offers ("say ready and I start") as input; once read, nothing waits
  const quiet = worker === null || worker === "idle";
  if (status === "waiting" && quiet && raw.unread === false) status = "idle";
  const finished = DONE_VALUES.has(bucket ?? "") || DONE_VALUES.has(category ?? "");
  const at = typeof raw.last_event_at === "string" ? Date.parse(raw.last_event_at) : Number.NaN;
  return {
    id,
    title: str(raw.title)?.trim().slice(0, MAX_TITLE) || "Remote",
    status,
    doneUnread: status === "idle" && finished && raw.unread === true,
    at: Number.isFinite(at) ? at : null,
  };
}

/**
 * The whole response, or null when it does not look like the session list any more (schema
 * drift): no `data` array, or a non-empty list in which no entry has a valid id or none has a
 * known `connection_status`. All-archived and all-disconnected lists stay valid.
 */
export function parseRemoteSessions(json: unknown): RemoteSession[] | null {
  if (!isObj(json) || !Array.isArray(json.data)) return null;
  const data: unknown[] = json.data;
  if (data.length > 0) {
    const hasId = data.some((s) => isObj(s) && RAW_REMOTE_ID.test(str(s.id) ?? ""));
    const hasStatus = data.some(
      (s) =>
        isObj(s) && (s.connection_status === "connected" || s.connection_status === "disconnected"),
    );
    if (!hasId || !hasStatus) return null;
  }
  return data.map((s) => mapRemoteSession(s)).filter((s): s is RemoteSession => s !== null);
}

/** One GET of the list; a body that is no session list any more is the error "unexpected response". */
export async function fetchRemoteSessions(
  token: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteResult> {
  const res = await getOAuthJson(
    REMOTE_SESSIONS_URL,
    token,
    version,
    { "anthropic-version": "2023-06-01" },
    fetchImpl,
  );
  if (res.kind !== "ok") return res;
  const sessions = parseRemoteSessions(res.json);
  return sessions ? { kind: "ok", sessions } : { kind: "error", message: UNEXPECTED_RESPONSE };
}
