import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Deps, locatePages, parseTasklist, readProfiles, run } from "../scripts/profile-files";
import { actionsOf, describePage, type PageManifest } from "../scripts/profile-layout";
import { foreign, MISCHFORM, PAGE1_ID, PAGE2_ID, page, writeProfile } from "./profile-fixture";

/**
 * Everything runs in a scratch folder with a synthetic ProfilesV3 tree (profile-fixture.ts):
 * the real %APPDATA%\Elgato and the real Stream Deck are never involved.
 */
let root = "";
let dirs = { profile: "", page1: "", page2: "" };
let layout = "";
let lines: string[] = [];

const deps = (over: Partial<Deps> = {}): Deps => ({
  streamDeckRunning: () => false,
  now: () => new Date(Date.UTC(2026, 9, 14, 12, 0, 0)),
  print: (l) => lines.push(l),
  ...over,
});
const manifest = (dir: string) => join(dir, "manifest.json");
const read = (dir: string): PageManifest => JSON.parse(readFileSync(manifest(dir), "utf8"));
const snapshot = () =>
  [dirs.page1, dirs.page2].map((d) => [
    readFileSync(manifest(d), "utf8"),
    readdirSync(d).join(","),
    existsSync(join(d, "Images")) ? readdirSync(join(d, "Images")).join(",") : "",
  ]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vt-profiles-"));
  dirs = writeProfile(root);
  layout = join(root, "layout.json");
  writeFileSync(layout, JSON.stringify(MISCHFORM));
  lines = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readProfiles and locatePages", () => {
  it("follow the page order of the profile manifest (lower-case ids, upper-case folders)", () => {
    const [profile] = readProfiles(root).profiles;
    expect(profile?.model).toBe("20GBL9901");
    expect(profile?.pages.map((p) => p.dir)).toEqual([dirs.page1, dirs.page2]);
    expect(locatePages(root)).toMatchObject({
      page1: { dir: dirs.page1 },
      page2: { dir: dirs.page2 },
    });
  });

  it("skip profiles of other devices", () => {
    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "vt-profiles-"));
    writeProfile(root, { model: "20GAT9901" });
    expect(readProfiles(root)).toEqual({ profiles: [], skipped: [] });
    expect(() => locatePages(root)).toThrow(/found 0/);
  });

  it("an unrelated MK.2 profile with a broken page is skipped, not fatal", () => {
    const other = join(root, "OTHER.sdProfile");
    mkdirSync(other);
    writeFileSync(
      join(other, "manifest.json"),
      JSON.stringify({ Device: { Model: "20GBL9901" }, Pages: { Pages: ["bbbb"] } }),
    );
    expect(locatePages(root)).toMatchObject({ page1: { dir: dirs.page1 } });
    expect(run(["show", root], deps())).toBe(0);
    expect(lines.at(-1)).toBe("skipped: OTHER.sdProfile: page bbbb has no folder");
  });

  it("an MK.2 profile without a page list is skipped with its reason", () => {
    const other = join(root, "OTHER.sdProfile");
    mkdirSync(other);
    writeFileSync(join(other, "manifest.json"), JSON.stringify({ Device: { Model: "20GBL9901" } }));
    expect(readProfiles(root).skipped).toEqual(["OTHER.sdProfile: no page list (Pages.Pages)"]);
    expect(run(["show", root], deps())).toBe(0);
    expect(lines.at(-1)).toBe("skipped: OTHER.sdProfile: no page list (Pages.Pages)");
  });

  it("refuse when our keys are not on the first page, page 2 is missing or listed twice", () => {
    for (const [pages, message] of [
      [[PAGE2_ID, PAGE1_ID], /not on the first page/],
      [[PAGE1_ID], /no second page/],
      [[PAGE1_ID, PAGE1_ID], /same folder/],
    ] as const) {
      rmSync(root, { recursive: true, force: true });
      root = mkdtempSync(join(tmpdir(), "vt-profiles-"));
      writeProfile(root, { pages: [...pages] });
      expect(() => locatePages(root)).toThrow(message);
    }
  });
});

