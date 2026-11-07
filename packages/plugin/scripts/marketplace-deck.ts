import { render, type Tile } from "@vibetribe/render";
import { renderPixels } from "@vibetribe/render/png";
import {
  type Point,
  project,
  type Quad,
  type Raster,
  squareToQuad,
  warpTile,
} from "./marketplace-raster";

/** The official front view: size in pixels; everything below is measured on it. */
export const DEVICE_WIDTH = 6000;
export const DEVICE_HEIGHT = 4000;
/** The device itself within the picture, without its shadow. */
export const DEVICE_BOX = { left: 858, top: 770, right: 5292, bottom: 3510 };

const COLUMNS = 5;
const ROWS = 3;
/** Gap between two key screens, in key widths. */
const GAP = 0.43;
/** Key screens reach under the bezel's soft edge, so nothing of the picture below remains. */
const BLEED = 0.022;
const SCREEN_RADIUS = 0.1;
/** Corners of the whole key field, on the screens of the four corner keys. */
const FIELD: Quad = [
  [1459, 1257],
  [4686, 1257],
  [4764, 2778],
  [1364, 2775],
];
const FIELD_MAP = squareToQuad(FIELD);
const FIELD_WIDTH = COLUMNS + (COLUMNS - 1) * GAP;
const FIELD_HEIGHT = ROWS + (ROWS - 1) * GAP;
/** Tiles are drawn larger than the 144 px of the device and shrink with the whole picture. */
const TILE_PIXELS = 576;

const slot = (
  state: "needs_permission" | "needs_input" | "error" | "done_unseen",
  title: string,
  badge: "WIN" | "WSL" | "REM",
  wait: number,
  detail: string | null = null,
): Tile => ({ kind: "slot", state, title, badge, wait, detail, frame: "thick" });

const calm = (
  state: "working" | "idle",
  title: string,
  badge: "WIN" | "WSL" | "REM",
  detail: string | null = null,
): Tile => ({ kind: "slot", state, title, badge, detail, tick: 1 });

/** In reading order, as in the ready-made profile, with one session in every state. */
export const DECK_TILES: readonly Tile[] = [
  { kind: "back" },
  {
    kind: "inbox",
    waiting: 4,
    top: { title: "Login Flow", state: "needs_permission", wait: 42 },
    overflow: 0,
  },
  {
    kind: "limit",
    label: "5h",
    usedPct: 62,
    pacePct: 48,
    resetIn: "2h 15m",
    level: "amber",
    ahead: true,
  },
  { kind: "limit", label: "Week", usedPct: 38, pacePct: 45, resetIn: "3d 4h", level: "neutral" },
  { kind: "extra", used: "€12.40", limit: "€50", ratio: 0.248, level: "neutral" },
  {
    kind: "status",
    rows: [
      { source: "WIN", health: "ok" },
      { source: "WSL", health: "ok" },
      { source: "REM", health: "ok" },
      { source: "LIM", health: "ok" },
    ],
  },
  slot("needs_permission", "Login Flow", "WIN", 42),
  slot("needs_input", "Spec Review", "WSL", 95),
  slot("error", "Docs Update", "REM", 180, "Server"),
  slot("done_unseen", "Release Notes", "WIN", 65),
  { kind: "slot", state: "throttled", title: "Data Import", badge: "WSL" },
  calm("working", "API Tests", "WSL", "Bash"),
  { kind: "slot", state: "background", title: "Build Script", badge: "WIN", bgCount: 3 },
  calm("idle", "Theme Colors", "WIN"),
  { kind: "slot", state: "no_signal", title: "Bug Triage", badge: "REM" },
];

/** The screen of a key in a picture of the given size. */
export function keyQuad(width: number, height: number, column: number, row: number): Quad {
  const map = (keyX: number, keyY: number): Point => {
    const [x, y] = project(FIELD_MAP, keyX / FIELD_WIDTH, keyY / FIELD_HEIGHT);
    return [(x * width) / DEVICE_WIDTH, (y * height) / DEVICE_HEIGHT];
  };
  const left = column * (1 + GAP) - BLEED;
  const top = row * (1 + GAP) - BLEED;
  const size = 1 + 2 * BLEED;
  return [
    map(left, top),
    map(left + size, top),
    map(left + size, top + size),
    map(left, top + size),
  ];
}

/** A copy of the device picture with the VibeTribe tiles on its key screens. */
export function composeDeck(device: Raster): Raster {
  if (device.width * 2 !== device.height * 3)
    throw new Error(`device image must be 3:2, is ${device.width}×${device.height}`);
  const deck = { ...device, data: Uint8Array.from(device.data) };
  DECK_TILES.forEach((tile, i) => {
    const data = renderPixels(render(tile), TILE_PIXELS);
    warpTile(
      deck,
      { width: TILE_PIXELS, height: TILE_PIXELS, data },
      keyQuad(device.width, device.height, i % COLUMNS, Math.floor(i / COLUMNS)),
      SCREEN_RADIUS,
    );
  });
  return deck;
}
