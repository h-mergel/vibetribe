/**
 * Writes the `.streamDeckProfile` the plugin ships (`pnpm plugin:build`), in the structure of a
 * profile exported by Stream Deck 7: a ZIP with package.json and
 * Profiles/<ID>.sdProfile/{manifest.json,Profiles/<PAGE>/manifest.json,…/Images/}. The file is
 * generated from the declarations below and only ever read by Stream Deck, never by the plugin.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import type { KeyRole } from "../src/deck/keys";
import { ACTION_UUIDS, BUNDLED_PROFILE, PLUGIN_UUID } from "../src/ids";
import { MK2_MODEL } from "./profile-layout";

/** The MK.2 keys by row; `back` is a home key with the instance setting that leads back. */
const LAYOUT: readonly (readonly (KeyRole | "back")[])[] = [
  ["back", "inbox", "limit5h", "limitWeek", "extra"],
  ["status", "slot", "slot", "slot", "slot"],
  ["slot", "slot", "slot", "slot", "slot"],
];
const NO_PAGE = "00000000-0000-0000-0000-000000000000";
/** The oldest app the manifest allows (`Software.MinimumVersion`). */
const APP_VERSION = "7.1.0.0";
const OS_VERSION = "10.0.19045";

export interface PluginManifest {
  Version: string;
  Name: string;
  Actions: { UUID: string; Name: string }[];
}

/** A file, or a folder when `data` is absent. */
export interface ZipEntry {
  name: string;
  data?: Buffer;
}

/** Stable ids: the same declarations always give the same file. */
function idOf(seed: string): string {
  const h = createHash("sha1").update(`vibetribe-profile-${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const page = (actions: Record<string, unknown> | null) => ({
  Controllers: [{ Actions: actions, Type: "Keypad" }],
  Icon: "",
  Name: "",
});

function actions(manifest: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [row, keys] of LAYOUT.entries())
    for (const [column, key] of keys.entries()) {
      const place = `${column},${row}`;
      const back = key === "back";
      const uuid = ACTION_UUIDS[key === "back" ? "home" : key];
      const name = manifest.Actions.find((a) => a.UUID === uuid)?.Name;
      if (!name) throw new Error(`${uuid} is not in the manifest`);
      out[place] = {
        ActionID: idOf(`key-${place}`),
        LinkedTitle: true,
        Name: name,
        Plugin: { Name: manifest.Name, UUID: PLUGIN_UUID, Version: manifest.Version },
        Resources: null,
        Settings: back ? { back: true } : {},
        State: 0,
        States: [{}],
        UUID: uuid,
      };
    }
  return out;
}

const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), "utf8");

export function bundledProfileEntries(manifest: PluginManifest): ZipEntry[] {
  const root = `Profiles/${idOf("profile").toUpperCase()}.sdProfile`;
  const defaultPage = idOf("default-page");
  const contentPage = idOf("content-page");
  const pageEntries = (id: string, actionsOfPage: Record<string, unknown> | null): ZipEntry[] => {
    const dir = `${root}/Profiles/${id.toUpperCase()}`;
    return [
      { name: `${dir}/` },
      { name: `${dir}/Images/` },
      { name: `${dir}/manifest.json`, data: json(page(actionsOfPage)) },
    ];
  };
  return [
    {
      name: "package.json",
      data: json({
        AppVersion: APP_VERSION,
        DeviceModel: MK2_MODEL,
        DeviceSettings: null,
        FormatVersion: 1,
        OSType: "Windows",
        OSVersion: OS_VERSION,
        RequiredPlugins: [PLUGIN_UUID],
      }),
    },
    { name: "Profiles/" },
    { name: `${root}/` },
    {
      name: `${root}/manifest.json`,
      data: json({
        Device: { Model: MK2_MODEL, UUID: idOf("device") },
        Name: manifest.Name,
        Pages: { Current: NO_PAGE, Default: defaultPage, Pages: [contentPage] },
        Version: "3.0",
      }),
    },
    { name: `${root}/Profiles/` },
    ...pageEntries(defaultPage, null),
    ...pageEntries(contentPage, actions(manifest)),
  ];
}

/** A plain ZIP with fixed timestamps: deflated files, stored folders, no extras. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const DOS_DATE_1980 = 0x21;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.data ?? Buffer.alloc(0);
    const packed = e.data ? deflateRawSync(data) : data;
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x0800, 2);
    common.writeUInt16LE(e.data ? 8 : 0, 4);
    common.writeUInt16LE(DOS_DATE_1980, 8);
    common.writeUInt32LE(crc32(data) >>> 0, 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), common, name, packed]);
    const tail = Buffer.alloc(14);
    tail.writeUInt32LE(offset, 10);
    centrals.push(
      Buffer.concat([
        Buffer.from("PK\x01\x02", "latin1"),
        Buffer.from([20, 0]),
        common,
        tail,
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.write("PK\x05\x06", 0, "latin1");
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Writes `<pluginDir>/<manifest entry name>.streamDeckProfile`; returns its path. */
export function writeBundledProfile(pluginDir: string, manifest: PluginManifest): string {
  const path = join(pluginDir, `${BUNDLED_PROFILE}.streamDeckProfile`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, zip(bundledProfileEntries(manifest)));
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = fileURLToPath(new URL(`../${PLUGIN_UUID}.sdPlugin`, import.meta.url));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as PluginManifest;
  process.stdout.write(`${writeBundledProfile(dir, manifest)}\n`);
}
