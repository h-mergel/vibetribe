/** One line of a `fixtures/scenarios/*.jsonl` file: wait, then send the envelope. */
export interface ScenarioStep {
  delayMs: number;
  envelope: unknown;
}

/** Parses a scenario file; shared by the simulator (live hub) and the offline deck renderer. */
export function loadScenario(text: string): ScenarioStep[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const o = JSON.parse(line) as Partial<ScenarioStep>;
      if (typeof o.delayMs !== "number" || o.envelope === undefined)
        throw new Error(`scenario line ${i + 1}: need delayMs and envelope`);
      return { delayMs: o.delayMs, envelope: o.envelope };
    });
}
