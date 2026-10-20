import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { build } from "esbuild";
import { reporterBuild } from "../reporter/build.mjs";

const OUT = "dev.h2k.vibetribe.sdPlugin";

// The plugin carries the reporter inside its code and writes it out on setup: under the
// Marketplace DRM its own files may be encrypted, so it never reads its folder. Built in memory
// with the reporter's own options: reporter/dist belongs to the reporter's tests.
const bundled = await build({ ...reporterBuild, write: false });
const reporter = bundled.outputFiles[0].text;

// One file, SDK and ws included; the app's Node 24 runs it without node_modules.
await build({
  entryPoints: ["src/plugin.ts"],
  outfile: `${OUT}/bin/plugin.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // optional native accelerators of ws; absent at runtime, ws falls back to JS
  external: ["bufferutil", "utf-8-validate"],
  define: { __REPORTER_SOURCE__: JSON.stringify(reporter) },
  // ws is CommonJS and require()s node built-ins; an ESM bundle needs a real require for them
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  logLevel: "warning",
});
writeFileSync(`${OUT}/bin/package.json`, '{ "type": "module" }\n');

// The manifest's plugin icon must be a PNG (Elgato validator): 256 px plus the @2x variant.
const svg = readFileSync(`${OUT}/imgs/plugin/marketplace.svg`, "utf8");
for (const [suffix, width] of [
  ["", 256],
  ["@2x", 512],
]) {
  writeFileSync(
    `${OUT}/imgs/plugin/marketplace${suffix}.png`,
    new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng(),
  );
}
