#!/usr/bin/env node
// Measures liveness checks: wsl -l --running, WSL session dir + /proc/<pid>/stat, Windows Get-CimInstance.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const distro = process.argv[2] ?? "Ubuntu";
const user = process.argv[3] ?? process.env.USER ?? "h2k";

function time(label, fn) {
  const t0 = performance.now();
  try {
    const result = fn();
    console.log(`${label.padEnd(36)} ${(performance.now() - t0).toFixed(0)} ms`);
    return result;
  } catch (e) {
    console.log(`${label.padEnd(36)} ${(performance.now() - t0).toFixed(0)} ms  ERROR ${e.code ?? e.message}`);
    return null;
  }
}

const running = time("wsl -l --running --quiet", () =>
  execFileSync("wsl.exe", ["-l", "--running", "--quiet"], { encoding: "utf16le" })
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean),
);
console.log(`  running: ${JSON.stringify(running)}`);

const wslDir = `\\\\wsl.localhost\\${distro}\\home\\${user}\\.claude\\sessions`;
if (running?.includes(distro)) {
  // only <pid>.json — never read the .key files next to them
  const files = time("readdir WSL sessions", () => readdirSync(wslDir).filter((f) => f.endsWith(".json"))) ?? [];
  console.log(`  files: ${files.length}`);
  let checked = 0;
  time("read stat of up to 10 pids", () => {
    for (const f of files.slice(-10)) {
      const pid = Number.parseInt(f, 10);
      try {
        const data = JSON.parse(readFileSync(join(wslDir, f), "utf8"));
        const stat = readFileSync(`\\\\wsl.localhost\\${distro}\\proc\\${pid}\\stat`, "utf8");
        const starttime = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
        console.log(`  pid ${pid} alive starttime=${starttime} procStart=${data.procStart}`);
      } catch {
        console.log(`  pid ${pid} dead`);
      }
      checked++;
    }
  });
  console.log(`  checked ${checked}`);
}

const winDir = join(homedir(), ".claude", "sessions");
const winFiles = time("readdir Windows sessions", () => readdirSync(winDir).filter((f) => f.endsWith(".json"))) ?? [];
const winPids = [...new Set(winFiles.map((f) => Number.parseInt(f, 10)).filter(Number.isFinite))].slice(-10);
if (winPids.length > 0) {
  const filter = winPids.map((p) => `ProcessId=${p}`).join(" OR ");
  const out = time(`Get-CimInstance (${winPids.length} pids)`, () =>
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress`],
      { encoding: "utf8" },
    ),
  );
  console.log(`  ${out?.trim() ?? ""}`);
  for (const f of winFiles.slice(-10)) {
    try {
      const d = JSON.parse(readFileSync(join(winDir, f), "utf8"));
      console.log(`  win file ${f}: procStart=${d.procStart} startedAt=${d.startedAt}`);
    } catch {
      // ignore
    }
  }
}
