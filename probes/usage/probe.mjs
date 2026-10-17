#!/usr/bin/env node
// PROBE ONLY. One call to the undocumented usage endpoint. Prints status, rate-limit headers and the
// response SHAPE (no token, no free text). Usage: node probe.mjs <credentials.json> [<credentials.json> ...]
import { readFileSync, statSync } from "node:fs";
import { describeShape } from "./shape.mjs";

const candidates = process.argv
  .slice(2)
  .map((path) => {
    try {
      return { path, mtime: statSync(path).mtimeMs };
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((a, b) => b.mtime - a.mtime);
if (candidates.length === 0) {
  console.log("no credentials file found");
  process.exit(1);
}
const chosen = candidates[0];
const creds = JSON.parse(readFileSync(chosen.path, "utf8"));
const oauth = creds.claudeAiOauth ?? {};
console.log(`using ${chosen.path} (modified ${new Date(chosen.mtime).toISOString()}), keys: ${Object.keys(oauth).sort().join(", ")}`);
console.log(`expiresAt: ${oauth.expiresAt ? new Date(oauth.expiresAt).toISOString() : "-"}`);
if (!oauth.accessToken) {
  console.log("no accessToken field");
  process.exit(1);
}
const version = process.env.CLAUDE_VERSION || "2.1.287";
const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
  headers: {
    Authorization: `Bearer ${oauth.accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": `claude-code/${version}`,
  },
});
console.log(`status ${res.status}`);
for (const [k, v] of res.headers) if (/ratelimit|retry-after/i.test(k)) console.log(`header ${k}: ${v}`);
const body = await res.text();
try {
  console.log(JSON.stringify(describeShape(JSON.parse(body)), null, 2));
} catch {
  console.log(`non-JSON body, ${body.length} chars`);
}
