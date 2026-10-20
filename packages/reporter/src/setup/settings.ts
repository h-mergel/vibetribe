import { isObj, type Obj } from "@vibetribe/protocol";
import { type PreviousStatusline, statuslineFields } from "../config";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Elicitation",
  "ElicitationResult",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "SessionEnd",
] as const;

export interface ReporterCommand {
  /** absolute node path, forward slashes */
  node: string;
  /** absolute reporter path, forward slashes */
  reporter: string;
}

export type Settings = Record<string, unknown>;
type Group = Obj & { hooks: unknown[] };

/** Thrown when the user's settings.json has a shape these transforms would have to destroy to edit. */
export class SettingsShapeError extends Error {}

/** Own data property: a plain assignment would hit the __proto__ setter for that key instead. */
function setOwn(o: Obj, key: string, value: unknown): void {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Copies every own key, including a JSON-parsed `__proto__`. */
function copyOwn(o: Obj): Obj {
  const out: Obj = {};
  for (const [key, value] of Object.entries(o)) setOwn(out, key, value);
  return out;
}
const norm = (t: string) => t.replace(/\\/g, "/").toLowerCase();
/** args[0] of our hook entry is the reporter path itself */
const ARG_RE = /(^|\/)\.vibetribe\/reporter\.mjs$/;
/** our statusline command runs the reporter with the role `statusline`, quoted or not */
const STATUSLINE_RE = /(^|[\s"'/])\.vibetribe\/reporter\.mjs["']?\s+statusline(\s|$)/;

function isOurHookEntry(e: unknown): boolean {
  return (
    isObj(e) &&
    Array.isArray(e.args) &&
    typeof e.args[0] === "string" &&
    ARG_RE.test(norm(e.args[0]))
  );
}

export const isOurStatusline = (v: unknown): boolean =>
  isObj(v) && typeof v.command === "string" && STATUSLINE_RE.test(norm(v.command));

const hasOurs = (g: unknown): g is Group =>
  isObj(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHookEntry);
/** true when removing our entries leaves the group with no hooks, so the group itself goes */
const isEmptiedBy = (g: unknown): boolean => hasOurs(g) && g.hooks.every(isOurHookEntry);

/** the group with only our entries removed; a group that holds none of ours is returned as is */
function withoutOurs(g: unknown): unknown {
  if (!hasOurs(g)) return g;
  return { ...g, hooks: g.hooks.filter((e) => !isOurHookEntry(e)) };
}

function ourGroup(cmd: ReporterCommand, event: string): Obj {
  // timeout 2 s (spec §8.1): not enforced for async hooks; bounds the synchronous SessionEnd hook
  const hook: Obj = {
    type: "command",
    command: cmd.node,
    args: [cmd.reporter, "hook"],
    timeout: 2,
  };
  // SessionEnd stays synchronous: an async hook may be killed when the session exits
  if (event !== "SessionEnd") hook.async = true;
  return { hooks: [hook] };
}

/**
 * Our group goes where the first group that held one of our entries was, counted among the surviving
 * groups; it is appended when there was none. Foreign groups keep their order and their content.
 */
function placeOurs(groups: unknown[], ours: Obj): unknown[] {
  const out: unknown[] = [];
  let at: number | null = null;
  for (const g of groups) {
    if (at === null && hasOurs(g)) at = out.length;
    if (!isEmptiedBy(g)) out.push(withoutOurs(g));
  }
  out.splice(at ?? out.length, 0, ours);
  return out;
}

/** Throws SettingsShapeError if `hooks` or a HOOK_EVENTS value has a shape that editing would destroy. */
export function applyHooks(s: Settings, cmd: ReporterCommand): Settings {
  if (s.hooks !== undefined && !isObj(s.hooks))
    throw new SettingsShapeError("settings.hooks must be an object");
  const hooks = copyOwn(isObj(s.hooks) ? s.hooks : {});
  for (const event of HOOK_EVENTS) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event]))
      throw new SettingsShapeError(`settings.hooks.${event} must be an array`);
  }
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    setOwn(hooks, event, placeOurs(groups, ourGroup(cmd, event)));
  }
  return { ...s, hooks };
}

/**
 * The commands (node paths) of our hook entries; null unless every HOOK_EVENTS entry and the
 * statusline are ours.
 */
export function ourHookCommands(s: Settings): string[] | null {
  if (!isOurStatusline(s.statusLine) || !isObj(s.hooks)) return null;
  const commands = new Set<string>();
  for (const event of HOOK_EVENTS) {
    const groups = s.hooks[event];
    const entry = Array.isArray(groups)
      ? groups.flatMap((g) => (hasOurs(g) ? g.hooks.filter(isOurHookEntry) : []))[0]
      : undefined;
    if (!isObj(entry) || typeof entry.command !== "string") return null;
    commands.add(entry.command);
  }
  return [...commands];
}

/** Removes only our entries. Returns `s` itself when there is nothing of ours to remove. */
export function removeHooks(s: Settings): Settings {
  if (!isObj(s.hooks)) return s;
  const hooks: Obj = {};
  let changed = false;
  for (const [event, groups] of Object.entries(s.hooks)) {
    if (!Array.isArray(groups) || !groups.some(hasOurs)) {
      setOwn(hooks, event, groups);
      continue;
    }
    changed = true;
    const kept = groups.filter((g) => !isEmptiedBy(g)).map(withoutOurs);
    if (kept.length > 0) setOwn(hooks, event, kept);
  }
  if (!changed) return s;
  const { hooks: _old, ...rest } = s;
  return Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest;
}

export function statuslineCommand(cmd: ReporterCommand): string {
  return `"${cmd.node}" "${cmd.reporter}" statusline`;
}

/**
 * `previous` is the foreign statusline displaced by this call. null means nothing new was displaced
 * (none, or ours already in place); the caller then keeps the previous statusline it recorded.
 * Known limitation: unknown statusLine keys other than `command`, `padding` and `refreshInterval` are not preserved.
 * Throws SettingsShapeError when statusLine is present and not an object with a string `command`.
 */
export function applyStatusline(
  s: Settings,
  cmd: ReporterCommand,
): { settings: Settings; previous: PreviousStatusline | null } {
  const current = s.statusLine;
  const fields = statuslineFields(current);
  if (current !== undefined && fields === null)
    throw new SettingsShapeError("settings.statusLine must be an object with a string command");
  const next = { type: "command", ...fields, command: statuslineCommand(cmd) };
  return {
    settings: { ...s, statusLine: next },
    previous: isOurStatusline(current) ? null : fields,
  };
}

export function removeStatusline(s: Settings, previous: PreviousStatusline | null): Settings {
  if (!isOurStatusline(s.statusLine)) return s;
  const { statusLine: _ours, ...rest } = s;
  if (!previous) return rest;
  // `shell` is VibeTribe's own record of the Git Bash path, not a statusLine key Claude Code knows
  const { shell: _shell, ...restored } = previous;
  return { ...rest, statusLine: { type: "command", ...restored } };
}
