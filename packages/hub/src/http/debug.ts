import type { HubState } from "../state";
import { clock, esc } from "./html";
import { KEYS_PAGE_CSS, type MirrorRead, renderKeysSection } from "./keys";

/** Server-rendered, auto-refreshing overview for humans; machines read /debug/state.json. */
export function renderDebugHtml(
  state: HubState,
  timeZone?: string,
  mirror: MirrorRead = null,
): string {
  /** the place in Claude Desktop's sidebar, counted from 1 */
  const pin = (hostSessionId: string | null): string => {
    const i = hostSessionId === null ? -1 : state.pins.indexOf(hostSessionId);
    return i < 0 ? "–" : String(i + 1);
  };
  const sessions = state.sessions
    .map(
      (s) =>
        `<tr><td>${esc(s.badge)}</td><td>${esc(s.title)}</td><td>${esc(s.state)}</td><td>${esc(s.detail)}</td><td>${s.background.count}</td><td>${esc(s.key.host)}</td><td>${s.pid ?? "–"}</td><td>${clock(s.episodeSince, timeZone)}</td><td>${pin(s.hostSessionId)}</td></tr>`,
    )
    .join("");
  const sources = Object.entries(state.sources)
    .map(
      ([name, h]) =>
        `<tr><td>${esc(name)}</td><td>${h.health}</td><td>${clock(h.lastAt, timeZone)}</td><td>${esc(h.error)}</td></tr>`,
    )
    .join("");
  const recent = [...state.recent]
    .reverse()
    .map(
      (r) =>
        `<tr><td>${clock(r.at, timeZone)}</td><td>${esc(r.host)}</td><td>${esc(r.sessionId.slice(0, 8))}</td><td>${esc(r.name)}</td></tr>`,
    )
    .join("");
  const l = state.limits;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>VibeTribe Hub</title>
<style>${KEYS_PAGE_CSS}table{border-collapse:collapse;margin-bottom:16px}td,th{border:1px solid #333;padding:3px 8px;text-align:left}h2{font-size:14px}</style>
<h2>Keys (<a href="/debug/keys">mirror</a>, <a href="/debug/keys.json">JSON</a>)</h2>${renderKeysSection(mirror, timeZone)}
<h2>Sessions (${state.sessions.length})</h2><table><tr><th>Origin</th><th>Title</th><th>State</th><th>Detail</th><th>Background</th><th>Host</th><th>PID</th><th>Episode since</th><th>Pin</th></tr>${sessions}</table>
<h2>Limits</h2><p>5h: ${l.fiveHour ? `${Math.round(l.fiveHour.usedPct)} %` : "–"} · Week: ${l.sevenDay ? `${Math.round(l.sevenDay.usedPct)} %` : "–"} · Extra: ${l.extra ? `${l.extra.usedCredits} / ${l.extra.monthlyLimit ?? "–"} ${esc(l.extra.currency)} (${l.extra.enabled ? "on" : "off"})` : "–"} · Auth: ${l.auth}</p>
<h2>Sources</h2><table><tr><th>Source</th><th>State</th><th>Last</th><th>Error</th></tr>${sources}</table>
<h2>Recent events (invalid envelopes: ${state.invalidEnvelopes})</h2><table><tr><th>Time</th><th>Host</th><th>Session</th><th>Event</th></tr>${recent}</table>`;
}
