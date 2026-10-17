#!/usr/bin/env node
// PROBE ONLY. Appends one redacted hook event per line to ~/.vibetribe-probe/events.jsonl.
// Never writes to stdout, always exits 0.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { redact } from "./redact.mjs";

const procStartedAt = Date.now();
const ENV_KEYS = ["WT_SESSION", "WSLENV", "WSL_DISTRO_NAME", "TERM_PROGRAM", "CLAUDE_CODE_ENTRYPOINT", "CLAUDECODE"];

function pickEnv(env) {
  const out = {};
  for (const k of ENV_KEYS) if (env[k] !== undefined) out[k] = env[k];
  out.claudeKeys = Object.keys(env).filter((k) => k.startsWith("CLAUDE")).sort();
  return out;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    const dir = join(homedir(), ".vibetribe-probe");
    mkdirSync(dir, { recursive: true });
    const line = {
      receivedAt: Date.now(),
      procStartedAt,
      mode: process.argv[2] ?? "unknown",
      host: hostname(),
      platform: process.platform,
      ppid: process.ppid,
      env: pickEnv(process.env),
      payload: redact(JSON.parse(raw || "{}")),
    };
    appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(line)}\n`);
  } catch {
    // a probe must never break Claude
  }
  process.exit(0);
});
