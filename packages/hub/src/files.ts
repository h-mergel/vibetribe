import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Replaces `path` through `<path>.tmp` (written, fsynced, renamed over it), so neither a reader nor
 * a crash ever sees a half-written file. Creates the folder. A failed write removes its temp file
 * and rethrows; the old file stays as it was.
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    const file = await open(tmp, "w");
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(tmp, path);
  } catch (err) {
    // best effort: a temp path we cannot remove (e.g. a folder) must not hide the original error
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
