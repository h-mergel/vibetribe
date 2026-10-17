import type { CoreEvent, SessionFileInfo, SessionKey, SessionView } from "../src/types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EventInput = DistributiveOmit<CoreEvent, "key" | "hostKind">;

export const KEY: SessionKey = { host: "wsl:Ubuntu", sessionId: "s1" };

export function ev(
  e: EventInput,
  key: SessionKey = KEY,
  hostKind: CoreEvent["hostKind"] = "wsl",
): CoreEvent {
  return { key, hostKind, ...e } as CoreEvent;
}

export function file(over: Partial<SessionFileInfo> = {}): SessionFileInfo {
  return {
    sessionId: "s1",
    pid: 4242,
    cwd: "/home/heinrich/dev/projects/atlas",
    entrypoint: "cli",
    name: null,
    hostSessionId: null,
    bridgeSessionId: null,
    status: "idle",
    waitingFor: null,
    ...over,
  };
}

export function view(over: Partial<SessionView> = {}): SessionView {
  return {
    id: "wsl:Ubuntu/s1",
    key: KEY,
    hostKind: "wsl",
    badge: "WSL",
    title: "atlas",
    cwd: "/home/heinrich/dev/projects/atlas",
    state: "idle",
    detail: null,
    errorType: null,
    episodeSince: null,
    episodeSeen: true,
    background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
    pid: 4242,
    entrypoint: "cli",
    hostSessionId: null,
    bridgeSessionId: null,
    ...over,
  };
}
