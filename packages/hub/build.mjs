import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/hub.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
});
