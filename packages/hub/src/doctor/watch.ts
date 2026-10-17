import { type CheckResult, codeOf } from "./check";

/** How often the hub checks the undocumented interfaces it reads itself. */
export const DRIFT_CHECK_MS = 3_600_000;

/**
 * Runs `check` now and every DRIFT_CHECK_MS for as long as `later` schedules, and logs changes
 * only: `drift: <name>: <detail>` when a check turns `changed`, `drift resolved: <name>` when it is
 * `ok` again. A `skipped` check (could not look) keeps what was logged before.
 */
export function watchDrift(o: {
  check: () => Promise<CheckResult[]>;
  log: (line: string) => void;
  later: (ms: number, fn: () => void) => unknown;
}): void {
  const drifted = new Set<string>();
  const run = async (): Promise<void> => {
    try {
      for (const r of await o.check()) {
        if (r.outcome === "changed" && !drifted.has(r.name)) {
          drifted.add(r.name);
          o.log(`drift: ${r.name}: ${r.detail}`);
        } else if (r.outcome === "ok" && drifted.delete(r.name)) {
          o.log(`drift resolved: ${r.name}`);
        }
      }
    } catch (err) {
      o.log(`drift check failed: ${codeOf(err)}`);
    }
    o.later(DRIFT_CHECK_MS, () => void run());
  };
  void run();
}
