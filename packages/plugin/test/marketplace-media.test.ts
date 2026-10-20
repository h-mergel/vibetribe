import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { galleryPng, MEDIA, writeMedia } from "../scripts/marketplace-media";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
/** width and height from a PNG's IHDR */
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const red = (w: number, h: number) =>
  Buffer.from(
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="red"/></svg>`,
    )
      .render()
      .asPng(),
  );

describe("marketplace media", () => {
  it("fits any picture into 1920×960 and draws it, not only the background", () => {
    const tall = galleryPng(red(10, 40), "image/png");
    expect(size(tall)).toEqual([1920, 960]);
    expect(size(galleryPng(red(40, 10), "image/png"))).toEqual([1920, 960]);
    expect(tall.equals(galleryPng(Buffer.alloc(0), "image/png"))).toBe(false);
  });

  it("writes the thumbnail, four gallery images and the 288 px icon from the README pictures", () => {
    const out = mkdtempSync(join(tmpdir(), "vt-media-"));
    const names = writeMedia(repo, out);
    expect(names).toEqual([...MEDIA.map(([name]) => name), "icon.png"]);
    expect(readdirSync(out).sort()).toEqual([...names].sort());
    for (const [name] of MEDIA) expect(size(readFileSync(join(out, name)))).toEqual([1920, 960]);
    expect(size(readFileSync(join(out, "icon.png")))).toEqual([288, 288]);
  }, 30_000);
});
