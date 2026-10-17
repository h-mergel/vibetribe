import { type Envelope, PROTOCOL_VERSION } from "./envelope";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_STRING = 512;
export const MAX_TASKS = 100;

type Check = (v: unknown) => boolean;
export type Obj = Record<string, unknown>;

/** A JSON object: not null, not an array. */
export const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isString: Check = (v) => typeof v === "string" && v.length <= MAX_STRING;
const isNonEmpty: Check = (v) => isString(v) && (v as string).length > 0;
const isBool: Check = (v) => typeof v === "boolean";
const isOs: Check = (v) => v === "windows" || v === "wsl" || v === "mac";
const orNull =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);

/** Returns the first invalid field as "<path>.<key> is invalid", or null. */
function checkFields(value: unknown, path: string, spec: Record<string, Check>): string | null {
  if (!isObj(value)) return `${path} must be an object`;
  for (const [key, check] of Object.entries(spec)) {
    if (!check(value[key])) return `${path}.${key} is invalid`;
  }
  return null;
}

const isTasks: Check = (v) =>
  Array.isArray(v) &&
  v.length <= MAX_TASKS &&
  v.every((t) => checkFields(t, "task", { id: isNonEmpty, type: isNonEmpty }) === null);

const isWindow: Check = (v) =>
  checkFields(v, "window", { usedPct: isFiniteNumber, resetsAt: orNull(isFiniteNumber) }) === null;

const SOURCE = {
  host: isNonEmpty,
  os: isOs,
  distro: orNull(isNonEmpty),
  entrypoint: orNull(isNonEmpty),
};
const SESSION = {
  id: isNonEmpty,
  cwd: isString,
  pid: orNull(isFiniteNumber),
  hostSessionId: orNull(isNonEmpty),
};
const EVENT = {
  name: isNonEmpty,
  ts: isFiniteNumber,
  toolName: orNull(isNonEmpty),
  toolUseId: orNull(isNonEmpty),
  agentId: orNull(isNonEmpty),
  notificationType: orNull(isNonEmpty),
  errorType: orNull(isNonEmpty),
  reason: orNull(isNonEmpty),
  auto: orNull(isBool),
  backgroundTasks: orNull(isTasks),
};
const STATUSLINE = { ts: isFiniteNumber, fiveHour: orNull(isWindow), sevenDay: orNull(isWindow) };

const fail = (error: string): ParseResult<never> => ({ ok: false, error });

/** Validates untrusted JSON from the wire. Extra properties are ignored by consumers. */
export function parseEnvelope(raw: unknown): ParseResult<Envelope> {
  if (!isObj(raw)) return fail("envelope must be an object");
  if (raw.v !== PROTOCOL_VERSION) return fail("unsupported protocol version");
  if (raw.kind !== "hook" && raw.kind !== "statusline") return fail("unknown envelope kind");
  const common =
    checkFields(raw.source, "source", SOURCE) ?? checkFields(raw.session, "session", SESSION);
  if (common) return fail(common);
  const specific =
    raw.kind === "hook"
      ? checkFields(raw.event, "event", EVENT)
      : checkFields(raw, "statusline", STATUSLINE);
  if (specific) return fail(specific);
  return { ok: true, value: raw as unknown as Envelope };
}
