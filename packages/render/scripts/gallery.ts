import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VARIANTS } from "../src/model";
import { svgToPng } from "../src/png";
import { render } from "../src/render";
import { GALLERY_SAMPLES } from "./samples";

/**
 * PNG gallery of every sample in both variants (comfortable first, the default), at 144 and 72 px, for
 * comparison with the Claude Design prototype: out/gallery/index.html.
 */
const OUT = join(process.cwd(), "out", "gallery");

const sections: string[] = [];
for (const variant of VARIANTS) {
  const dir = join(OUT, variant);
  mkdirSync(dir, { recursive: true });
  const cells: string[] = [];
  for (const [name, tile] of GALLERY_SAMPLES) {
    const svg = render(tile, { variant });
    writeFileSync(join(dir, `${name}.svg`), svg);
    writeFileSync(join(dir, `${name}.png`), svgToPng(svg));
    writeFileSync(join(dir, `${name}@72.png`), svgToPng(svg, 72));
    cells.push(
      `<figure><img src="${variant}/${name}.png" width="144" height="144"><img src="${variant}/${name}@72.png" width="72" height="72"><figcaption>${name}</figcaption></figure>`,
    );
  }
  sections.push(`<h2>${variant}</h2><div class="grid">${cells.join("")}</div>`);
}
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>VibeTribe Kacheln</title><style>body{background:#000;color:#ccc;font:14px sans-serif;padding:16px}.grid{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;display:grid;gap:4px;justify-items:center}</style>${sections.join("")}`,
);
console.log(`gallery: ${GALLERY_SAMPLES.length} tiles x ${VARIANTS.length} variants -> ${OUT}`);
