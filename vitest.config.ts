import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // no test, and no process a test spawns, may reach or bind the ports of the real hub
    setupFiles: ["test/real-ports-guard.mjs"],
  },
});