describe("parseTasklist", () => {
  it("says running, not running, or cannot tell", () => {
    expect(parseTasklist('"StreamDeck.exe","1234","Console","1","90,000 K"\r\n')).toBe(true);
    expect(
      parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n"),
    ).toBe(false);
    expect(
      parseTasklist(
        "\r\nINFORMATION: Es werden keine Aufgaben mit den angegebenen Kriterien ausgeführt.\r\n",
      ),
    ).toBe(false);
    // the table form of tasklist.exe, header line first
    expect(
      parseTasklist(
        "Abbildname                     PID Sitzungsname       Sitz.-Nr.  Speichernutzung\r\n" +
          "========================= ======== ================ =========== ===============\r\n" +
          "StreamDeck.exe               37364 RDP-Tcp#0                  1        77.924 K\r\n",
      ),
    ).toBe(true);
    expect(parseTasklist("")).toBeNull();
    expect(parseTasklist("garbled \u0000 output")).toBeNull();
  });
});

describe("profile:layout show", () => {
  it("prints model, pages in order and marks the VibeTribe page", () => {
    expect(run(["show", root], deps())).toBe(0);
    expect(lines[0]).toMatch(/model 20GBL9901$/);
    expect(lines[1]).toMatch(new RegExp(`page 1 .*${PAGE1_ID.toUpperCase()} {2}<- VibeTribe$`));
    expect(lines.some((l) => /page 2 .*000000000002$/.test(l))).toBe(true);
  });
});

