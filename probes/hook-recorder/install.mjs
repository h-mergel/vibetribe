#!/usr/bin/env node
// Usage: node install.mjs <settings.json> install|uninstall [--sync] [--shell]
// install: adds the recorder to all events (backup first, atomic write). uninstall: removes only probe entries.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [, , settingsPath, action, ...flags] = process.argv;
if (!settingsPath || !["install", "uninstall"].includes(action)) {
  console.error("usage: node install.mjs <settings.json> install|uninstall [--sync] [--shell]");
  process.exit(2);
}
const EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest",
  "Notification", "Elicitation", "ElicitationResult", "Stop", "StopFailure", "SubagentStart", "SubagentStop",
  "PreCompact", "SessionEnd", "TaskCreated", "TaskCompleted",
];
const MARK = "vibetribe-probe";
const sync = flags.includes("--sync");
const shell = flags.includes("--shell");
const node = process.execPath.replaceAll("\\", "/");
// Copy the recorder to a local dir of this platform, so Windows hooks never load scripts via \\wsl.localhost.
const binDir = join(homedir(), ".vibetribe-probe", "bin");
mkdirSync(binDir, { recursive: true });
for (const f of ["record.mjs", "redact.mjs"]) copyFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), join(binDir, f));
const recorder = join(binDir, "record.mjs").replaceAll("\\", "/");
const mode = `${sync ? "sync" : "async"}-${shell ? "shell" : "exec"}`;

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
settings.hooks ??= {};
for (const event of EVENTS) {
  const groups = (settings.hooks[event] ?? []).filter((g) => !JSON.stringify(g).includes(MARK));
  if (action === "install") {
    const hook = shell
      ? { type: "command", command: `"${node}" "${recorder}" ${mode} ${MARK}`, timeout: 5 }
      : { type: "command", command: node, args: [recorder, mode, MARK], timeout: 5 };
    // SessionEnd stays synchronous: an async hook may be killed when the session exits
    if (!sync && event !== "SessionEnd") hook.async = true;
    groups.push({ hooks: [hook] });
  }
  if (groups.length > 0) settings.hooks[event] = groups;
  else delete settings.hooks[event];
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.probe-${Date.now()}.bak`);
const tmp = `${settingsPath}.tmp`;
writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
renameSync(tmp, settingsPath);
console.log(`${action} ${action === "install" ? mode : ""} -> ${settingsPath}`);
