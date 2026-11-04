import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { bundledProfileEntries, writeBundledProfile, zip } from "../scripts/bundled-profile";
import { checkPage, checkProfile, describePage, MK2_MODEL } from "../scripts/profile-layout";
import { KEY_ROLES } from "../src/deck/keys";
import {
  ACTION_UUIDS,
  BUNDLED_PROFILE,
  BUNDLED_PROFILE_DEVICE_TYPE,
  PLUGIN_UUID,
} from "../src/ids";
import { NAMES } from "./profile-fixture";

const MANIFEST = {
  Version: "2.3.4.5",
  Name: "VibeTribe",
  Actions: KEY_ROLES.map((role) => ({ UUID: ACTION_UUIDS[role], Name: NAMES[role] })),
};

/** Reads a ZIP through its central directory, the way an unpacker does. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, data);
    at += 46 + nameLength;
  }
  return out;
}

const entries = bundledProfileEntries(MANIFEST);
const json = (name: string): unknown => {
  const e = entries.find((x) => x.name === name);
  if (!e) throw new Error(`no ${name}`);
  return JSON.parse(e.data?.toString("utf8") ?? "");
};
const files = entries.filter((e) => e.data).map((e) => e.name);
const profileManifest = files.find((f) => /^Profiles\/[^/]+\.sdProfile\/manifest\.json$/.test(f));
const profileRoot = profileManifest?.replace("/manifest.json", "") ?? "";
const profile = json(profileManifest ?? "") as {
  Name: string;
  Device: { Model: string; UUID: string };
  Pages: { Current: string; Default: string; Pages: string[] };
  Version: string;
};
const pageOf = (id: string) => json(`${profileRoot}/Profiles/${id.toUpperCase()}/manifest.json`);
const content = checkPage(pageOf(profile.Pages.Pages[0] ?? ""), "content");

describe("bundled profile", () => {
  it("has the layout of an exported profile: package.json, one profile, two page folders", () => {
    expect(json("package.json")).toMatchObject({
      DeviceModel: MK2_MODEL,
      DeviceSettings: null,
      FormatVersion: 1,
      RequiredPlugins: [PLUGIN_UUID],
    });
    expect(profile.Version).toBe("3.0");
    expect(profile.Name).toBe("VibeTribe");
    expect(checkProfile(profile, "profile").model).toBe(MK2_MODEL);
    expect(profile.Pages.Current).toBe("00000000-0000-0000-0000-000000000000");
    expect(profile.Pages.Pages).toHaveLength(1);
    expect(profile.Pages.Default).not.toBe(profile.Pages.Pages[0]);
    expect(profileRoot).toMatch(/^Profiles\/[0-9A-F-]{36}\.sdProfile$/);
    expect(pageOf(profile.Pages.Default)).toEqual({
      Controllers: [{ Actions: null, Type: "Keypad" }],
      Icon: "",
      Name: "",
    });
  });

  it("shows only VibeTribe keys: the back key top left, then the overview, nine slots", () => {
    expect(describePage(content)).toEqual([
      `0,0  ${ACTION_UUIDS.home}  VibeTribe`,
      `1,0  ${ACTION_UUIDS.inbox}  Inbox`,
      `2,0  ${ACTION_UUIDS.limit5h}  5h limit`,
      `3,0  ${ACTION_UUIDS.limitWeek}  Weekly limit`,
      `4,0  ${ACTION_UUIDS.extra}  Extra Usage`,
      `0,1  ${ACTION_UUIDS.status}  Status`,
      ...["1,1", "2,1", "3,1", "4,1", "0,2", "1,2", "2,2", "3,2", "4,2"].map(
        (p) => `${p}  ${ACTION_UUIDS.slot}  Session slot`,
      ),
    ]);
  });

  it("only the back key carries the back setting; every key names the plugin and has its own id", () => {
    const actions = Object.entries(content.Controllers[0]?.Actions ?? {});
    for (const [place, e] of actions) {
      expect(e.Settings).toEqual(place === "0,0" ? { back: true } : {});
      expect(e.Plugin).toEqual({ Name: "VibeTribe", UUID: PLUGIN_UUID, Version: "2.3.4.5" });
      expect(e.States).toEqual([{}]);
    }
    expect(new Set(actions.map(([, e]) => e.ActionID)).size).toBe(15);
  });

  it("the same input gives the same bytes", () => {
    expect(zip(bundledProfileEntries(MANIFEST)).equals(zip(entries))).toBe(true);
  });

  it("a key whose action is not in the manifest stops the build", () => {
    expect(() => bundledProfileEntries({ ...MANIFEST, Actions: [] })).toThrow(ACTION_UUIDS.home);
  });

  it("writes one archive named after the manifest entry that an unpacker reads back", () => {
    const dir = mkdtempSync(join(tmpdir(), "vt-profile-"));
    try {
      const written = writeBundledProfile(dir, MANIFEST);
      expect(written).toBe(join(dir, `${BUNDLED_PROFILE}.streamDeckProfile`));
      const back = unzip(readFileSync(written));
      expect([...back.keys()]).toEqual(entries.map((e) => e.name));
      for (const e of entries)
        expect(back.get(e.name)?.equals(e.data ?? Buffer.alloc(0))).toBe(true);
      expect(entries.filter((e) => !e.data).every((e) => e.name.endsWith("/"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("bundled profile entry", () => {
  const dir = fileURLToPath(new URL(`../${PLUGIN_UUID}.sdPlugin`, import.meta.url));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    Profiles: unknown[];
  };

  it("names the file the build writes, for the device the code checks; installs and switches only on a press", () => {
    expect(manifest.Profiles).toEqual([
      {
        Name: BUNDLED_PROFILE,
        DeviceType: BUNDLED_PROFILE_DEVICE_TYPE,
        Readonly: false,
        DontAutoSwitchWhenInstalled: true,
        AutoInstall: false,
      },
    ]);
  });

  it("the package keeps it: .sdignore does not name it", () => {
    expect(readFileSync(join(dir, ".sdignore"), "utf8")).not.toMatch(/profile|\*/i);
  });

  it("the category and action icons are the monochrome circle on transparent", () => {
    for (const name of ["imgs/plugin/category.svg", "imgs/actions/home.svg"]) {
      const svg = readFileSync(join(dir, name), "utf8");
      expect(svg.match(/<circle /g), name).toHaveLength(6);
      expect(svg, name).not.toContain("<rect");
      expect(new Set(svg.match(/#[0-9A-Fa-f]{3,6}/g)), name).toEqual(new Set(["#fff"]));
    }
  });
});
