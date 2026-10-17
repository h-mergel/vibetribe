import { describe, expect, it } from "vitest";
import { LOCAL_BRIDGE_HOLD_MS, LocalBridges } from "../src/remote/local-bridges";

const T = 1_000_000;
const local = (bridge: string | null) => ({
  key: { host: "win", sessionId: `l-${bridge}` },
  bridgeSessionId: bridge,
});

describe("LocalBridges", () => {
  it("reports a change only when a local bridge id appears or vanishes", () => {
    const b = new LocalBridges();
    expect(b.note([local("session_01A")], T)).toBe(true);
    expect(b.note([local("session_01A")], T + 1_000)).toBe(false);
    expect(b.note([local("session_01A"), local(null)], T + 2_000)).toBe(false);
    expect(b.note([], T + 3_000)).toBe(true);
  });

  it("ignores remote sessions: their bridge id is the remote host's own", () => {
    const b = new LocalBridges();
    const remote = {
      key: { host: "remote", sessionId: "session_01R" },
      bridgeSessionId: "session_01R",
    };
    expect(b.note([remote], T)).toBe(false);
    expect(b.heldAt(T)).toEqual(new Set());
  });

  it("holds a bridge id for LOCAL_BRIDGE_HOLD_MS after its local session was last seen", () => {
    const b = new LocalBridges();
    b.note([local("session_01A")], T);
    b.note([], T + 5_000);
    expect(b.heldAt(T + LOCAL_BRIDGE_HOLD_MS - 1)).toEqual(new Set(["session_01A"]));
    expect(b.heldAt(T + LOCAL_BRIDGE_HOLD_MS)).toEqual(new Set());
  });
});
