import { clock, esc } from "./html";

/** One deck key as the plugin last drove it; `image` is exactly the string handed to setImage. */
export interface MirrorKey {
  id: string;
  role: string;
  /** 0-based slot index for slot keys, null for the other roles */
  slot: number | null;
  device: string;
  row: number;
  column: number;
  image: string | null;
  sentAt: number | null;
}

/** One key jump; `url` null = the session had no link. */
export interface JumpRecord {
  at: number;
  session: string;
  title: string;
  url: string | null;
  result: "opened" | "logged" | "failed" | "no_target";
}

/** Snapshot of the deck for /debug/keys; produced by the plugin, the hub only serves it. */
export interface DeckMirror {
  at: number;
  sentLastSecond: number;
  pending: number;
  keys: MirrorKey[];
  /** the latest jumps, oldest first; absent when the plugin recorded none */
  jumps?: JumpRecord[];
}

/** What the debug pages can show: a snapshot, no deck connected, or a supplier that failed. */
export type MirrorRead = DeckMirror | null | "failed";

/** Calls the plugin's supplier; a throwing supplier must not take the debug pages down. */
export function readMirror(read: (() => DeckMirror | null) | undefined): MirrorRead {
  try {
    return read?.() ?? null;
  } catch {
    return "failed";
  }
}

const GRID_MAX = 15;
const COUNT_MAX = 1_000_000;

/** Integer in [lo, hi]; NaN and infinities fall to lo, so the markup stays bounded. */
const clampInt = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo;

/** Only data URLs produced by the plugin are embedded; anything else would be a foreign resource. */
const isDataUrl = (image: string | null): image is string =>
  typeof image === "string" && image.startsWith("data:image/");

function figure(k: MirrorKey, timeZone?: string): string {
  const row = clampInt(k.row, 0, GRID_MAX);
  const column = clampInt(k.column, 0, GRID_MAX);
  const caption = k.slot === null ? k.role : `${k.role} ${k.slot + 1}`;
  const img = isDataUrl(k.image)
    ? `<img src="${esc(k.image)}" width="72" height="72" alt="${esc(caption)}">`
    : `<div class="blank"></div>`;
  return `<figure style="grid-row:${row + 1};grid-column:${column + 1}">${img}<figcaption>${esc(caption)}<br>${clock(k.sentAt, timeZone)}</figcaption></figure>`;
}

const JUMPS_SHOWN = 10;

/** The latest jumps, newest first; nothing when there are none. */
function jumpsTable(jumps: JumpRecord[] | undefined, timeZone?: string): string {
  if (!Array.isArray(jumps) || jumps.length === 0) return "";
  const rows = jumps
    .slice(-JUMPS_SHOWN)
    .reverse()
    .map(
      (j) =>
        `<tr><td>${clock(j.at, timeZone)}</td><td>${esc(j.title)} (${esc(j.session)})</td><td>${esc(j.url ?? "no target")}</td><td>${esc(j.result)}</td></tr>`,
    )
    .join("");
  return `<h3>Jumps</h3><table><tr><th>Time</th><th>Session</th><th>Link</th><th>Result</th></tr>${rows}</table>`;
}

/** The key grid as the device shows it: one figure per visible key, placed by its coordinates. */
export function renderKeysSection(mirror: MirrorRead, timeZone?: string): string {
  if (mirror === "failed") return "<p>Mirror unavailable.</p>";
  if (!mirror) return "<p>No deck connected.</p>";
  const devices = [...new Set(mirror.keys.map((k) => k.device))];
  const grids = devices
    .map((device) => {
      const keys = mirror.keys.filter((k) => k.device === device);
      const columns = Math.max(1, ...keys.map((k) => clampInt(k.column, 0, GRID_MAX) + 1));
      return `<h3>${esc(device)}</h3><div class="deck" style="grid-template-columns:repeat(${columns},72px)">${keys.map((k) => figure(k, timeZone)).join("")}</div>`;
    })
    .join("");
  const sent = clampInt(mirror.sentLastSecond, 0, COUNT_MAX);
  const pending = clampInt(mirror.pending, 0, COUNT_MAX);
  return `<p>Images/s: ${sent} · pending: ${pending} · as of ${clock(mirror.at, timeZone)}</p>${grids}${jumpsTable(mirror.jumps, timeZone)}`;
}

/** Styles of every page that shows the key grid (`renderKeysSection`). */
export const KEYS_PAGE_CSS =
  "body{font:13px system-ui;background:#111;color:#ddd;margin:16px}.deck{display:grid;gap:8px}figure{margin:0;display:grid;gap:2px;justify-items:center}figcaption{font-size:11px;text-align:center}.blank{width:72px;height:72px;background:#222}h3{font-size:13px}";

/** Standalone, auto-refreshing mirror page for humans; /debug/keys.json serves the same data. */
export function renderKeysHtml(mirror: MirrorRead, timeZone?: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="1"><title>VibeTribe Keys</title>
<style>${KEYS_PAGE_CSS}</style>
<h2>Keys</h2>${renderKeysSection(mirror, timeZone)}`;
}
