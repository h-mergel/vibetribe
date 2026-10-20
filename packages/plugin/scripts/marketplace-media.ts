import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";

/** Maker Console: thumbnail and gallery images are 1920×960 PNG, the app icon 288×288 PNG. */
const GALLERY_WIDTH = 1920;
const GALLERY_HEIGHT = 960;
const ICON_SIZE = 288;
/** the README's background */
const BACKGROUND = "#0E1116";

/** Output file → picture in docs/readme; the thumbnail is the banner, which is 2:1 already. */
export const MEDIA: readonly (readonly [string, string])[] = [
  ["thumbnail.png", "banner.png"],
  ["gallery-1-deck.png", "banner.png"],
  ["gallery-2-tiles.png", "tiles.png"],
  ["gallery-3-architecture.png", "architecture.png"],
  ["gallery-4-tribe.png", "tribe.jpg"],
];

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg" };

/** The picture scaled to fit 1920×960 and centered on the README's background. */
export function galleryPng(picture: Buffer, mime: string): Buffer {
  const href = `data:${mime};base64,${picture.toString("base64")}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}">` +
    `<rect width="100%" height="100%" fill="${BACKGROUND}"/>` +
    `<image href="${href}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
}

function iconPng(svg: string): Buffer {
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: ICON_SIZE } }).render().asPng(),
  );
}

/** Writes the Maker Console media for the listing into `out`. */
export function writeMedia(repo: string, out: string): string[] {
  mkdirSync(out, { recursive: true });
  const written: string[] = [];
  for (const [name, source] of MEDIA) {
    const picture = readFileSync(join(repo, "docs", "readme", source));
    writeFileSync(join(out, name), galleryPng(picture, MIME[extname(source)] ?? "image/png"));
    written.push(name);
  }
  const icon = join(repo, "packages", "plugin", "dev.h2k.vibetribe.sdPlugin", "imgs", "plugin");
  writeFileSync(
    join(out, "icon.png"),
    iconPng(readFileSync(join(icon, "marketplace.svg"), "utf8")),
  );
  return [...written, "icon.png"];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = resolve(process.argv[2] ?? "dist/marketplace");
  for (const name of writeMedia(process.cwd(), out)) process.stdout.write(`${join(out, name)}\n`);
}
