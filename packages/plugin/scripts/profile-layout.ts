/**
 * Pure part of `pnpm profile:layout`: validates Stream Deck ProfilesV3 manifests and a layout
 * file, and computes the new page 1 and page 2 of an MK.2 profile. Foreign keys are carried over
 * unchanged; the manifests are re-serialised from parsed JSON, so `profile-files.ts` (file
 * access, backups, atomic writes) refuses manifests where that could alter a value.
 */
import { randomUUID } from "node:crypto";
import { isObj } from "@vibetribe/protocol";
import { KEY_ROLES, type KeyRole } from "../src/deck/keys";
import { ACTION_UUIDS, PLUGIN_UUID } from "../src/ids";

/** `Device.Model` of a Stream Deck MK.2 in the profile manifest (15 keys, 5 x 3). */
export const MK2_MODEL = "20GBL9901";

export interface ActionState {
  /** relative to the page folder: "Images/<file>" */
  Image?: string;
  [field: string]: unknown;
}

/** One key of a page manifest: UUID (the action), ActionID (the instance), States[].Image are read. */
export interface ActionEntry {
  UUID: string;
  ActionID?: string;
  Name?: string;
  States?: ActionState[];
  [field: string]: unknown;
}

export interface PageManifest {
  Controllers: {
    Actions?: Record<string, ActionEntry> | null;
    Type?: string;
    [field: string]: unknown;
  }[];
  [field: string]: unknown;
}

/** Target page 1, by "column,row": keep a foreign key from its old place, or one of our roles. */
export type Cell = { keep: string } | { role: KeyRole };

export interface Layout {
  page1: Record<string, Cell>;
  /** old page-1 places whose (foreign) keys move to the first free places of page 2 */
  toPage2: string[];
}

export interface LayoutResult {
  page1: PageManifest;
  page2: PageManifest;
  /** image files ("<name>.png") of the keys moved to page 2; they must be copied along */
  images: string[];
  /** keys made new (no key of that role was left to reuse) */
  created: number;
}

const COLUMNS = 5;
const ROWS = 3;
const PLACE = /^[0-4],[0-2]$/;
const IMAGE = /^Images\/([A-Za-z0-9._-]+)$/;
const ROLE_BY_UUID = new Map(KEY_ROLES.map((r) => [ACTION_UUIDS[r], r] as const));
export const isOurs = (e: ActionEntry): boolean => e.UUID.startsWith(`${PLUGIN_UUID}.`);

export const places = (): string[] =>
  Array.from({ length: ROWS * COLUMNS }, (_, i) => `${i % COLUMNS},${Math.floor(i / COLUMNS)}`);

/** Strict layout file: known places, known roles, no other fields. */
export function parseLayout(raw: unknown): Layout {
  if (!isObj(raw)) throw new Error("layout: not an object");
  const extra = Object.keys(raw).filter((k) => k !== "page1" && k !== "toPage2");
  if (extra.length) throw new Error(`layout: unknown field ${extra.join(", ")}`);
  const { page1, toPage2 } = raw;
  if (!isObj(page1)) throw new Error("layout: page1 must be an object");
  if (!Array.isArray(toPage2) || !toPage2.every((p) => typeof p === "string" && PLACE.test(p)))
    throw new Error('layout: toPage2 must list places like "0,2"');
  const cells: Record<string, Cell> = {};
  for (const [place, cell] of Object.entries(page1)) {
    if (!PLACE.test(place)) throw new Error(`layout: unknown place ${place}`);
    const keys = isObj(cell) ? Object.keys(cell) : [];
    if (isObj(cell) && keys.length === 1 && typeof cell.keep === "string" && PLACE.test(cell.keep))
      cells[place] = { keep: cell.keep };
    else if (isObj(cell) && keys.length === 1 && KEY_ROLES.includes(cell.role as KeyRole))
      cells[place] = { role: cell.role as KeyRole };
    else
      throw new Error(
        `layout: ${place} must be { "keep": "c,r" } or { "role": one of ${KEY_ROLES.join(", ")} }`,
      );
  }
  return { page1: cells, toPage2: toPage2 as string[] };
}

/** A page manifest as the tool understands it: one Keypad controller, grid places, UUIDs. */
export function checkPage(raw: unknown, name: string): PageManifest {
  if (!isObj(raw) || !Array.isArray(raw.Controllers) || raw.Controllers.length !== 1)
    throw new Error(`${name}: expected exactly one controller`);
  const c = raw.Controllers[0];
  if (!isObj(c) || c.Type !== "Keypad") throw new Error(`${name}: controller is not a Keypad`);
  const actions = c.Actions ?? {};
  if (!isObj(actions)) throw new Error(`${name}: Actions is not an object`);
  for (const [place, e] of Object.entries(actions)) {
    if (!PLACE.test(place)) throw new Error(`${name}: ${place} is not a place on a 5 x 3 MK.2`);
    if (!isObj(e) || typeof e.UUID !== "string") throw new Error(`${name}: ${place} has no UUID`);
  }
  return raw as PageManifest;
}

const modelOf = (raw: unknown): string =>
  isObj(raw) && isObj(raw.Device) && typeof raw.Device.Model === "string" ? raw.Device.Model : "";

export const isMk2Profile = (raw: unknown): boolean => modelOf(raw) === MK2_MODEL;

