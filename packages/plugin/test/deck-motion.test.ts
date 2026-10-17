import { describe, expect, it } from "vitest";
import { STATUS_EXPANDED_MS } from "../src/deck/deck";
import { contentSignature } from "../src/deck/frame";
import type { KeyPlacement } from "../src/deck/keys";
import { WORKING_TICK_MS } from "../src/deck/motion";
import { deckHarness, hubState, session, slot, T0, view, waiting } from "./helpers";

const INBOX = "mk2:0:0";
const STATUS = "mk2:0:4";
const deck = (o: Parameters<typeof deckHarness>[0] = {}) => deckHarness({ max: 100, ...o });

/** The user's page 1 ("Mischform"): six slots, foreign keys are not ours and missing here. */
function mischform(device = "mk2"): KeyPlacement[] {
  const k = (role: KeyPlacement["role"], row: number, column: number): KeyPlacement => ({
    id: `${device}:${row}:${column}`,
    role,
    device,
    row,
    column,
  });
  return [
    k("limit5h", 0, 1),
    k("limitWeek", 0, 2),
    k("inbox", 0, 3),
    k("status", 0, 4),
    k("extra", 1, 0),
    k("slot", 1, 1),
    k("slot", 1, 2),
    k("slot", 1, 3),
    k("slot", 1, 4),
    k("slot", 2, 1),
    k("slot", 2, 2),
  ];
}

describe("Deck working dots", () => {
  it("moves the lit dot of a working key every 2 s", () => {
    const { d, svgOf } = deck();
    d.update(hubState({ sessions: [session("w", { state: "working" })] }), [], T0);
    d.tick(T0);
    expect(svgOf(slot(1))).toContain('data-tick="0"');
    d.tick(T0 + WORKING_TICK_MS);
    expect(svgOf(slot(1))).toContain('data-tick="1"');
  });

  it("holds the dots while breathing and clocks fill the budget", () => {
    const { d, svgOf } = deck({ max: 10 });
    const sessions = [
      waiting("a", T0),
      waiting("b", T0),
      session("c", { state: "done_unseen", episodeSince: T0 - 5_000, episodeSeen: false }),
      session("w", { state: "working" }),
    ];
    d.update(hubState({ sessions }), [], T0);
    // without the guard the dot would stand on 2 after 4 s
    for (let t = T0; t <= T0 + 4_000; t += 250) d.tick(t);
    const working = [1, 2, 3, 4].map(slot).find((id) => svgOf(id).includes("vt-work-tick"));
    expect(working).toBeDefined();
    expect(svgOf(working ?? "")).toContain('data-tick="0"');
  });
});

describe("Deck status key", () => {
  it("a tap shows all four sources for 5 s, a hold opens the diagnostics", () => {
    const { d, svgOf } = deck();
    d.update(hubState(), [], T0);
    d.tick(T0);
    expect(svgOf(STATUS)).toContain("Sources ok");
    expect(d.press(STATUS, "short", T0 + 1_000)).toEqual([]);
    d.tick(T0 + 1_000);
    for (const src of ["WIN", "WSL", "REM", "LIM"])
      expect(svgOf(STATUS)).toContain(`vt-status-${src}`);
    d.tick(T0 + 1_000 + STATUS_EXPANDED_MS);
    expect(svgOf(STATUS)).toContain("Sources ok");
    expect(d.press(STATUS, "long", T0 + 10_000)).toEqual([{ type: "open_debug" }]);
  });
});

