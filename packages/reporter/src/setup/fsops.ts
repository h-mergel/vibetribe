import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

const pad = (n: number): string => String(n).padStart(2, "0");

export function timestamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Runs `write(tmp)`, then renames tmp over `target`. On any error the temp file is removed and the error rethrown. */
function viaTemp(target: string, write: (tmp: string) => void): void {
  const tmp = `${target}.vibetribe.tmp`;
  try {
    write(tmp);
    renameSync(tmp, target);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* not ours to remove (e.g. a directory); the original error matters */
    }
    throw err;
  }
}

/**
 * Durable atomic replace: the temp file sits next to the real file (a symlinked `path` stays a
 * symlink, its target is replaced), is fsynced, takes over the original's permissions and is
 * renamed over it. Running Claude Code sessions watch settings.json, so readers never see a
 * half-written file. `mode` applies to a file that does not exist yet (otherwise umask decides).
 */
export function writeFileAtomic(path: string, content: string, mode?: number): void {
  const real = existsSync(path) ? realpathSync(path) : path;
  mkdirSync(dirname(real), { recursive: true });
  const keep = existsSync(real) ? statSync(real).mode & 0o777 : mode;
  viaTemp(real, (tmp) => {
    const fd = openSync(tmp, "w", keep ?? 0o666);
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (keep !== undefined) chmodSync(tmp, keep);
  });
}

/** Atomic JSON write without backup; a file that already has this content is not touched. */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  const content = json(value);
  try {
    if (readFileSync(path, "utf8") === content) return;
  } catch {
    /* absent or unreadable: write it */
  }
  writeFileAtomic(path, content, mode);
}

/** Copies `src` over `dest` via a temp file, so a reader never sees a partial copy. */
export function copyFileAtomic(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  viaTemp(dest, (tmp) => copyFileSync(src, tmp));
}

/** Copies to `<path>.vibetribe-<timestamp>.bak`; two runs within one second get `-1`, `-2`, … and never overwrite a backup. */
function backupFile(path: string, now: Date): string {
  const base = `${path}.vibetribe-${timestamp(now)}`;
  for (let n = 0; ; n++) {
    const target = `${base}${n === 0 ? "" : `-${n}`}.bak`;
    try {
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/** Backs up an existing file (see `backupFile`), then replaces it atomically. */
export function writeJsonWithBackup(path: string, value: unknown, now: Date): string | null {
  const backup = existsSync(path) ? backupFile(path, now) : null;
  writeFileAtomic(path, json(value));
  return backup;
}
