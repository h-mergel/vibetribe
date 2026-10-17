import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionEntry, Layout, PageManifest } from "../scripts/profile-layout";

/**
 * A synthetic Stream Deck ProfilesV3 profile with the structure of the user's MK.2 profile
 * (field names, page order in the profile manifest, upper-case page folders, per-page Images/),
 * but invented ids, names and image bytes. No real profile data.
 */

export const NAMES = {
  slot: "Session slot",
  inbox: "Inbox",
  limit5h: "5h limit",
  limitWeek: "Weekly limit",
  extra: "Extra Usage",
  status: "Status",
};

export const PAGE1_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const PAGE2_ID = "aaaaaaaa-0000-4000-8000-000000000002";

export const foreign = (name: string, image = true): ActionEntry => ({
  ActionID: `id-${name}`,
  LinkedTitle: true,
  Name: name,
  Plugin: { Name: name, UUID: `com.example.${name}`, Version: "1.0" },
  Resources: null,
  Settings: { secret: name },
  State: 0,
  States: [image ? { Image: `Images/${name.toUpperCase()}.png`, Title: name } : { Title: name }],
  UUID: `com.example.${name}.action`,
});

export const ours = (role: string, id: string): ActionEntry => ({
  ActionID: id,
  LinkedTitle: true,
  Name: role,
  Plugin: { Name: "VibeTribe", UUID: "dev.h2k.vibetribe", Version: "0.1.0.0" },
  Resources: null,
  Settings: {},
  State: 0,
  States: [{}],
  UUID: `dev.h2k.vibetribe.${role}`,
});

export const page = (actions: Record<string, ActionEntry>): PageManifest => ({
  Controllers: [{ Actions: actions, Type: "Keypad" }],
  Icon: "",
  Name: "",
});

/** Page 1 of the user's MK.2 before the layout tool (foreign keys with their own images). */
export const before = (): PageManifest =>
  page({
    "0,0": foreign("apps"),
    "1,0": ours("inbox", "a-inbox"),
    "2,0": ours("limit-5h", "a-5h"),
    "3,0": ours("limit-week", "a-week"),
    "4,0": ours("status", "a-status"),
    "0,1": foreign("spotify"),
    "1,1": ours("slot", "a-s1"),
    "2,1": ours("slot", "a-s2"),
    "3,1": ours("slot", "a-s3"),
    "4,1": ours("slot", "a-s4"),
    "0,2": foreign("media1"),
    "1,2": foreign("media2"),
    "2,2": foreign("media3"),
    "3,2": foreign("mic"),
    "4,2": foreign("next", false),
  });

export const page2 = (): PageManifest => page({ "0,0": foreign("back") });

/** The "Mischform" layout: Apps 5h Week Inbox Status / Extra S1–S4 / Spotify S5 S6 Mic Next. */
export const MISCHFORM: Layout = {
  page1: {
    "0,0": { keep: "0,0" },
    "1,0": { role: "limit5h" },
    "2,0": { role: "limitWeek" },
    "3,0": { role: "inbox" },
    "4,0": { role: "status" },
    "0,1": { role: "extra" },
    "1,1": { role: "slot" },
    "2,1": { role: "slot" },
    "3,1": { role: "slot" },
    "4,1": { role: "slot" },
    "0,2": { keep: "0,1" },
    "1,2": { role: "slot" },
    "2,2": { role: "slot" },
    "3,2": { keep: "3,2" },
    "4,2": { keep: "4,2" },
  },
  toPage2: ["0,2", "1,2", "2,2"],
};

const json = (path: string, value: unknown): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};

/** Writes the profile below `root` (a ProfilesV3 stand-in); returns the two page folders. */
export function writeProfile(
  root: string,
  o: { model?: string; pages?: string[]; first?: PageManifest; second?: PageManifest } = {},
): { profile: string; page1: string; page2: string } {
  const profile = join(root, "SYNTH0001-0000-4000-8000-000000000000.sdProfile");
  json(join(profile, "manifest.json"), {
    Device: { Model: o.model ?? "20GBL9901", UUID: "synthetic-device" },
    Name: "Default Profile",
    Pages: { Current: PAGE1_ID, Default: PAGE1_ID, Pages: o.pages ?? [PAGE1_ID, PAGE2_ID] },
    Version: "3.0",
  });
  const dir1 = join(profile, "Profiles", PAGE1_ID.toUpperCase());
  const dir2 = join(profile, "Profiles", PAGE2_ID.toUpperCase());
  json(join(dir1, "manifest.json"), o.first ?? before());
  json(join(dir2, "manifest.json"), o.second ?? page2());
  for (const name of ["APPS", "SPOTIFY", "MEDIA1", "MEDIA2", "MEDIA3", "MIC"])
    json(join(dir1, "Images", `${name}.png`), `png-${name}`);
  json(join(dir2, "Images", "BACK.png"), "png-BACK");
  return { profile, page1: dir1, page2: dir2 };
}
