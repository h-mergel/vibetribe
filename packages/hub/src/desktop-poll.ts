import { needsAttention, type SessionView } from "@vibetribe/core";
import type { Hub } from "./hub";

/** How often Claude Desktop's pins and the focus of sessions waiting to be seen are read again. */
export const DESKTOP_POLL_MS = 5_000;

/** Claude Desktop's own state, only ever read; a null port is not read. */
export interface DesktopPorts {
  /** the pins in sidebar order; null = unreadable just now (the last ones stay) */
  pins: (() => Promise<string[] | null>) | null;
  /** when Claude Desktop last showed each of these sessions (ms since epoch); unknown ids are missing */
  focus: ((desktopIds: readonly string[]) => Promise<ReadonlyMap<string, number>>) | null;
}

type DesktopSession = SessionView & { hostSessionId: string };

/**
 * Reads Claude Desktop's state now and every DESKTOP_POLL_MS, for as long as `later` schedules. A
 * local session that Desktop showed after its unseen episode began counts as seen, exactly as after
 * a jump from the deck. A failing port is logged and the loop goes on.
 */
export function pollDesktop(o: {
  hub: Hub;
  ports: DesktopPorts;
  now: () => number;
  log: (line: string) => void;
  later: (ms: number, fn: () => void) => unknown;
}): void {
  const { hub, ports, now, log } = o;
  /** only the Desktop files of these sessions are read */
  const waiting = (at: number): DesktopSession[] =>
    hub
      .state(at)
      .sessions.filter((s): s is DesktopSession => s.hostSessionId !== null && needsAttention(s));
  const seeFocused = async (focus: NonNullable<DesktopPorts["focus"]>): Promise<void> => {
    const ids = waiting(now()).map((s) => s.hostSessionId);
    if (ids.length === 0) return;
    const focusedAt = await focus(ids);
    // compared after the read: an episode that began meanwhile is not the one the user saw
    const at = now();
    let seen = 0;
    for (const s of waiting(at)) {
      const f = focusedAt.get(s.hostSessionId);
      // a focus later than now is clock skew: it must not see episodes that have not begun yet
      if (f === undefined || s.episodeSince === null || f <= s.episodeSince || f > at) continue;
      hub.markSeen(s, at);
      seen++;
    }
    if (seen > 0) log(`seen in Claude Desktop: ${seen}`);
  };
  const poll = async (): Promise<void> => {
    if (ports.pins) {
      try {
        const pins = await ports.pins();
        if (pins !== null) hub.ingestPins(pins);
      } catch (err) {
        log(`desktop pins failed: ${String(err)}`);
      }
    }
    if (ports.focus) {
      try {
        await seeFocused(ports.focus);
      } catch (err) {
        log(`desktop focus failed: ${String(err)}`);
      }
    }
    o.later(DESKTOP_POLL_MS, () => void poll());
  };
  void poll();
}
