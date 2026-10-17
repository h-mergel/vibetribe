#!/usr/bin/env node
// PROBE ONLY (Plan 3d Task 1). Read-only GETs of the undocumented session list at the hub's
// planned pace: 15 calls, 20 s apart (about 5 min); stops at the first 429. Claude Desktop polls
// the same endpoint on the same account, so nothing faster is tried. Prints status codes, latency,
// rate-limit headers, counts and enum values only: never the token, titles, ids or other text.
// Usage: node rate.mjs <credentials.json> [<credentials.json> ...]
import { readFileSync } from "node:fs";

const URL_ = "https://api.anthropic.com/v1/code/sessions?limit=50";
const ID = /^session_[A-Za-z0-9]{1,64}$/;
const ENUM = /^[a-z_]{1,32}$/;
const CALLS = 15;
const SPACING_S = 20;

function pick(paths) {
  let best = null;
  for (const path of paths) {
    try {
      const o = JSON.parse(readFileSync(path, "utf8")).claudeAiOauth ?? {};
      if (typeof o.accessToken === "string" && Number.isFinite(o.expiresAt))
        if (!best || o.expiresAt > best.expiresAt)
          best = { path, token: o.accessToken, expiresAt: o.expiresAt };
    } catch {
      // missing or unreadable file
    }
  }
  return best;
}

const creds = pick(process.argv.slice(2));
if (!creds) {
  console.log("no usable credentials file");
  process.exit(1);
}
console.log(`using ${creds.path}, expiresAt ${new Date(creds.expiresAt).toISOString()}`);
if (creds.expiresAt <= Date.now() + 10 * 60_000) {
  console.log("token expired or expiring within 10 min: refresh it first, then run again");
  process.exit(2);
}

const enums = {};
const note = (field, v) => {
  if (typeof v !== "string") return;
  const counts = (enums[field] ??= {});
  const key = ENUM.test(v) ? v : "<other>";
  counts[key] = (counts[key] ?? 0) + 1;
};
// id -> last_event_at of idle/completed sessions; kept in memory only, never printed
const quietAt = new Map();

async function call() {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(URL_, {
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
        "User-Agent": `claude-code/${process.env.CLAUDE_VERSION || "2.1.287"}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { status: "network", ms: Date.now() - t0, name: err?.name ?? "error" };
  }
  const ms = Date.now() - t0;
  const headers = [];
  for (const [k, v] of res.headers) if (/ratelimit|retry-after/i.test(k)) headers.push(`${k}=${v}`);
  const out = { status: res.status, ms, headers };
  if (!res.ok) {
    await res.body?.cancel();
    return out;
  }
  try {
    const data = (await res.json()).data ?? [];
    out.total = data.length;
    out.connected = data.filter((s) => s?.connection_status === "connected").length;
    out.badIds = data.filter((s) => typeof s?.id !== "string" || !ID.test(s.id)).length;
    out.quiet = 0;
    out.quietChanged = 0;
    for (const s of data) {
      note("environment_kind", s?.environment_kind);
      note("connection_status", s?.connection_status);
      note("status", s?.status);
      note("status_bucket", s?.status_bucket);
      note("worker_status", s?.worker_status);
      note("status_category", s?.external_metadata?.post_turn_summary?.status_category);
      const quiet = s?.worker_status === "idle" && s?.status_bucket !== "blocked";
      if (!quiet || typeof s?.id !== "string") continue;
      out.quiet++;
      const prev = quietAt.get(s.id);
      if (prev !== undefined && prev !== s.last_event_at) out.quietChanged++;
      quietAt.set(s.id, s.last_event_at);
    }
  } catch {
    out.body = "not JSON";
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
for (let i = 0; i < CALLS; i++) {
  if (i > 0) await sleep(SPACING_S * 1000);
  const r = await call();
  rows.push(r);
  console.log(`#${i + 1}: ${JSON.stringify(r)}`);
  if (r.status === 429) break;
}
const limited = rows.some((r) => r.status === 429);
console.log(
  JSON.stringify(
    {
      spacingS: SPACING_S,
      calls: rows.length,
      limited,
      statuses: rows.map((r) => r.status),
      quietChangedTotal: rows.reduce((n, r) => n + (r.quietChanged ?? 0), 0),
      enums,
      recommendedIntervalS: limited ? 60 : 20,
    },
    null,
    2,
  ),
);
