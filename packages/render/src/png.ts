import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

/**
 * DejaVu Sans as the tiles name it. The two files of the Debian/Ubuntu package are loaded directly
 * when present (as the handoff measured, and 5x faster than a system font scan); otherwise resvg
 * searches the system fonts.
 */
const DEJAVU = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];
const FONT = DEJAVU.every((f) => existsSync(f))
  ? { fontFiles: DEJAVU, loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" }
  : { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" };

/** A tile-sized canvas without the ground, so a bounding box is the fragment alone. */
const bare = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${body}</svg>`;

function rasterize(svg: string, width = 144): Resvg {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: FONT });
}

export function svgToPng(svg: string, width = 144): Buffer {
  return rasterize(svg, width).render().asPng();
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box of one SVG fragment (a `<text>`, a glyph `<g>`), rendered alone; null if empty. */
export function boxOf(fragment: string): Box | null {
  const b = rasterize(bare(fragment)).getBBox();
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}

/** RGBA pixels of the rendered SVG, used to verify that text actually rasterizes. */
export function renderPixels(svg: string): Buffer {
  return rasterize(svg).render().pixels;
}