/** Model and page order of a profile manifest; refuses anything but an MK.2. */
export function checkProfile(raw: unknown, name: string): { model: string; pages: string[] } {
  const pages = isObj(raw) && isObj(raw.Pages) ? raw.Pages.Pages : null;
  const model = modelOf(raw);
  if (model !== MK2_MODEL) throw new Error(`${name}: device ${model || "?"} is not an MK.2`);
  if (!Array.isArray(pages) || !pages.every((p) => typeof p === "string"))
    throw new Error(`${name}: no page list (Pages.Pages)`);
  return { model, pages: pages as string[] };
}

/** true when any string inside `v` (at any depth) points into an "Images" folder. */
function mentionsImages(v: unknown): boolean {
  if (typeof v === "string") return /(^|[\\/])Images[\\/]/i.test(v);
  if (Array.isArray(v)) return v.some(mentionsImages);
  if (isObj(v)) return Object.values(v).some(mentionsImages);
  return false;
}

/** File names of a key's state images; refuses anything but "Images/<name>". */
export function imagesOf(e: ActionEntry): string[] {
  // an image reference anywhere else would not be copied along and leave a broken icon: refuse
  const { States, ...rest } = e;
  const others = (States ?? []).map(({ Image: _image, ...s }) => s);
  if (mentionsImages({ ...rest, States: others }))
    throw new Error(`${e.UUID}: nested image reference outside States[].Image, refusing to move`);
  const out: string[] = [];
  for (const s of e.States ?? []) {
    if (s.Image === undefined || s.Image === "") continue;
    const m = IMAGE.exec(String(s.Image));
    if (!m?.[1]) throw new Error(`${e.UUID}: image path ${String(s.Image)} is not Images/<file>`);
    out.push(m[1]);
  }
  return out;
}

export function actionsOf(page: PageManifest): Record<string, ActionEntry> {
  return page.Controllers[0]?.Actions ?? {};
}

export const countKeys = (page: PageManifest): number => Object.keys(actionsOf(page)).length;

function withActions(page: PageManifest, actions: Record<string, ActionEntry>): PageManifest {
  const [first, ...rest] = page.Controllers;
  return { ...page, Controllers: [{ ...first, Actions: actions }, ...rest] };
}

/** One line per place of the 5 x 3 grid: "c,r  <action UUID>  <name>" or "c,r  -". */
export function describePage(page: PageManifest): string[] {
  const actions = actionsOf(page);
  return places().map((p) => {
    const e = actions[p];
    return e ? `${p}  ${e.UUID}  ${e.Name ?? ""}`.trimEnd() : `${p}  -`;
  });
}

/**
 * The new page 1 and page 2. Throws (and changes nothing) when a foreign key would be lost or
 * duplicated, a VibeTribe key would move to page 2, page 2 has no room, an image path is not
 * "Images/<file>", or a new key has no template.
 */
export function applyLayout(
  page1: PageManifest,
  page2: PageManifest,
  layout: Layout,
  names: Record<KeyRole, string>,
  newId: () => string = randomUUID,
): LayoutResult {
  const old = actionsOf(page1);
  const used = new Set<string>();
  const take = (p: string, why: string): ActionEntry => {
    const e = old[p];
    if (!e) throw new Error(`${why}: no key at ${p}`);
    if (used.has(p)) throw new Error(`${why}: the key at ${p} is used twice`);
    used.add(p);
    return e;
  };

  const second = { ...actionsOf(page2) };
  const free = places().filter((p) => !second[p]);
  const images: string[] = [];
  for (const p of layout.toPage2) {
    const e = take(p, "toPage2");
    if (isOurs(e)) throw new Error(`toPage2: ${p} is a VibeTribe key`);
    const target = free.shift();
    if (!target) throw new Error("page 2 has no free place left");
    second[target] = e;
    images.push(...imagesOf(e));
  }

  // our keys by role, in reading order, reused before new ones are made (they keep their settings)
  const pool = new Map<KeyRole, string[]>();
  for (const p of places()) {
    const e = old[p];
    const role = e ? ROLE_BY_UUID.get(e.UUID) : undefined;
    if (role) pool.set(role, [...(pool.get(role) ?? []), p]);
  }
  const template = Object.values(old).find(isOurs);

  const first: Record<string, ActionEntry> = {};
  let created = 0;
  for (const [p, cell] of Object.entries(layout.page1)) {
    if ("keep" in cell) {
      const e = take(cell.keep, `page1 ${p}`);
      if (isOurs(e))
        throw new Error(`page1 ${p}: keep ${cell.keep} is a VibeTribe key, use a role`);
      first[p] = e;
      continue;
    }
    const reuse = pool.get(cell.role)?.shift();
    if (reuse) {
      first[p] = take(reuse, `page1 ${p}`);
      continue;
    }
    if (!template)
      throw new Error(`page1 ${p}: no VibeTribe key on page 1 to copy for ${cell.role}`);
    created++;
    first[p] = {
      ...template,
      ActionID: newId(),
      Name: names[cell.role],
      Settings: {},
      States: [{}],
      UUID: ACTION_UUIDS[cell.role],
    };
  }

  const lost = Object.keys(old).filter((p) => !used.has(p));
  if (lost.length) throw new Error(`keys would be lost: ${lost.join(" ")}`);
  return {
    page1: withActions(page1, first),
    page2: withActions(page2, second),
    images: [...new Set(images)],
    created,
  };
}
