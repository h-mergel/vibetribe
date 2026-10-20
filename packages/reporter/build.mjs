import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * One file with only `node:` imports, for Node 20 and later (WSL may run an older Node than
 * Windows). The plugin builds the same in memory and carries it as text.
 */
export const reporterBuild = {
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await build({ ...reporterBuild, outfile: "dist/reporter.mjs" });
}
