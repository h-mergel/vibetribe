import type { KeyFlash } from "./model";
import { DETAIL } from "./theme";

/** Words and numbers on the tiles (reference renderer): clock, notes, counts, amounts. */

/** Spec §9 jump feedback: "Open…" while a jump runs; a session without a jump target says so instead. */
export const FLASH_TEXT: Record<KeyFlash, string> = { jumping: "Open…", no_target: "No link" };

/** Short form of a detail (`server_error` → `Server`); tool names stay as they are. */
export function detailLabel(detail: string): string {
  return Object.hasOwn(DETAIL, detail) ? (DETAIL[detail] as string) : detail;
}

/**
 * Wait clock as [number, unit]: "42 s" for the first minute, then "3 min", from 60 min "1:05 h",
 * from 10 h "12 h".
 */
export function clockParts(wait: number): [string, string] {
  const sec = Math.max(0, Math.floor(wait));
  if (sec >= 36_000) return [String(Math.floor(sec / 3600)), "h"];
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return [`${h}:${m < 10 ? "0" : ""}${m}`, "h"];
  }
  if (sec >= 60) return [String(Math.floor(sec / 60)), "min"];
  return [String(sec), "s"];
}

const INACTIVE_NOTES: ReadonlySet<string> = new Set([
  "Disabled",
  "No credit",
  "Limit hit",
  "Inactive",
]);

/** True for the extra-tile notes that say extra usage is not active (the amount then shows "off"). */
export function isInactiveNote(note: string | null | undefined): boolean {
  return INACTIVE_NOTES.has(note ?? "");
}

export function clampNum(v: number): string {
  return v > 99 ? "99+" : String(v);
}

/** Splits "€12.40" / "12,40 €" into [number, currency sign, sign first]; no sign: [s, ""]. */
export function splitEuro(raw: string): [string, string, boolean] {
  const s = String(raw);
  const m = /^(.*?)\s*([€$£])$/.exec(s) ?? /^([€$£])\s*(.*)$/.exec(s);
  if (!m) return [s, "", false];
  const a = m[1] ?? "";
  const b = m[2] ?? "";
  return /^[€$£]$/.test(a) ? [b, a, true] : [a, b, false];
}
