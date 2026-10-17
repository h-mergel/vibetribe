#!/usr/bin/env node
// Lists session files (Windows + WSL) with the ids needed for deep links. Ids only, no secrets.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dirs = process.argv.slice(2);
for (const dir of dirs) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (e) {
    console.log(`${dir}: ${e.code}`);
    continue;
  }
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!d.hostSessionId && !d.bridgeSessionId && d.status === undefined) continue;
      console.log([dir.includes("wsl") ? "WSL" : "WIN", d.pid, d.status, d.entrypoint, JSON.stringify(d.name ?? null), d.hostSessionId ?? "-", d.bridgeSessionId ?? "-"].join("\t"));
    } catch {
      // ignore
    }
  }
}
