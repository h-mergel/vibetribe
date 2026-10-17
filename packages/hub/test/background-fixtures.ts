import type { BackgroundRecord, HostSnapshot } from "@vibetribe/core";
import type { HookEnvelope } from "@vibetribe/protocol";
import type { BackgroundFile } from "../src/background/records";
import type { Hub } from "../src/hub";

/** Shared fixtures of the background restore tests. */
export const HOST = "wsl:Ubuntu";
export const KEY = { host: HOST, sessionId: "s1" };
export const T = 10_000_000;
export const saved: BackgroundRecord = {
  key: KEY,
  tasks: [
    { id: "b1", kind: "shell" },
    { id: "a1", kind: "agent" },
  ],
  changedAt: T - 60_000,
};
/** the file a hub wrote a minute before the restart */
export const savedFile: BackgroundFile = { savedAt: T - 60_000, records: [saved] };
export const info = {
  sessionId: "s1",
  pid: 7,
  cwd: "/tmp/p",
  entrypoint: "claude-desktop",
  name: "Anleitung",
  hostSessionId: null,
  bridgeSessionId: null,
  status: "idle" as const,
  waitingFor: null,
};
export const scan = (at: number, sessions: HostSnapshot["sessions"] = [info]): HostSnapshot => ({
  host: HOST,
  hostKind: "wsl",
  at,
  sessions,
});
export function hook(
  name: string,
  backgroundTasks: HookEnvelope["event"]["backgroundTasks"] = null,
) {
  return {
    v: 1,
    kind: "hook",
    source: { host: HOST, os: "wsl", distro: "Ubuntu", entrypoint: "claude-desktop" },
    session: { id: "s1", cwd: "/tmp/p", pid: 7, hostSessionId: null },
    event: {
      name,
      ts: 0,
      toolName: null,
      toolUseId: null,
      agentId: null,
      notificationType: null,
      errorType: null,
      reason: null,
      auto: null,
      backgroundTasks,
    },
  } satisfies HookEnvelope;
}
export const jobs = (hub: Hub, now: number) => hub.state(now).sessions[0]?.background;