describe("profile:layout apply", () => {
  // a copy of our profile that lost its second page: unreadable, but it carries our keys too
  const brokenCopy = (): void => {
    const copy = join(root, "COPY.sdProfile");
    cpSync(dirs.profile, copy, { recursive: true });
    rmSync(join(copy, "Profiles", PAGE2_ID.toUpperCase()), { recursive: true, force: true });
  };

  it("dry run names a skipped MK.2 profile before the plan", () => {
    brokenCopy();
    expect(run(["apply", root, layout], deps())).toBe(0);
    expect(lines[0]).toMatch(/^skipped: COPY\.sdProfile: page .* has no folder$/);
    expect(lines[1]).toMatch(/^page 1 /);
  });

  it("--write refuses while an MK.2 profile could not be read, and writes nothing", () => {
    brokenCopy();
    const before = snapshot();
    expect(run(["apply", root, layout, "--write"], deps())).toBe(1);
    expect(lines[0]).toMatch(/^skipped: COPY\.sdProfile: /);
    expect(lines.at(-1)).toMatch(
      /refused: 1 MK\.2 profile\(s\) could not be read \(COPY\.sdProfile: .*\); fix or remove them first/,
    );
    expect(snapshot()).toEqual(before);
  });

  it("dry run: previews pages and images, writes nothing", () => {
    const before = snapshot();
    expect(run(["apply", root, layout], deps())).toBe(0);
    expect(lines).toContain("images to copy to page 2: MEDIA1.png MEDIA2.png MEDIA3.png");
    expect(lines.at(-1)).toBe("dry run: nothing written (add --write)");
    expect(snapshot()).toEqual(before);
  });

  it("--write: copies the images, writes both pages, keeps backups and leaves no temp file", () => {
    const old1 = readFileSync(manifest(dirs.page1), "utf8");
    const old2 = readFileSync(manifest(dirs.page2), "utf8");
    expect(run(["apply", root, layout, "--write"], deps())).toBe(0);
    expect(lines.at(-1)).toMatch(/^written; backups: /);
    const p1 = read(dirs.page1);
    const p2 = read(dirs.page2);
    expect(describePage(p1)[5]).toBe("0,1  dev.h2k.vibetribe.extra  Extra Usage");
    expect(actionsOf(p1)["0,2"]).toEqual(foreign("spotify"));
    expect(actionsOf(p2)["1,0"]).toEqual(foreign("media1"));
    for (const n of ["MEDIA1", "MEDIA2", "MEDIA3"])
      expect(readFileSync(join(dirs.page2, "Images", `${n}.png`), "utf8")).toBe(
        readFileSync(join(dirs.page1, "Images", `${n}.png`), "utf8"),
      );
    const bak = (d: string) => readdirSync(d).find((f) => f.endsWith(".bak")) ?? "";
    expect(bak(dirs.page1)).toBe("manifest.json.vibetribe-20261014120000.bak");
    expect(readFileSync(join(dirs.page1, bak(dirs.page1)), "utf8")).toBe(old1);
    expect(readFileSync(join(dirs.page2, bak(dirs.page2)), "utf8")).toBe(old2);
    for (const d of [dirs.page1, dirs.page2])
      expect(readdirSync(d).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("--write refuses while Stream Deck runs or when that cannot be checked", () => {
    const before = snapshot();
    expect(run(["apply", root, layout, "--write"], deps({ streamDeckRunning: () => true }))).toBe(
      1,
    );
    expect(lines.at(-1)).toMatch(/refused: Stream Deck is running/);
    expect(run(["apply", root, layout, "--write"], deps({ streamDeckRunning: () => null }))).toBe(
      1,
    );
    expect(lines.at(-1)).toMatch(/cannot check/);
    expect(snapshot()).toEqual(before);
    // the flag only stands in for an impossible check, never for a running app
    const flag = ["apply", root, layout, "--write", "--i-checked-streamdeck-is-closed"];
    expect(run(flag, deps({ streamDeckRunning: () => true }))).toBe(1);
    expect(lines.at(-1)).toMatch(/Stream Deck is running/);
    expect(snapshot()).toEqual(before);
    expect(run(flag, deps({ streamDeckRunning: () => null }))).toBe(0);
  });

  it("refuses on an image name that page 2 already uses for other content, accepts an identical one", () => {
    writeFileSync(join(dirs.page2, "Images", "MEDIA1.png"), "other");
    const before = snapshot();
    expect(run(["apply", root, layout, "--write"], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/MEDIA1.png exists on page 2 with other content/);
    expect(snapshot()).toEqual(before);
    writeFileSync(join(dirs.page2, "Images", "MEDIA1.png"), JSON.stringify("png-MEDIA1"));
    expect(run(["apply", root, layout], deps())).toBe(0);
    expect(lines).toContain("images to copy to page 2: MEDIA2.png MEDIA3.png");
  });

  it("refuses when a moved key's image is missing on page 1", () => {
    rmSync(join(dirs.page1, "Images", "MEDIA2.png"));
    expect(run(["apply", root, layout], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/MEDIA2.png is missing on page 1/);
  });

  it("writes page 2 first and restores both pages when writing page 1 fails", () => {
    const before = snapshot().map(([m]) => m);
    const order: string[] = [];
    const write = (path: string, content: string | Buffer) => {
      order.push(path);
      // the first write of page 1 fails; the restore afterwards succeeds
      if (path === manifest(dirs.page1) && order.length === 2) throw new Error("disk full");
      writeFileSync(path, content);
    };
    expect(run(["apply", root, layout, "--write"], deps({ write }))).toBe(1);
    expect(order.slice(0, 2)).toEqual([manifest(dirs.page2), manifest(dirs.page1)]);
    expect(lines.at(-1)).toMatch(/write failed, both pages restored.*disk full/);
    expect(snapshot().map(([m]) => m)).toEqual(before);
  });

  it("names the original error and the backups when the restore fails too", () => {
    const write = (path: string, content: string | Buffer) => {
      if (path === manifest(dirs.page1)) throw new Error("disk full");
      writeFileSync(path, content);
    };
    expect(run(["apply", root, layout, "--write"], deps({ write }))).toBe(1);
    const last = lines.at(-1) ?? "";
    expect(last).toMatch(/write failed: Error: disk full; restore failed too: Error: disk full/);
    expect(last).toContain(`manifest.json.vibetribe-20261014120000.bak -> ${manifest(dirs.page1)}`);
  });

  it("restores page 1 before page 2, so a failing restore leaves a duplicate, never a loss", () => {
    const calls: string[] = [];
    const write = (path: string, content: string | Buffer) => {
      calls.push(path);
      // the write of page 1 (2nd call) fails, and so does the restore of page 2 (4th call)
      if (calls.length === 2 || calls.length === 4) throw new Error("disk full");
      writeFileSync(path, content);
    };
    expect(run(["apply", root, layout, "--write"], deps({ write }))).toBe(1);
    expect(calls[2]).toBe(manifest(dirs.page1));
    expect(calls[3]).toBe(manifest(dirs.page2));
    const names = [dirs.page1, dirs.page2].flatMap((d) =>
      Object.values(actionsOf(read(d))).map((e) => e.Name),
    );
    for (const n of ["media1", "media2", "media3", "spotify", "mic", "next", "apps", "back"])
      expect(names).toContain(n);
  });

  it("reports a restore that does not match the backups, naming them", () => {
    // every write of page 1 lands wrong: the restore cannot repair it
    const write = (path: string, content: string | Buffer) =>
      writeFileSync(path, path === manifest(dirs.page1) ? JSON.stringify(page({})) : content);
    expect(run(["apply", root, layout, "--write"], deps({ write }))).toBe(1);
    const last = lines.at(-1) ?? "";
    expect(last).toMatch(/restore failed too: .*differs from the backup/);
    expect(last).toContain(`manifest.json.vibetribe-20261014120000.bak -> ${manifest(dirs.page1)}`);
  });

  it("refuses a manifest with an integer JSON would round, but not one inside a string", () => {
    const before = snapshot();
    const text = readFileSync(manifest(dirs.page1), "utf8");
    writeFileSync(
      manifest(dirs.page1),
      text.replace('"secret":"apps"', '"secret":"12345678901234567890","n":1234567890123456789'),
    );
    expect(run(["apply", root, layout], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/page 1 .*integer of 16 or more digits/);
    expect(snapshot()[1]).toEqual(before[1]);
    writeFileSync(
      manifest(dirs.page1),
      text.replace('"secret":"apps"', '"secret":"12345678901234567890"'),
    );
    expect(run(["apply", root, layout], deps())).toBe(0);
  });

  it("refuses a symlinked manifest or Images folder", () => {
    const before = snapshot();
    const aside = join(root, "aside");
    writeFileSync(aside, readFileSync(manifest(dirs.page2)));
    rmSync(manifest(dirs.page2));
    symlinkSync(aside, manifest(dirs.page2));
    expect(run(["apply", root, layout], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/is a symlink/);
    rmSync(manifest(dirs.page2));
    writeFileSync(manifest(dirs.page2), readFileSync(aside));
    renameSync(join(dirs.page2, "Images"), join(root, "images-aside"));
    symlinkSync(join(root, "images-aside"), join(dirs.page2, "Images"));
    expect(run(["apply", root, layout, "--write"], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/Images is a symlink/);
    expect(snapshot()[0]).toEqual(before[0]);
  });

  it("restores both pages when the read-back differs", () => {
    const before = snapshot().map(([m]) => m);
    let first = true;
    const write = (path: string, content: string | Buffer) => {
      // the new page 1 is written wrong once; the restore writes it right
      const wrong = path === manifest(dirs.page1) && first;
      if (wrong) first = false;
      writeFileSync(path, wrong ? JSON.stringify(page({})) : content);
    };
    expect(run(["apply", root, layout, "--write"], deps({ write }))).toBe(1);
    expect(lines.at(-1)).toMatch(/read-back differs/);
    expect(snapshot().map(([m]) => m)).toEqual(before);
  });

  it("refuses an unknown role before touching anything", () => {
    writeFileSync(layout, JSON.stringify({ page1: { "0,0": { role: "extraa" } }, toPage2: [] }));
    const before = snapshot();
    expect(run(["apply", root, layout, "--write"], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/refused: layout: 0,0 must be/);
    expect(snapshot()).toEqual(before);
  });

  it("answers usage errors with exit code 1", () => {
    expect(run(["nope"], deps())).toBe(1);
    expect(lines.at(-1)).toMatch(/usage/);
  });
});
