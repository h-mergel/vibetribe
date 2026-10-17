import { isMeasured } from "./metrics";

/**
 * Titles the tile font can draw (handoff §6): DejaVu Sans has no CJK, Thai, Devanagari, … glyphs;
 * resvg would draw boxes and the width table would measure wrong. Such characters are removed in
 * the model; a title left without letters or digits falls back to the session's folder name.
 */

// Scripts DejaVu Sans covers; the width table measures their letters approximately (0.62 em).
const DRAWABLE = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{M}\s]/u;
const READABLE = /[\p{L}\p{N}]/u;

/** `s` without the characters the tile font cannot draw (NFC first, so é stays one character). */
export function drawableText(s: string): string {
  return [...s.normalize("NFC")].filter((ch) => isMeasured(ch) || DRAWABLE.test(ch)).join("");
}

/** The title for a tile: drawable characters only; the folder name if no letter or digit is left. */
export function tileTitle(title: string, cwd: string): string {
  const t = drawableText(title);
  if (READABLE.test(t)) return t;
  const folder = drawableText(cwd.split(/[\\/]/).filter(Boolean).pop() ?? "");
  return READABLE.test(folder) ? folder : t;
}
