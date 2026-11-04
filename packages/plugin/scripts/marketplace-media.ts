import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { svgToPng } from "@vibetribe/render/png";
import { composeDeck } from "./marketplace-deck";
import {
  BACKGROUND,
  deckGallerySvg,
  GALLERY_HEIGHT,
  GALLERY_WIDTH,
  GREEN,
  MUTED,
  TEXT,
  thumbnailSvg,
} from "./marketplace-layouts";
import { decodePng } from "./marketplace-raster";

/** Maker Console: the app icon is a 288×288 PNG. */
const ICON_SIZE = 288;
const PANEL = "#1C1F24";
const LINE = "#2E333A";
const CONTROL = "#2A2E35";
const CONTROL_LINE = "#4A5059";
const LINK = "#5AA9F0";
const ALERT = "#FF5A36";
const ALERT_GROUND = "#2A1513";

const THUMBNAIL = "thumbnail.png";
const DECK_IMAGE = "gallery-1-deck.png";
const TILES_IMAGE = "gallery-2-tiles.png";
const SETUP_IMAGE = "gallery-3-setup.png";

/** The picture scaled to fit 1920×960 and centered on the README's background. */
export function galleryPng(picture: Buffer): Buffer {
  const href = `data:image/png;base64,${picture.toString("base64")}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}">` +
    `<rect width="100%" height="100%" fill="${BACKGROUND}"/>` +
    `<image href="${href}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
}

/** The Maker Console icon: the circle of the plugin icon above the bold name. */
export function appIconSvg(pluginIcon: string): string {
  const circle = pluginIcon.match(/<circle [^>]*\/>/g)?.join("") ?? "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="48" fill="${BACKGROUND}"/>
  <g transform="translate(46 8) scale(1.36)">${circle}</g>
  <text x="144" y="256" font-family="DejaVu Sans" font-size="44" font-weight="bold" fill="#FFFFFF" text-anchor="middle">VibeTribe</text>
</svg>`;
}

const setupStep = (x: number, n: number, title: string, sub: string): string => `
  <circle cx="${x + 22}" cy="300" r="22" fill="none" stroke="${GREEN}" stroke-width="3"/>
  <text x="${x + 22}" y="309" font-size="24" font-weight="bold" fill="${GREEN}" text-anchor="middle">${n}</text>
  <text x="${x + 62}" y="296" font-size="26" font-weight="bold" fill="${TEXT}">${title}</text>
  <text x="${x + 62}" y="330" font-size="21" fill="${MUTED}">${sub}</text>`;

const setupButton = (x: number, y: number, w: number, label: string, primary: boolean): string => `
  <rect x="${x}" y="${y}" width="${w}" height="44" rx="6" fill="${primary ? TEXT : CONTROL}" stroke="${primary ? "none" : CONTROL_LINE}"/>
  <text x="${x + w / 2}" y="${y + 29}" font-size="20" fill="${primary ? BACKGROUND : TEXT}" text-anchor="middle">${label}</text>`;

