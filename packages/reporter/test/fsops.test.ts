import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFileAtomic, writeJsonWithBackup } from "../src/setup/fsops";

const posix = process.platform !== "win32";
const now = new Date(Date.UTC(2026, 9, 10, 18, 30, 5));
const tmp = () => mkdtempSync(join(tmpdir(), "vt-fsops-"));

describe("writeJsonWithBackup", () => {
  it("replaces the file, backs up the original and leaves no temp file", () => {
    const dir = tmp();
    const file = join(dir, "settings.json");
    writeFileSync(file, '{"a":1}');
    const backup = writeJsonWithBackup(file, { a: 2 }, now);
    expect(backup).toBe(`${file}.vibetribe-20261010183005.bak`);
    expect(readFileSync(backup as string, "utf8")).toBe('{"a":1}');
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 2 });
    expect(readdirSync(dir).sort()).toEqual([
      "settings.json",
      "settings.json.vibetribe-20261010183005.bak",
    ]);
  });

  it("returns null and writes the file when there was none", () => {
    const dir = tmp();
    const file = join(dir, "sub", "settings.json");
    expect(writeJsonWithBackup(file, { a: 1 }, now)).toBeNull();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 1 });
  });

  it.skipIf(!posix)("keeps a symlinked settings.json a symlink and updates its target", () => {
    const dir = tmp();
    const real = join(dir, "dotfiles", "settings.json");
    mkdirSync(join(dir, "dotfiles"));
    writeFileSync(real, '{"a":1}');
    const link = join(dir, "settings.json");
    symlinkSync(real, link);
    writeJsonWithBackup(link, { a: 2 }, now);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(real);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ a: 2 });
    // the temp file lives next to the real file, not next to the link
    expect(readdirSync(join(dir, "dotfiles"))).toEqual(["settings.json"]);
  });

  it.skipIf(!posix)("preserves the mode of the original", () => {
    const dir = tmp();
    const file = join(dir, "settings.json");
    writeFileSync(file, "{}");
    chmodSync(file, 0o640); // not what umask would produce for a new file
    writeJsonWithBackup(file, { a: 1 }, now);
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });
});

describe("writeFileAtomic failure", () => {
  it("keeps the original byte-identical when the temp path cannot be opened", () => {
    const dir = tmp();
    const file = join(dir, "settings.json");
    writeFileSync(file, "original\r\n");
    mkdirSync(`${file}.vibetribe.tmp`); // something we did not create blocks the temp path
    expect(() => writeFileAtomic(file, "new")).toThrow();
    expect(readFileSync(file, "utf8")).toBe("original\r\n");
    expect(statSync(`${file}.vibetribe.tmp`).isDirectory()).toBe(true);
  });

  it("removes its temp file when the final rename fails", () => {
    const dir = tmp();
    const target = join(dir, "settings.json");
    mkdirSync(target); // a directory cannot be replaced by a file
    expect(() => writeFileAtomic(target, "new")).toThrow();
    expect(existsSync(`${target}.vibetribe.tmp`)).toBe(false);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it("overwrites a stale temp file left by a crashed run", () => {
    const dir = tmp();
    const file = join(dir, "settings.json");
    writeFileSync(file, "old");
    writeFileSync(`${file}.vibetribe.tmp`, "stale");
    writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(existsSync(`${file}.vibetribe.tmp`)).toBe(false);
  });
});
