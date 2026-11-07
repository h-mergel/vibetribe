import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { svgToPng } from "@vibetribe/render/png";
import { describe, expect, it } from "vitest";
import { DEVICE_HEIGHT, DEVICE_WIDTH } from "../scripts/marketplace-deck";
import {
  appIconSvg,
  deviceImagePath,
  galleryPng,
  setupSvg,
  updateReadmeSetup,
  writeMedia,
} from "../scripts/marketplace-media";

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
const device = red(DEVICE_WIDTH / 20, DEVICE_HEIGHT / 20);

describe("marketplace media", () => {
  it("fits any picture into 1920×960 and draws it, not only the background", () => {
    const tall = galleryPng(red(10, 40));
    expect(size(tall)).toEqual([1920, 960]);
    expect(size(galleryPng(red(40, 10)))).toEqual([1920, 960]);
    expect(tall.equals(galleryPng(Buffer.alloc(0)))).toBe(false);
  });

  it("with a device image writes the thumbnail, the gallery and the 288 px icon", () => {
    const out = mkdtempSync(join(tmpdir(), "vt-media-"));
    const image = join(out, "device.png");
    writeFileSync(image, device);
    const { written, skipped } = writeMedia(repo, join(out, "media"), image);
    const pictures = ["thumbnail.png", "gallery-1-deck.png", "gallery-2-tiles.png"];
    expect(skipped).toBeNull();
    expect([...written].sort()).toEqual([...pictures, "gallery-3-setup.png", "icon.png"].sort());
    expect(readdirSync(join(out, "media")).sort()).toEqual([...written].sort());
    for (const name of [...pictures, "gallery-3-setup.png"])
      expect(size(readFileSync(join(out, "media", name)))).toEqual([1920, 960]);
    expect(size(readFileSync(join(out, "media", "icon.png")))).toEqual([288, 288]);
    const thumbnail = readFileSync(join(out, "media", "thumbnail.png"));
    const gallery = readFileSync(join(out, "media", "gallery-1-deck.png"));
    expect(thumbnail.equals(gallery)).toBe(false);
  }, 30_000);

  it("without the device image skips only the two device images and says why", () => {
    const out = mkdtempSync(join(tmpdir(), "vt-media-"));
    const missing = join(out, "no-such-device.png");
    const { written, skipped } = writeMedia(repo, join(out, "media"), missing);
    expect(skipped?.names).toEqual(["thumbnail.png", "gallery-1-deck.png"]);
    expect(skipped?.reason).toContain(missing);
    expect(skipped?.reason).toContain("VIBETRIBE_DEVICE_IMAGE");
    expect(written).toEqual(["gallery-2-tiles.png", "gallery-3-setup.png", "icon.png"]);
    expect(readdirSync(join(out, "media")).sort()).toEqual([...written].sort());
  }, 30_000);

  it("the README's setup picture is the setup image the media step just wrote", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "vt-readme-"));
    const out = mkdtempSync(join(tmpdir(), "vt-media-"));
    mkdirSync(join(repoDir, "docs", "readme"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "readme", "setup.png"), "old");
    writeFileSync(join(out, "gallery-3-setup.png"), "new");
    const path = updateReadmeSetup(repoDir, out, true);
    expect(path).toBe(join(repoDir, "docs", "readme", "setup.png"));
    expect(readFileSync(join(repoDir, "docs", "readme", "setup.png"), "utf8")).toBe("new");
  });

  it("leaves the README's setup picture alone without the fonts it was drawn with", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "vt-readme-"));
    const out = mkdtempSync(join(tmpdir(), "vt-media-"));
    mkdirSync(join(repoDir, "docs", "readme"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "readme", "setup.png"), "old");
    writeFileSync(join(out, "gallery-3-setup.png"), "new");
    expect(updateReadmeSetup(repoDir, out, false)).toBeNull();
    expect(readFileSync(join(repoDir, "docs", "readme", "setup.png"), "utf8")).toBe("old");
  });

  it("takes the device image from the environment, else from assets-local", () => {
    expect(deviceImagePath("/repo", { VIBETRIBE_DEVICE_IMAGE: "/x/shot.png" })).toBe("/x/shot.png");
    expect(deviceImagePath("/repo", {})).toBe(join("/repo", "assets-local", "mk2-front.png"));
  });

  it("the app icon shows the circle of the plugin icon and the bold word", () => {
    const logo = readFileSync(
      join(repo, "packages/plugin/dev.h2k.vibetribe.sdPlugin/imgs/plugin/marketplace.svg"),
      "utf8",
    );
    const circles = logo.match(/<circle [^>]*\/>/g) ?? [];
    expect(circles).toHaveLength(6);
    const svg = appIconSvg(logo);
    for (const c of circles) expect(svg).toContain(c);
    expect(svg).toMatch(/font-weight="bold"[^>]*>VibeTribe</);
    expect(svg).toContain('width="288" height="288"');
  });

  it("the setup drawing shows its text", () => {
    const svg = setupSvg();
    const blank = svg.replace(/<text[\s\S]*?<\/text>/g, "");
    expect(blank).not.toBe(svg);
    expect(svgToPng(svg).equals(svgToPng(blank))).toBe(false);
  });
});
