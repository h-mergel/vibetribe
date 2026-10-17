import {
  type CheckResult,
  changed,
  type HubState,
  ok,
  parseSessionFile,
  pidFromFileName,
  type SessionFileText,
  skipped,
} from "@vibetribe/hub";
import { isObj } from "@vibetribe/protocol";

/** The `result` message of `claude -p --output-format stream-json`: how the turn ended, what it cost. */
export interface TurnResult {
  failed: boolean;
  subtype: string;
  costUsd: number | null;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number } | null;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(line);
    return isObj(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** null for every line that is not the result message. */
export function parseTurnResult(line: string): TurnResult | null {
  const raw = parseLine(line);
  if (raw?.type !== "result") return null;
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  const u = isObj(raw.usage) ? raw.usage : null;
  return {
    failed: raw.is_error === true,
    subtype: typeof raw.subtype === "string" ? raw.subtype : "unknown",
    costUsd: typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : null,
    tokens: u && {
      input: n(u.input_tokens),
      output: n(u.output_tokens),
      cacheWrite: n(u.cache_creation_input_tokens),
      cacheRead: n(u.cache_read_input_tokens),
    },
  };
}

export function formatCost(host: string, turn: TurnResult | null): string {
  if (turn?.costUsd == null) return `${host} cost: unknown`;
  const t = turn.tokens;
  const tokens = t
    ? ` (input ${t.input}, output ${t.output}, cache write ${t.cacheWrite}, cache read ${t.cacheRead} tokens)`
    : "";
  return `${host} cost: $${turn.costUsd.toFixed(4)}${tokens}`;
}

/** The hook events one turn of a print session must deliver to the hub. */
export const LIVE_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"] as const;

/** What one live run saw of its own session across many reads of the hub and the sessions folder. */
export class RunObserver {
  readonly #sessionId: string;
  /** the session's states in the hub, each change once */
  readonly states: string[] = [];
  readonly events = new Set<string>();
  #file: CheckResult | null = null;
  #init: { model: string; apiKeySource: string } | null = null;

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
  }

  /** One line of claude's stream-json output: the init message names the model and the key source. */
  sawLine(line: string): void {
    const raw = parseLine(line);
    if (raw?.type !== "system" || raw.subtype !== "init") return;
    const text = (v: unknown): string => (typeof v === "string" ? v : "unknown");
    this.#init = { model: text(raw.model), apiKeySource: text(raw.apiKeySource) };
  }

  /** true while the hub still lists the session */
  sawHub(state: HubState): boolean {
    for (const r of state.recent) if (r.sessionId === this.#sessionId) this.events.add(r.name);
    const s = state.sessions.find((v) => v.key.sessionId === this.#sessionId);
    if (s && this.states.at(-1) !== s.state) this.states.push(s.state);
    return s !== undefined;
  }

  /** One listing of the host's sessions folder: the session's own file, if it wrote one; a good read stays. */
  sawFiles(entries: readonly SessionFileText[], host: string): void {
    for (const e of entries) {
      if (this.#file?.outcome === "ok" || !e.text.includes(this.#sessionId)) continue;
      const file = parseSessionFile(e.text);
      const name = `${host} session file`;
      if (file === null || file.info.pid !== pidFromFileName(e.name))
        this.#file = changed(name, "the parser rejects it or it names another pid");
      else if (file.procStart === null) this.#file = changed(name, "no procStart");
      else
        this.#file = ok(
          name,
          `entrypoint ${file.info.entrypoint ?? "none"}, status ${file.info.status ?? "none"}`,
        );
    }
  }

  /** `exit`: claude's exit code, null while it still ran or was killed */
  verdict(
    host: string,
    run: { turn: TurnResult | null; exit: number | null; gone: boolean },
  ): CheckResult[] {
    const { turn, gone } = run;
    const missing = LIVE_EVENTS.filter((e) => !this.events.has(e));
    const states = this.states.join(" → ") || "none";
    const exit = `exit ${run.exit ?? "none"}`;
    const init = this.#init;
    return [
      turn === null
        ? changed(`${host} turn`, `claude sent no result (${exit})`)
        : turn.failed
          ? changed(`${host} turn`, `failed (${turn.subtype}, ${exit})`)
          : ok(`${host} turn`, turn.subtype),
      init === null
        ? changed(`${host} model`, "claude sent no init message")
        : /haiku/i.test(init.model) && init.apiKeySource === "none"
          ? ok(`${host} model`, `${init.model}, no API key`)
          : changed(`${host} model`, `${init.model}, API key source ${init.apiKeySource}`),
      missing.length > 0
        ? changed(`${host} hooks`, `never reached the hub: ${missing.join(", ")}`)
        : ok(`${host} hooks`, LIVE_EVENTS.join(", ")),
      this.states.includes("done_unseen")
        ? ok(`${host} deck`, states)
        : changed(`${host} deck`, `never done_unseen (states: ${states})`),
      this.#file ?? skipped(`${host} session file`, "print mode wrote none"),
      this.states.length === 0
        ? skipped(`${host} session end`, "never in the hub")
        : gone
          ? ok(`${host} session end`, "gone from the hub")
          : changed(`${host} session end`, "still in the hub after the session ended"),
    ];
  }
}
