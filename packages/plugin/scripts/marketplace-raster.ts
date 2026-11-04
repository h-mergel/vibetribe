import { crc32, deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

/** 8-bit RGBA, premultiplied, as resvg hands out its pixels. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Point = readonly [number, number];
/** Corners in the order top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point];
export type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function decodePng(png: Buffer): Raster {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<image href="data:image/png;base64,${png.toString("base64")}" width="${width}" height="${height}"/></svg>`;
  return { width, height, data: new Resvg(svg).render().pixels };
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body, crc32(head.subarray(4))), 0);
  return Buffer.concat([head, body, tail]);
}

/** Fast and large: the result only travels into the next render. */
export function encodePng({ width, height, data }: Raster): Buffer {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  let out = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (i % (width * 4) === 0) out++;
    const a = data[i + 3];
    const unit = a === 0 ? 0 : 255 / a;
    rows[out++] = Math.round(data[i] * unit);
    rows[out++] = Math.round(data[i + 1] * unit);
    rows[out++] = Math.round(data[i + 2] * unit);
    rows[out++] = a;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** For each output index, the input indexes it covers with the share of each. */
function coverage(from: number, to: number): { start: number; shares: number[] }[] {
  const step = from / to;
  return Array.from({ length: to }, (_, i) => {
    const low = i * step;
    const high = Math.min((i + 1) * step, from);
    const start = Math.floor(low);
    const shares: number[] = [];
    for (let s = start; s < high; s++)
      shares.push((Math.min(s + 1, high) - Math.max(s, low)) / step);
    return { start, shares };
  });
}

/** Area average down to `width`, which keeps fine text clean; a smaller raster stays as it is. */
export function shrinkToWidth(r: Raster, width: number): Raster {
  if (r.width <= width) return r;
  const height = Math.round((r.height * width) / r.width);
  const columns = coverage(r.width, width);
  const rows = coverage(r.height, height);
  const data = new Uint8Array(width * height * 4);
  const sum = [0, 0, 0, 0];
  let out = 0;
  for (const row of rows)
    for (const column of columns) {
      sum.fill(0);
      row.shares.forEach((rowShare, dy) => {
        const line = (row.start + dy) * r.width;
        column.shares.forEach((share, dx) => {
          const i = (line + column.start + dx) * 4;
          const w = rowShare * share;
          for (let c = 0; c < 4; c++) sum[c] += r.data[i + c] * w;
        });
      });
      for (let c = 0; c < 4; c++) data[out++] = Math.round(sum[c]);
    }
  return { width, height, data };
}

/** The projective map of the unit square onto `quad` (Heckbert's closed form). */
export function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]: Quad): Matrix {
  const [dx1, dx2, dx3] = [x1 - x2, x3 - x2, x0 - x1 + x2 - x3];
  const [dy1, dy2, dy3] = [y1 - y2, y3 - y2, y0 - y1 + y2 - y3];
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

export function invert([a, b, c, d, e, f, g, h, i]: Matrix): Matrix {
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
}

export function project([a, b, c, d, e, f, g, h, i]: Matrix, x: number, y: number): Point {
  const w = g * x + h * y + i;
  return [(a * x + b * y + c) / w, (d * x + e * y + f) / w];
}

/** Signed distance to the rounded unit square; negative inside. */
function roundedSquareDistance(u: number, v: number, radius: number): number {
  const qx = Math.abs(u - 0.5) - 0.5 + radius;
  const qy = Math.abs(v - 0.5) - 0.5 + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * Draws `tile` over `target` so its corners land on `quad`, clipped to a rounded square with
 * `radius` in tile widths: a perspective warp with bilinear sampling and an antialiased edge.
 */
export function warpTile(target: Raster, tile: Raster, quad: Quad, radius: number): void {
  const toTile = invert(squareToQuad(quad));
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const right = Math.min(target.width, Math.ceil(Math.max(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(target.height, Math.ceil(Math.max(...ys)));
  const pixelsPerTile = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const { width: tw, height: th, data: td } = tile;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const [u, v] = project(toTile, x + 0.5, y + 0.5);
      const cover = 0.5 - roundedSquareDistance(u, v, radius) * pixelsPerTile;
      if (cover <= 0) continue;
      const alpha = Math.min(cover, 1);
      const sx = Math.min(Math.max(u * tw - 0.5, 0), tw - 1);
      const sy = Math.min(Math.max(v * th - 0.5, 0), th - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, tw - 1);
      const y1 = Math.min(y0 + 1, th - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const sample = (c: number): number =>
        (td[(y0 * tw + x0) * 4 + c] * (1 - fx) + td[(y0 * tw + x1) * 4 + c] * fx) * (1 - fy) +
        (td[(y1 * tw + x0) * 4 + c] * (1 - fx) + td[(y1 * tw + x1) * 4 + c] * fx) * fy;
      const keep = 1 - (sample(3) / 255) * alpha;
      const i = (y * target.width + x) * 4;
      for (let c = 0; c < 4; c++)
        target.data[i + c] = Math.round(sample(c) * alpha + target.data[i + c] * keep);
    }
}