/** The three setup steps above a drawing of the key settings in the Stream Deck app. */
export function setupSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}" font-family="DejaVu Sans">
  <rect width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}" fill="${BACKGROUND}"/>
  <text x="192" y="128" font-size="52" font-weight="bold" fill="#FFFFFF">Set up in one click</text>
  <text x="192" y="178" font-size="25" fill="${MUTED}">No terminal, no Node.js to install. Your Claude settings stay untouched until you click.</text>

  ${setupStep(192, 1, "Install VibeTribe", "from the Marketplace")}
  ${setupStep(722, 2, "Click any VibeTribe key", "its settings open in the Stream Deck app")}
  ${setupStep(1252, 3, "Set up hooks", "Windows first, then WSL if you use it")}

  <rect x="192" y="400" width="1536" height="470" rx="14" fill="${PANEL}" stroke="${LINE}"/>
  <text x="232" y="452" font-size="22" font-weight="bold" fill="${TEXT}">VibeTribe: <tspan font-weight="normal" fill="${MUTED}">Status</tspan></text>
  <line x1="232" y1="476" x2="1688" y2="476" stroke="${LINE}"/>

  <rect x="232" y="510" width="150" height="150" rx="22" fill="${ALERT_GROUND}" stroke="${ALERT}" stroke-width="5"/>
  <circle cx="307" cy="565" r="20" fill="${ALERT}"/>
  <path d="M299 557 l16 16 M315 557 l-16 16" stroke="${ALERT_GROUND}" stroke-width="4" stroke-linecap="round"/>
  <text x="307" y="618" font-size="19" font-weight="bold" fill="${TEXT}" text-anchor="middle">Setup</text>
  <text x="307" y="642" font-size="15" fill="${MUTED}" text-anchor="middle">Sources ok</text>

  <text x="460" y="530" font-size="24" font-weight="bold" fill="${TEXT}">Claude Code hooks</text>
  <text x="460" y="566" font-size="20" fill="${MUTED}">Not set up yet. Adds VibeTribe's hooks to ~/.claude/settings.json (with a backup)</text>
  <text x="460" y="594" font-size="20" fill="${MUTED}">and copies Stream Deck's Node.js (about 90 MB) to %USERPROFILE%\\.vibetribe.</text>
  ${setupButton(460, 614, 190, "Set up hooks", true)}

  <text x="460" y="716" font-size="24" font-weight="bold" fill="${TEXT}">WSL (Ubuntu)</text>
  <text x="460" y="752" font-size="20" fill="${MUTED}">Adds the same hooks inside WSL (with a backup). Needs Node.js 20 or later there.</text>
  ${setupButton(460, 772, 190, "Set up in WSL", false)}
  ${setupButton(668, 772, 220, "Remove from WSL", false)}

  <text x="1688" y="830" font-size="19" fill="${LINK}" text-anchor="end">What does setup change?</text>
</svg>`;
}

/** Not in git: the official picture has no licence text that would allow publishing it. */
export function deviceImagePath(repo: string, env: NodeJS.ProcessEnv): string {
  return env.VIBETRIBE_DEVICE_IMAGE ?? join(repo, "assets-local", "mk2-front.png");
}

export interface Media {
  written: string[];
  skipped: { names: string[]; reason: string } | null;
}

/** Writes the Maker Console media for the listing into `out`. */
export function writeMedia(repo: string, out: string, deviceImage: string): Media {
  mkdirSync(out, { recursive: true });
  const write = (name: string, png: Buffer): string => {
    writeFileSync(join(out, name), png);
    return name;
  };
  const icon = join(repo, "packages", "plugin", "dev.h2k.vibetribe.sdPlugin", "imgs", "plugin");
  const always = [
    write(TILES_IMAGE, galleryPng(readFileSync(join(repo, "docs", "readme", "tiles.png")))),
    write(SETUP_IMAGE, svgToPng(setupSvg(), GALLERY_WIDTH)),
    write(
      "icon.png",
      svgToPng(appIconSvg(readFileSync(join(icon, "marketplace.svg"), "utf8")), ICON_SIZE),
    ),
  ];
  if (!existsSync(deviceImage))
    return {
      written: always,
      skipped: {
        names: [THUMBNAIL, DECK_IMAGE],
        reason: `no device image at ${deviceImage} (set VIBETRIBE_DEVICE_IMAGE or copy it there)`,
      },
    };
  const deck = composeDeck(decodePng(readFileSync(deviceImage)));
  return {
    written: [
      write(THUMBNAIL, svgToPng(thumbnailSvg(deck), GALLERY_WIDTH)),
      write(DECK_IMAGE, svgToPng(deckGallerySvg(deck), GALLERY_WIDTH)),
      ...always,
    ],
    skipped: null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repo = process.cwd();
  const out = resolve(process.argv[2] ?? "dist/marketplace");
  const { written, skipped } = writeMedia(repo, out, deviceImagePath(repo, process.env));
  for (const name of written) process.stdout.write(`${join(out, name)}\n`);
  if (skipped) process.stdout.write(`skipped ${skipped.names.join(", ")}: ${skipped.reason}\n`);
}
