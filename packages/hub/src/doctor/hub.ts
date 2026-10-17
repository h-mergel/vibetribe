import { DESKTOP_ENTRYPOINT, isDesktopId, parsePortNumber } from "@vibetribe/protocol";
import type { HubState } from "../state";
import { type CheckResult, changed, isShapeError, ok, skipped } from "./check";

type Range = readonly [number, number];

/** "44620\t48715" from /proc/sys/net/ipv4/ip_local_port_range; null for anything else. */
export function parsePortRange(text: string): Range | null {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Every "start end" row of `netsh int ipv4 show excludedportrange protocol=tcp`, in any language. */
export function parseExcludedRanges(text: string): Range[] {
  const out: Range[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\b/.exec(line);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

const within = (port: number, [from, to]: Range): boolean => port >= from && port <= to;

/**
 * Our ports against WSL's reserved block (mirrored networking reserves `ip_local_port_range` on the
 * Windows side too) and Windows' excluded ranges. Drift: no port is free, or more than one port is
 * blocked (the fallback ports are spaced so one block cannot cover two).
 */
export function checkPorts(
  ports: readonly number[],
  wsl: Range | null,
  excluded: readonly Range[],
): CheckResult {
  const blocked: string[] = [];
  const free: number[] = [];
  for (const port of ports) {
    const range = excluded.find((r) => within(port, r));
    if (wsl && within(port, wsl)) blocked.push(`${port} in the WSL range ${wsl[0]}–${wsl[1]}`);
    else if (range) blocked.push(`${port} excluded by Windows (${range[0]}–${range[1]})`);
    else free.push(port);
  }
  const why = blocked.join(", ");
  if (free.length === 0) return changed("ports", `no port free: ${why}`);
  if (blocked.length > 1) return changed("ports", `more than one port blocked: ${why}`);
  const wslPart = wsl ? `WSL range ${wsl[0]}–${wsl[1]}` : "WSL range unknown";
  return ok("ports", `${free[0]} free; ${why || wslPart}`);
}

/** The port file names the port the hub listens on (`hubPort`: null = no hub found). */
export function checkPortFile(text: string | null, hubPort: number | null): CheckResult {
  if (hubPort === null) return skipped("port file", "no hub running");
  const filePort = text === null ? null : parsePortNumber(text.trim());
  if (filePort === null)
    return changed("port file", `missing or invalid; the hub listens on ${hubPort}`);
  if (filePort !== hubPort)
    return changed("port file", `says ${filePort}, the hub listens on ${hubPort}`);
  return ok("port file", String(hubPort));
}

/**
 * A source whose reply no longer has its shape is drift; any other error (rate limit, login,
 * network, a stopped distro, a taken port) passes, named by its source only: texts can hold paths.
 */
function checkSources(state: HubState): CheckResult {
  const failing = Object.entries(state.sources).filter(([, h]) => h.error !== null);
  const reshaped = failing.filter(([, h]) => isShapeError(h.error ?? "")).map(([s]) => s);
  if (reshaped.length > 0)
    return changed("hub sources", `replies no longer have their shape: ${reshaped.join(", ")}`);
  const total = `sources: ${Object.keys(state.sources).length}`;
  const passing = failing.map(([s]) => s).join(", ");
  return ok("hub sources", passing ? `${total}, with a passing error: ${passing}` : total);
}

function checkDesktopIds(state: HubState): CheckResult {
  const desktop = state.sessions.filter((s) => s.entrypoint === DESKTOP_ENTRYPOINT);
  if (desktop.length === 0)
    return skipped("desktop ids in hub", "no Claude Desktop session running");
  const without = desktop.filter((s) => s.hostSessionId === null || !isDesktopId(s.hostSessionId));
  if (without.length > 0)
    return changed(
      "desktop ids in hub",
      `Claude Desktop sessions without one: ${without.length} of ${desktop.length}`,
    );
  return ok("desktop ids in hub", `Claude Desktop sessions: ${desktop.length}`);
}

function checkPins(state: HubState, configPins: string[] | null): CheckResult {
  if (configPins === null) return skipped("pins in hub", "Claude Desktop's pins unknown");
  const shared = configPins.filter((id) => state.pins.includes(id)).length;
  if (shared < configPins.length || state.pins.length > configPins.length)
    return changed(
      "pins in hub",
      `the hub has ${state.pins.length} pins, Claude Desktop ${configPins.length}, shared ${shared}`,
    );
  return ok("pins in hub", `same pins as Claude Desktop: ${shared}`);
}

/**
 * What the running hub made of it all (`/debug/state.json`): no reshaped reply, a Desktop id for every
 * live Claude Desktop session, and the same pins as Desktop's config (`configPins`, null = unknown).
 */
export function checkHubState(state: HubState | null, configPins: string[] | null): CheckResult[] {
  if (state === null)
    return ["hub sources", "desktop ids in hub", "pins in hub"].map((n) =>
      skipped(n, "no hub running"),
    );
  return [checkSources(state), checkDesktopIds(state), checkPins(state, configPins)];
}
