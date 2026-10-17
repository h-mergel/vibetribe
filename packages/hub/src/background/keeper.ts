import type { Hub } from "../hub";
import {
  BACKGROUND_REFRESH_MS,
  parseBackgrounds,
  type SavedRecord,
  serializeBackgrounds,
} from "./records";

/** Port to the saved background jobs (%APPDATA%\vibetribe\background.json in the plugin). */
export interface BackgroundPorts {
  /** The saved text; null when there is none. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}

/** While writes keep failing (locked file, full disk), the next attempt waits at least this long. */
export const BACKGROUND_RETRY_MS = 30_000;

/** The job lists compared by content: a waiting record turning live keeps its jobs, so it is no change. */
const keyOf = (records: SavedRecord[]): string =>
  JSON.stringify(records.map(({ savedAt: _, ...r }) => r));

/**
 * Background jobs survive a restart. Restores the saved jobs before the first scan, then
 * writes the file on a hub change when the job lists changed, or every BACKGROUND_REFRESH_MS
 * while jobs run (so `savedAt` tells the next start how long the hub was gone). One write at a
 * time; a failed write is retried with a later change, at most every BACKGROUND_RETRY_MS (a clock
 * set back does not delay it). `canSave` (absent = always) gates every write. Nothing is written
 * while there never were any jobs. Failures are logged once; the hub runs on.
 */
export async function keepBackgrounds(o: {
  hub: Hub;
  ports: BackgroundPorts;
  now: () => number;
  log: (line: string) => void;
  canSave?: () => boolean;
}): Promise<void> {
  let written = keyOf([]);
  let savedAt = Number.NEGATIVE_INFINITY;
  try {
    const text = await o.ports.load();
    const file = text === null ? null : parseBackgrounds(text);
    if (file) {
      o.hub.restoreBackgrounds(file, o.now());
      // the file as the hub now holds it (expired jobs gone): equal means nothing to write
      written = keyOf(o.hub.backgrounds(o.now()));
      savedAt = file.savedAt;
    } else if (text !== null) o.log("background file ignored: unreadable content");
  } catch (err) {
    o.log(`background file unreadable: ${String(err)}`);
  }
  let writing = false;
  let failing = false;
  let failedAt = Number.NEGATIVE_INFINITY;
  o.hub.onChange(() => {
    // a change during a write is picked up by the next notify (the scans notify every few seconds)
    if (writing || o.canSave?.() === false) return;
    const now = o.now();
    const sinceFailure = now - failedAt;
    if (failing && sinceFailure >= 0 && sinceFailure < BACKGROUND_RETRY_MS) return;
    const records = o.hub.backgrounds(now);
    const changed = keyOf(records) !== written;
    const refresh = records.length > 0 && now - savedAt >= BACKGROUND_REFRESH_MS;
    if (!changed && !refresh) return;
    writing = true;
    o.ports
      .save(serializeBackgrounds({ savedAt: now, records }))
      .then(
        () => {
          written = keyOf(records);
          savedAt = now;
          if (failing) o.log("background file saved again");
          failing = false;
        },
        (err) => {
          if (!failing) o.log(`background file not saved: ${String(err)}`);
          failing = true;
          failedAt = now;
        },
      )
      .finally(() => {
        writing = false;
      });
  });
}
