#!/usr/bin/env node
// Prints payload keys per event and a timeline per session from events.jsonl.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file = process.argv[2] ?? join(homedir(), ".vibetribe-probe", "events.jsonl");
const rows = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => r.mode !== "bench" && r.mode !== "dry"); // benchmark and dry-run lines are not real sessions
const keysByEvent = new Map();
const bySession = new Map();
for (const r of rows) {
  const p = r.payload;
  const name = p.hook_event_name ?? "?";
  const keys = keysByEvent.get(name) ?? new Set();
  for (const k of Object.keys(p)) keys.add(k);
  keysByEvent.set(name, keys);
  const list = bySession.get(p.session_id) ?? [];
  list.push(r);
  bySession.set(p.session_id, list);
}
console.log("## Payload keys per event");
for (const [name, keys] of [...keysByEvent].sort()) console.log(`- ${name}: ${[...keys].sort().join(", ")}`);
for (const [sid, list] of bySession) {
  list.sort((a, b) => a.receivedAt - b.receivedAt);
  const first = list[0];
  console.log(
    `\n## Session ${sid} (${first.host}, ${first.platform}, mode ${first.mode}, CLAUDE_CODE_ENTRYPOINT=${first.env.CLAUDE_CODE_ENTRYPOINT ?? "-"}, WT_SESSION=${first.env.WT_SESSION ? "yes" : "no"})`,
  );
  for (const r of list) {
    const p = r.payload;
    const bits = [
      p.tool_name,
      p.notification_type,
      p.error,
      p.reason,
      p.tool_use_id ? `tool_use_id=${p.tool_use_id}` : null,
      p.agent_id ? `agent_id=${p.agent_id}` : null,
      Array.isArray(p.background_tasks) ? `background_tasks=${JSON.stringify(p.background_tasks)}` : null,
      `startup=${r.receivedAt - r.procStartedAt}ms`,
    ].filter(Boolean);
    console.log(`  +${String(r.receivedAt - first.receivedAt).padStart(7)}ms ${p.hook_event_name} ${bits.join(" | ")}`);
  }
}
