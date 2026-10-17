/**
 * `pnpm profile:layout`: rearranges page 1 of the Stream Deck MK.2 profile (ProfilesV3) and moves
 * foreign keys with their images to page 2. Safety, in this order:
 *   1. everything is validated and the result previewed before anything is written;
 *   2. `--write` refuses while StreamDeck.exe runs, and when that cannot be checked unless
 *      `--i-checked-streamdeck-is-closed` is given (the flag never overrides a running app);
 *   3. both manifests are backed up (`manifest.json.vibetribe-<time>.bak`), images are copied,
 *      page 2 is written before page 1 (a failure leaves a duplicate, never a loss), each via a
 *      temp file and rename;
 *   4. both files are read back and compared; on any error the backups are restored.
 *
 * Usage (from WSL; the folder is %APPDATA%\Elgato\StreamDeck\ProfilesV3):
 *   pnpm profile:layout show /mnt/c/Users/<you>/AppData/Roaming/Elgato/StreamDeck/ProfilesV3
 *   pnpm profile:layout apply <ProfilesV3> <layout.json> [--write] [--i-checked-streamdeck-is-closed]
 */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { KeyRole } from "../src/deck/keys";
import { KEY_ROLES } from "../src/deck/keys";
import { ACTION_UUIDS } from "../src/ids";
import {
  actionsOf,
  applyLayout,
  checkPage,
  checkProfile,
  countKeys,
  describePage,
  isMk2Profile,
  isOurs,
  type PageManifest,
  parseLayout,
} from "./profile-layout";

export interface PageFiles {
  /** page folder, e.g. …/X.sdProfile/Profiles/22D2…; its manifest.json and Images/ */
  dir: string;
  page: PageManifest;
}

