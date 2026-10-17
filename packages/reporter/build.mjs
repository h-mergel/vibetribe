import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/reporter.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
