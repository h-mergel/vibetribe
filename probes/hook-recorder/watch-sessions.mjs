#!/usr/bin/env node
// PROBE ONLY. Polls the sessions dir every second and logs status changes (no secrets, ids only).
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = process.argv[2] ?? join(homedir(), ".claude", "sessions");
const outDir = join(homedir(), ".vibetribe-probe");
mkdirSync(outDir, { recursive: true });
const last = new Map();
const FIELDS = ["sessionId", "pid", "status", "waitingFor", "entrypoint", "name", "hostSessionId", "bridgeSessionId", "statusUpdatedAt", "procStart", "startedAt", "version"];

setInterval(() => {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const picked = Object.fromEntries(FIELDS.filter((k) => k in data).map((k) => [k, data[k]]));
      picked.allKeys = Object.keys(data).sort();
      const sig = JSON.stringify([picked.status, picked.waitingFor, picked.name, picked.bridgeSessionId]);
      if (last.get(f) === sig) continue;
      last.set(f, sig);
      appendFileSync(join(outDir, "sessions.jsonl"), `${JSON.stringify({ at: Date.now(), file: f, ...picked })}\n`);
    } catch {
      // file vanished or half-written
    }
  }
}, 1_000);
console.log(`watching ${dir} -> ${join(outDir, "sessions.jsonl")} (Ctrl+C to stop)`);
