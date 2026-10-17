#!/usr/bin/env node
// Measures the wall time of one recorder invocation: direct (exec form) vs. through a shell.
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// the locally installed copy (Task 2, Step 1) — the same file the hooks run
const recorder = join(homedir(), ".vibetribe-probe", "bin", "record.mjs");
const input = JSON.stringify({ session_id: "bench", hook_event_name: "PreToolUse", tool_name: "Read" });
const runs = Number(process.argv[2] ?? 20);

function measure(label, cmd, args, opts = {}) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(cmd, args, { input, stdio: ["pipe", "ignore", "ignore"], ...opts });
    if (r.error || r.status !== 0) {
      console.log(`${label.padEnd(28)} FAILED: ${r.error?.code ?? `exit ${r.status}`}`);
      return;
    }
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p90 = times[Math.floor(times.length * 0.9)];
  console.log(`${label.padEnd(28)} median ${median.toFixed(0)} ms  p90 ${p90.toFixed(0)} ms`);
}

measure("exec (node direct)", process.execPath, [recorder, "bench", "vibetribe-probe"]);
if (process.platform === "win32") {
  // Git Bash next to git.exe (NOT system32\bash.exe, which is the WSL launcher)
  const gitExe = execFileSync("where.exe", ["git.exe"], { encoding: "utf8" }).split(/\r?\n/)[0];
  const gitBash = join(dirname(dirname(gitExe)), "bin", "bash.exe");
  console.log(`git bash: ${gitBash}`);
  measure("shell (Git Bash)", gitBash, ["-c", `"${process.execPath.replaceAll("\\", "/")}" "${recorder.replaceAll("\\", "/")}" bench vibetribe-probe`]);
  measure("shell (powershell)", "powershell.exe", ["-NoProfile", "-Command", `& '${process.execPath}' '${recorder}' bench vibetribe-probe`]);
} else {
  measure("shell (sh -c)", "/bin/sh", ["-c", `"${process.execPath}" "${recorder}" bench vibetribe-probe`]);
}
