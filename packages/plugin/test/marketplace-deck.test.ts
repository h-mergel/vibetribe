import { describe, expect, it } from "vitest";
import {
  composeDeck,
  DECK_TILES,
  DEVICE_HEIGHT,
  DEVICE_WIDTH,
  keyQuad,
} from "../scripts/marketplace-deck";
import {
  decodePng,
  encodePng,
  invert,
  project,
  type Quad,
  type Raster,
  shrinkToWidth,
  squareToQuad,
  warpTile,
} from "../scripts/marketplace-raster";

const solid = (width: number, height: number, rgba: readonly number[]): Raster => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i % 4] ?? 0;
  return { width, height, data };
};
const at = (r: Raster, x: number, y: number): number[] => [
  ...r.data.subarray(
    (Math.floor(y) * r.width + Math.floor(x)) * 4,
    (Math.floor(y) * r.width + Math.floor(x) + 1) * 4,
  ),
];
const GREY = [40, 40, 42, 255];
const GREEN = [0, 255, 0, 255];

describe("raster", () => {
  it("survives a PNG round trip, transparency included", () => {
    const r = solid(3, 2, [128, 64, 0, 128]);
    r.data.set([10, 20, 30, 255], 0);
    const back = decodePng(encodePng(r));
    expect([back.width, back.height]).toEqual([3, 2]);
    expect(at(back, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(at(back, 2, 1)).toEqual([128, 64, 0, 128]);
  });

  it("shrinks by the average of the covered area, also for fractional factors", () => {
    const r = solid(5, 5, [0, 0, 0, 255]);
    for (let y = 0; y < 5; y++) r.data.set([250, 250, 250, 255], (y * 5 + 2) * 4);
    const small = shrinkToWidth(r, 2);
    expect([small.width, small.height]).toEqual([2, 2]);
    expect(at(small, 0, 0)).toEqual([50, 50, 50, 255]);
    expect(at(small, 1, 1)).toEqual([50, 50, 50, 255]);
  });

  it("leaves a raster that is already small enough alone", () => {
    const r = solid(4, 4, GREY);
    expect(shrinkToWidth(r, 8)).toBe(r);
  });

  it("maps the unit square onto the corners of a trapezoid and back", () => {
    const quad: Quad = [
      [10, 20],
      [90, 20],
      [100, 80],
      [0, 80],
    ];
    const h = squareToQuad(quad);
    const units = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    units.forEach(([u, v], i) => {
      const [x, y] = project(h, u, v);
      expect(x).toBeCloseTo(quad[i]?.[0] ?? Number.NaN);
      expect(y).toBeCloseTo(quad[i]?.[1] ?? Number.NaN);
    });
    const [u, v] = project(invert(h), ...project(h, 0.3, 0.7));
    expect(u).toBeCloseTo(0.3);
    expect(v).toBeCloseTo(0.7);
  });
});

describe("warpTile", () => {
  const quad: Quad = [
    [30, 30],
    [70, 30],
    [75, 70],
    [25, 70],
  ];

  it("fills the inside of the quad and nothing outside it", () => {
    const target = solid(100, 100, GREY);
    warpTile(target, solid(8, 8, GREEN), quad, 0);
    expect(at(target, 50, 50)).toEqual(GREEN);
    expect(at(target, 28, 66)).toEqual(GREEN);
    expect(at(target, 28, 34)).toEqual(GREY);
    expect(at(target, 50, 25)).toEqual(GREY);
    expect(at(target, 50, 75)).toEqual(GREY);
  });

  it("rounds the corners, so the bezel stays visible there", () => {
    const sharp = solid(100, 100, GREY);
    const round = solid(100, 100, GREY);
    warpTile(sharp, solid(8, 8, GREEN), quad, 0);
    warpTile(round, solid(8, 8, GREEN), quad, 0.25);
    expect(at(sharp, 31, 31)).toEqual(GREEN);
    expect(at(round, 31, 31)).toEqual(GREY);
    expect(at(round, 50, 31)).toEqual(GREEN);
  });

  it("follows the tile's orientation", () => {
    const tile = solid(2, 1, GREEN);
    tile.data.set([255, 0, 0, 255], 0);
    const target = solid(100, 100, GREY);
    warpTile(target, tile, quad, 0);
    expect(at(target, 33, 50)).toEqual([255, 0, 0, 255]);
    expect(at(target, 67, 50)).toEqual(GREEN);
  });
});

describe("composeDeck", () => {
  const device = solid(DEVICE_WIDTH / 10, DEVICE_HEIGHT / 10, GREY);
  const deck = composeDeck(device);
  const centre = (q: Quad) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2] as const;

  it("has a tile for each of the 15 keys", () => {
    expect(DECK_TILES).toHaveLength(15);
  });

  it("puts tile pixels on all 15 keys, each spot shows the tile and not the device", () => {
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 5; column++) {
        const [x, y] = centre(keyQuad(device.width, device.height, column, row));
        expect(at(deck, x, y)).not.toEqual(GREY);
      }
  });

  it("leaves the body untouched: every pixel off the keys equals the device image", () => {
    const quads: Quad[] = [];
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 5; column++)
        quads.push(keyQuad(device.width, device.height, column, row));
    const onSomeKey = (x: number, y: number) =>
      quads.some(
        (q) =>
          x >= Math.min(q[0][0], q[3][0]) - 1 &&
          x <= Math.max(q[1][0], q[2][0]) + 1 &&
          y >= q[0][1] - 1 &&
          y <= q[2][1] + 1,
      );
    let body = 0;
    for (let y = 0; y < device.height; y++)
      for (let x = 0; x < device.width; x++) {
        if (onSomeKey(x, y)) continue;
        body++;
        expect(at(deck, x, y)).toEqual(GREY);
      }
    expect(body).toBeGreaterThan(device.width * device.height * 0.7);
  });

  it("does not change the image it was given", () => {
    expect(at(device, device.width / 2, device.height / 2)).toEqual(GREY);
    const [x, y] = centre(keyQuad(device.width, device.height, 2, 1));
    expect(at(device, x, y)).toEqual(GREY);
  });

  it("refuses an image of another shape", () => {
    expect(() => composeDeck(solid(40, 40, GREY))).toThrow(/3:2/);
  });
});