describe("Deck inbox key", () => {
  it("shows the position while cycling and the wait of the next session", () => {
    const { d, svgOf } = deck();
    const a = waiting("a", T0 - 42_000);
    const b = session("b", { state: "done_unseen", episodeSince: T0 - 90_000, episodeSeen: false });
    d.update(hubState({ sessions: [a, b] }), [], T0);
    d.tick(T0);
    expect(svgOf(INBOX)).toMatch(/id="vt-top-clock"[^>]*>42</);
    d.press(INBOX, "short", T0 + 100);
    d.tick(T0 + 100);
    expect(svgOf(INBOX)).toContain('id="vt-cycle"');
    expect(svgOf(INBOX)).toMatch(/id="vt-count-of"[^>]*>\/2</);
    d.tick(T0 + 5_100);
    expect(svgOf(INBOX)).not.toContain('id="vt-cycle"');
  });

  it("while cycling shows the session the press jumped to, not the most urgent one", () => {
    const { d, svgOf } = deck();
    const a = waiting("a", T0 - 42_000);
    const b = session("b", { state: "done_unseen", episodeSince: T0 - 90_000, episodeSeen: false });
    d.update(hubState({ sessions: [a, b] }), [], T0);
    d.press(INBOX, "short", T0 + 100);
    d.press(INBOX, "short", T0 + 200);
    d.tick(T0 + 200);
    // second press: session b, position 2 of 2, its state word
    expect(svgOf(INBOX)).toMatch(/id="vt-count"[^>]*>2</);
    expect(svgOf(INBOX)).toMatch(/id="vt-top-word"[^>]*>Done</);
    // once the press feedback is over (2 s "No link"), its clock: 1 min 32 s -> "1 min"
    d.tick(T0 + 2_300);
    expect(svgOf(INBOX)).toMatch(/id="vt-top-clock"[^>]*>1</);
    // b stops waiting inside the window: the inbox falls back to the most urgent session
    d.update(hubState({ sessions: [a, session("b", { state: "idle" })] }), [], T0 + 2_400);
    d.tick(T0 + 2_400);
    expect(svgOf(INBOX)).toMatch(/id="vt-top-word"[^>]*>Approve</);
    expect(svgOf(INBOX)).not.toContain('id="vt-cycle"');
  });

  it("a waiting REM session takes a slot when all six are full; +N counts only waiting sessions without one", () => {
    const { d, svgOf } = deck({ keys: mischform() });
    const calm = Array.from({ length: 7 }, (_, i) => session(`s${i}`, { state: "idle" }));
    d.update(hubState({ sessions: calm }), [], T0);
    d.tick(T0);
    // a seventh calm session has no slot, but nothing to look at: no pill
    for (const id of ["mk2:1:1", "mk2:1:4", "mk2:2:1", "mk2:2:2"])
      expect(svgOf(id)).toContain('id="vt-title-1"');
    expect(svgOf("mk2:0:3")).not.toContain('id="vt-overflow"');
    const rem = view({
      key: { host: "remote", sessionId: "session_01" },
      hostKind: "remote",
      badge: "REM",
      title: "Remote",
      state: "needs_input",
      episodeSince: T0 + 1_000,
      episodeSeen: false,
    });
    d.update(hubState({ sessions: [...calm, rem] }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    // all idle and never waited: the last slot gives way, the other five keep their sessions
    expect(svgOf("mk2:2:2")).toContain(">Remote<");
    expect(svgOf("mk2:2:2")).toContain(">REM<");
    expect(svgOf("mk2:1:1")).toContain(">s0<");
    expect(svgOf("mk2:0:3")).not.toContain('id="vt-overflow"');
    // eight sessions need attention, six slots: "+2"; the REM session keeps its slot
    const asks = Array.from({ length: 7 }, (_, i) => waiting(`w${i}`, T0 + 2_000 + i));
    d.update(hubState({ sessions: [...calm, rem, ...asks] }), [], T0 + 2_000);
    d.tick(T0 + 2_000);
    expect(svgOf("mk2:0:3")).toMatch(/id="vt-overflow"[^>]*>\+2</);
    expect(svgOf("mk2:2:2")).toContain(">Remote<");
  });
});

describe("contentSignature (Plan 6 fields)", () => {
  it("ignores the working dot and the inbox clock, not the inbox position", () => {
    const slotTile = { kind: "slot", title: "a", state: "working", badge: "APP", tick: 0 } as const;
    expect(contentSignature({ ...slotTile, tick: 2 })).toBe(contentSignature(slotTile));
    const inbox = {
      kind: "inbox",
      waiting: 1,
      top: { title: "a", state: "needs_input", wait: 3 },
    } as const;
    expect(contentSignature({ ...inbox, top: { ...inbox.top, wait: 4 } })).toBe(
      contentSignature(inbox),
    );
    expect(contentSignature({ ...inbox, cycle: { index: 1, total: 2 } })).not.toBe(
      contentSignature(inbox),
    );
  });
});

describe("Deck variant", () => {
  it("renders comfortable by default and compact when configured", () => {
    const sessions = [session("a", { state: "idle", title: "Notizen" })];
    const comfortable = deck();
    comfortable.d.update(hubState({ sessions }), [], T0);
    comfortable.d.tick(T0);
    expect(comfortable.svgOf(slot(1))).toContain('id="vt-title-1" x="14" y="72"');
    const compact = deck({ variant: "compact" });
    compact.d.update(hubState({ sessions }), [], T0);
    compact.d.tick(T0);
    expect(compact.svgOf(slot(1))).toContain('id="vt-title-1" x="10" y="64"');
  });
});
