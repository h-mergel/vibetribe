import { C, FONT } from "./theme";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

// Characters that are not allowed in XML 1.0 (resvg rejects the whole document): C0 controls
// except tab/LF/CR, DEL, the noncharacters U+FFFE/U+FFFF and unpaired surrogates.
const XML_ILLEGAL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeXml(s: string): string {
  return s.replace(XML_ILLEGAL, "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** Coordinates with at most two decimals, as the reference renderer writes them. */
export const n = (v: number): number => Math.round(v * 100) / 100;

export type Anchor = "start" | "middle" | "end";

/**
 * One `<text>` element with a fixed id; `start` is the default and is not written. `strokeText`
 * (token `stroke-text`, comfortable only) outlines regular (400) text in its own colour, so it reads
 * like semibold on the LCD without the width of bold; 0 writes no stroke.
 */
export function text(
  id: string,
  x: number,
  y: number,
  s: string,
  size: number,
  weight: 400 | 700,
  fill: string,
  anchor: Anchor = "start",
  strokeText = 0,
): string {
  const a = anchor !== "start" ? ` text-anchor="${anchor}"` : "";
  const st = strokeText && weight < 700 ? ` stroke="${fill}" stroke-width="${strokeText}"` : "";
  return `<text id="${id}" x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${st}>${escapeXml(s)}</text>`;
}

/** The 144 x 144 document with the full-bleed ground (no corner radius). */
export function svgDoc(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect id="vt-ground" x="0" y="0" width="144" height="144" fill="${C.ground}"/>${body}</svg>`;
}