export interface ProfileInfo {
  dir: string;
  model: string;
  /** pages in the order of the profile manifest (Pages.Pages) */
  pages: PageFiles[];
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifestOf = (dir: string): string => join(dir, "manifest.json");
const hasOurs = (p: PageManifest): boolean => Object.values(actionsOf(p)).some(isOurs);

export interface ProfileScan {
  profiles: ProfileInfo[];
  /** MK.2 profiles left out because a page is missing or unreadable, each with the reason */
  skipped: string[];
}

/**
 * Every MK.2 profile below ProfilesV3 with its pages in order; other devices are left out
 * silently, an MK.2 profile with a broken page with its reason (it may be one the user does not
 * touch).
 */
export function readProfiles(root: string): ProfileScan {
  const profiles: ProfileInfo[] = [];
  const skipped: string[] = [];
  for (const name of readdirSync(root).filter((d) => d.endsWith(".sdProfile"))) {
    const dir = join(root, name);
    let raw: unknown;
    try {
      raw = readJson(manifestOf(dir));
    } catch {
      continue;
    }
    if (!isMk2Profile(raw)) continue;
    try {
      const info = checkProfile(raw, name);
      const folders = existsSync(join(dir, "Profiles")) ? readdirSync(join(dir, "Profiles")) : [];
      const pages = info.pages.map((id) => {
        // the manifest lists page ids in lower case, the folders are upper case
        const folder = folders.find((f) => f.toLowerCase() === id.toLowerCase());
        if (!folder) throw new Error(`${name}: page ${id} has no folder`);
        const pageDir = join(dir, "Profiles", folder);
        return {
          dir: pageDir,
          page: checkPage(readJson(manifestOf(pageDir)), `${name} page ${id}`),
        };
      });
      profiles.push({ dir, model: info.model, pages });
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { profiles, skipped };
}

/**
 * Page 1 (the first page, holding our keys) and page 2 of the one profile that has our keys, plus
 * the MK.2 profiles that could not be read (one of them might hold our keys as well).
 */
export function locatePages(root: string): {
  page1: PageFiles;
  page2: PageFiles;
  skipped: string[];
} {
  const { profiles, skipped } = readProfiles(root);
  const ours = profiles.filter((p) => p.pages.some((pg) => hasOurs(pg.page)));
  if (ours.length !== 1)
    throw new Error(
      `expected one MK.2 profile with VibeTribe keys, found ${ours.length}${skipped.length ? ` (skipped: ${skipped.join("; ")})` : ""}`,
    );
  const [page1, page2] = ours[0]?.pages ?? [];
  if (!page1 || !hasOurs(page1.page))
    throw new Error("the VibeTribe keys are not on the first page");
  if (!page2) throw new Error("the profile has no second page");
  if (page1.dir === page2.dir) throw new Error("page 1 and page 2 are the same folder");
  return { page1, page2, skipped };
}

/* ---------- durable file operations ---------- */

const pad = (n: number): string => String(n).padStart(2, "0");
export const stamp = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

/** Temp file next to the target, fsync, rename over it; the temp file never survives an error. */
export function writeAtomic(path: string, content: string | Buffer): void {
  const tmp = `${path}.vibetribe.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, typeof content === "string" ? Buffer.from(content, "utf8") : content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** `<path>.vibetribe-<time>.bak`, never overwriting an older backup. */
export function backup(path: string, now: Date): string {
  for (let n = 0; ; n++) {
    const target = `${path}.vibetribe-${stamp(now)}${n ? `-${n}` : ""}.bak`;
    try {
      copyFileSync(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/** true: StreamDeck.exe runs; false: it does not; null: cannot tell (no Windows interop). */
export function streamDeckRunning(): boolean | null {
  const r = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq StreamDeck.exe", "/NH"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (r.error || r.status !== 0) return null;
  return parseTasklist(r.stdout);
}

/**
 * tasklist prints a row naming the exe, or an "INFO: …" / "INFORMATION: …" line (English /
 * German text) as the first non-empty line when nothing matches.
 * Anything else, empty or garbled output included, means we cannot tell.
 */
export function parseTasklist(stdout: string): boolean | null {
  if (/StreamDeck\.exe/i.test(stdout)) return true;
  const first = stdout.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  if (/^INFO(RMATION)?:/i.test(first.trim())) return false;
  return null;
}

export interface Deps {
  streamDeckRunning: () => boolean | null;
  now: () => Date;
  print: (line: string) => void;
  /** the atomic write of manifests and of their restore; a seam for tests (failures) */
  write?: (path: string, content: string | Buffer) => void;
}

function actionNames(): Record<KeyRole, string> {
  const manifest = readJson(
    fileURLToPath(new URL("../dev.h2k.vibetribe.sdPlugin/manifest.json", import.meta.url)),
  ) as { Actions: { UUID: string; Name: string }[] };
  const names = {} as Record<KeyRole, string>;
  for (const role of KEY_ROLES)
    names[role] = manifest.Actions.find((a) => a.UUID === ACTION_UUIDS[role])?.Name ?? role;
  return names;
}

function show(root: string, print: (line: string) => void): void {
  const { profiles, skipped } = readProfiles(root);
  for (const profile of profiles) {
    print(`${profile.dir}  model ${profile.model}`);
    profile.pages.forEach((p, i) => {
      print(`  page ${i + 1}  ${p.dir}${hasOurs(p.page) ? "  <- VibeTribe" : ""}`);
      for (const line of describePage(p.page)) print(`    ${line}`);
    });
  }
  for (const reason of skipped) print(`skipped: ${reason}`);
}

/** Images of the moved keys: page 1 must have them; page 2 may only have identical copies. */
function imagePlan(names: string[], from: string, to: string): string[] {
  const copies: string[] = [];
  for (const name of names) {
    const src = join(from, "Images", name);
    const dst = join(to, "Images", name);
    if (!existsSync(src)) throw new Error(`image ${name} is missing on page 1`);
    if (existsSync(dst)) {
      if (!readFileSync(src).equals(readFileSync(dst)))
        throw new Error(`image ${name} exists on page 2 with other content`);
      continue;
    }
    copies.push(name);
  }
  return copies;
}

/** A symlinked manifest or Images folder could send a write outside the profile. */
function refuseSymlink(path: string): void {
  try {
    if (!lstatSync(path).isSymbolicLink()) return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  throw new Error(`${path} is a symlink`);
}

/**
 * The manifests are written back from parsed JSON, which rounds numbers beyond 2^53. Refuse a
 * manifest with a number literal of 16 or more digits outside strings (strings stay intact).
 */
function refuseRoundedNumbers(path: string, name: string): void {
  const outsideStrings = readFileSync(path, "utf8").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (/\d{16,}/.test(outsideStrings))
    throw new Error(
      `${name} (${path}) holds an integer of 16 or more digits that JSON would round; not safe to rewrite`,
    );
}

function apply(argv: string[], deps: Deps): void {
  const [root, layoutFile] = argv;
  if (!root || !layoutFile) throw new Error("usage: apply <ProfilesV3> <layout.json> [--write]");
  const { page1, page2, skipped } = locatePages(root);
  for (const reason of skipped) deps.print(`skipped: ${reason}`);
  for (const dir of [page1.dir, page2.dir])
    for (const path of [manifestOf(dir), join(dir, "Images")]) refuseSymlink(path);
  refuseRoundedNumbers(manifestOf(page1.dir), "page 1");
  refuseRoundedNumbers(manifestOf(page2.dir), "page 2");
  const layout = parseLayout(readJson(layoutFile));
  const result = applyLayout(page1.page, page2.page, layout, actionNames());
  const copies = imagePlan(result.images, page1.dir, page2.dir);
  deps.print(`page 1  ${page1.dir}`);
  for (const line of describePage(result.page1)) deps.print(`  ${line}`);
  deps.print(`page 2  ${page2.dir}`);
  for (const line of describePage(result.page2)) deps.print(`  ${line}`);
  deps.print(`images to copy to page 2: ${copies.join(" ") || "none"}`);
  if (!argv.includes("--write")) {
    deps.print("dry run: nothing written (add --write)");
    return;
  }
  if (skipped.length)
    throw new Error(
      `${skipped.length} MK.2 profile(s) could not be read (${skipped.join("; ")}); fix or remove them first`,
    );
  const running = deps.streamDeckRunning();
  if (running === true)
    throw new Error("Stream Deck is running: quit it first (it rewrites profiles on exit)");
  if (running === null && !argv.includes("--i-checked-streamdeck-is-closed"))
    throw new Error(
      "cannot check whether Stream Deck runs; close it and add --i-checked-streamdeck-is-closed",
    );
  const write = deps.write ?? writeAtomic;
  const p1 = manifestOf(page1.dir);
  const p2 = manifestOf(page2.dir);
  const before = countKeys(page1.page) + countKeys(page2.page);
  const bak1 = backup(p1, deps.now());
  const bak2 = backup(p2, deps.now());
  // Restore: page 1 first, then page 2, so that if the second write fails or the process dies
  // between them, the moved keys are on both pages (a duplicate), never on none. Afterwards both
  // files are compared with the backups.
  // (Images copied before a failure stay on page 2: unused files, harmless.)
  const restore = (): void => {
    write(p1, readFileSync(bak1));
    write(p2, readFileSync(bak2));
    for (const [path, bak] of [
      [p1, bak1],
      [p2, bak2],
    ] as const)
      if (!readFileSync(path).equals(readFileSync(bak)))
        throw new Error(`${path} differs from the backup ${bak} after the restore`);
  };
  mkdirSync(join(page2.dir, "Images"), { recursive: true });
  for (const name of copies)
    writeAtomic(join(page2.dir, "Images", name), readFileSync(join(page1.dir, "Images", name)));
  try {
    // Write: page 2 first, then page 1: a failure in between leaves the moved keys on both
    // pages, never on none. Then both files are read back and compared.
    write(p2, JSON.stringify(result.page2));
    write(p1, JSON.stringify(result.page1));
    const back1 = checkPage(readJson(p1), "page 1");
    const back2 = checkPage(readJson(p2), "page 2");
    const same =
      JSON.stringify(back1) === JSON.stringify(result.page1) &&
      JSON.stringify(back2) === JSON.stringify(result.page2);
    if (!same || countKeys(back1) + countKeys(back2) !== before + result.created)
      throw new Error("read-back differs from what was written");
  } catch (err) {
    try {
      restore();
    } catch (again) {
      throw new Error(
        `write failed: ${String(err)}; restore failed too: ${String(again)}; copy the backups back by hand: ${bak1} -> ${p1}, ${bak2} -> ${p2}`,
      );
    }
    throw new Error(`write failed, both pages restored from the backups: ${String(err)}`);
  }
  deps.print(`written; backups: ${bak1} ${bak2}`);
}

/** The CLI without process globals; returns the exit code. */
export function run(argv: string[], deps: Deps): number {
  try {
    const [cmd, ...rest] = argv;
    if (cmd === "show" && rest[0]) show(rest[0], deps.print);
    else if (cmd === "apply") apply(rest, deps);
    else
      throw new Error(
        "usage: profile:layout show <ProfilesV3> | apply <ProfilesV3> <layout.json> [--write]",
      );
    return 0;
  } catch (err) {
    deps.print(`refused: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // a closed pipe (… | head) is no error
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
  });
  process.exitCode = run(process.argv.slice(2), {
    streamDeckRunning,
    now: () => new Date(),
    print: (line) => process.stdout.write(`${line}\n`),
  });
}
