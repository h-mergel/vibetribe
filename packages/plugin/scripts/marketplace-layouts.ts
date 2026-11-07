import { DEVICE_BOX, DEVICE_HEIGHT, DEVICE_WIDTH, keyQuad } from "./marketplace-deck";
import { encodePng, type Point, type Raster, shrinkToWidth } from "./marketplace-raster";

/** Maker Console: thumbnail and gallery images are 1920×960 PNG. */
export const GALLERY_WIDTH = 1920;
export const GALLERY_HEIGHT = 960;
/** the README's background */
export const BACKGROUND = "#0E1116";
export const MUTED = "#9AA3AD";
export const TEXT = "#E6E9ED";
export const GREEN = "#2BD4A0";

const canvas = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}" font-family="DejaVu Sans">` +
  `<rect width="${GALLERY_WIDTH}" height="${GALLERY_HEIGHT}" fill="${BACKGROUND}"/>${body}</svg>`;

interface Placement {
  /** output pixels per pixel of the official picture */
  scale: number;
  x: number;
  y: number;
}

/** The device with its left and top edge at (`left`, `top`), `width` pixels wide. */
function placeDevice(left: number, top: number, width: number): Placement {
  const scale = width / (DEVICE_BOX.right - DEVICE_BOX.left);
  return { scale, x: left - DEVICE_BOX.left * scale, y: top - DEVICE_BOX.top * scale };
}

/** The deck at exactly its output size, so the render below does not resample it again. */
function deviceImage(deck: Raster, { scale, x, y }: Placement): string {
  const width = Math.round(DEVICE_WIDTH * scale);
  const png = encodePng(shrinkToWidth(deck, width));
  return (
    `<image href="data:image/png;base64,${png.toString("base64")}" x="${Math.round(x)}" y="${Math.round(y)}" ` +
    `width="${width}" height="${Math.round(DEVICE_HEIGHT * scale)}"/>`
  );
}

/** The device large, the name and one line beside it. */
export function thumbnailSvg(deck: Raster): string {
  const place = placeDevice(640, 96, 1220);
  return canvas(`
  <text x="64" y="420" font-size="86" font-weight="bold" fill="#FFFFFF">VibeTribe</text>
  <text x="66" y="486" font-size="35" fill="${TEXT}">See who needs you.</text>
  <text x="66" y="532" font-size="35" fill="${TEXT}">One press takes you there.</text>
  ${deviceImage(deck, place)}`);
}

const LINE = `stroke="${MUTED}" stroke-width="3" fill="none"`;

/** The device in the middle; labels around it say what the keys mean. */
export function deckGallerySvg(deck: Raster): string {
  const place = placeDevice(420, 118, 1080);
  const at = ([x, y]: Point): Point => [
    Math.round(place.x + x * place.scale),
    Math.round(place.y + y * place.scale),
  ];
  const quad = (column: number, row: number) => {
    const [tl, tr, br, bl] = keyQuad(DEVICE_WIDTH, DEVICE_HEIGHT, column, row);
    return { tl: at(tl), tr: at(tr), br: at(br), bl: at(bl) };
  };
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  const side = (column: number, row: number, label: string): string => {
    const q = quad(column, row);
    const toLeft = column === 0;
    const [x, y] = toLeft ? mid(q.tl, q.bl) : mid(q.tr, q.br);
    const end = toLeft ? 376 : GALLERY_WIDTH - 376;
    return `
  <circle cx="${x}" cy="${y}" r="6" fill="${MUTED}"/>
  <path d="M${x} ${y} H${end}" ${LINE}/>
  <text x="${toLeft ? end - 16 : end + 16}" y="${y + 13}" font-size="36" font-weight="bold" fill="${TEXT}" text-anchor="${toLeft ? "end" : "start"}">${label}</text>`;
  };

  /** A bracket along a row of keys, with a stem out of the device to the label. */
  const bracket = (
    from: Point,
    to: Point,
    tick: number,
    stemX: number,
    labelY: number,
    label: string,
  ): string => `
  <path d="M${from[0]} ${from[1] - tick} V${from[1]} H${to[0]} V${to[1] - tick}" ${LINE}/>
  <path d="M${stemX} ${from[1]} V${labelY + (tick > 0 ? -40 : 14)}" ${LINE}/>
  <text x="${stemX}" y="${labelY}" font-size="36" font-weight="bold" fill="${TEXT}" text-anchor="middle">${label}</text>`;

  const belowY = quad(0, 2).bl[1] + 18;
  const calmLeft = quad(0, 2).bl[0];
  const calmRight = quad(4, 2).br[0];
  const aboveY = quad(1, 0).tl[1] - 18;
  const inboxLeft = quad(1, 0).tl[0];
  const inboxRight = quad(1, 0).tr[0];
  const limitsLeft = quad(2, 0).tl[0];
  const limitsRight = quad(4, 0).tr[0];

  return canvas(`
  ${deviceImage(deck, place)}
  ${side(0, 0, "Back")}
  ${side(0, 1, "Status")}
  ${side(4, 1, "Needs you")}
  ${bracket([inboxLeft, aboveY], [inboxRight, aboveY], -12, inboxLeft + 26, 72, "Inbox")}
  ${bracket([limitsLeft, aboveY], [limitsRight, aboveY], -12, limitsRight - 60, 72, "Limits")}
  ${bracket([calmLeft, belowY], [calmRight, belowY], 12, (calmLeft + calmRight) / 2, 920, "Calm")}`);
}
