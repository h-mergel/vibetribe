import { describe, expect, it } from "vitest";
import { FLASH_MS } from "../src/deck/deck";
import type { DeckCommand } from "../src/deck/press";
import { deckHarness, hubState, T0, view } from "./helpers";

const SLOT1 = "mk2:1:0";
const INBOX = "mk2:0:0";

const deck = () => deckHarness({ max: 100 });

const desktop = view({
  key: { host: "win", sessionId: "desk" },
  state: "needs_input",
  episodeSince: T0 - 1_000,
  episodeSeen: false,
  hostSessionId: "local_7b1f",
});
const remote = view({
  key: { host: "remote", sessionId: "session_01Mac" },
  hostKind: "remote",
  badge: "REM",
  entrypoint: null,
  state: "done_unseen",
  episodeSince: T0 - 500,
  episodeSeen: false,
  bridgeSessionId: "session_01Mac",
});
const cli = view({
  key: { host: "wsl:Ubuntu", sessionId: "cli" },
  entrypoint: "cli",
  badge: "WSL",
  state: "needs_permission",
  episodeSince: T0 - 2_000,
  episodeSeen: false,
});
const jumpOf = (cmds: DeckCommand[]) => cmds.find((c) => c.type === "jump");

describe("Deck jumps", () => {
  it("a slot short press jumps with the session link and asks to mark it seen", () => {
    const { d } = deck();
    d.update(hubState({ sessions: [desktop] }), [], T0);
    d.tick(T0);
    expect(jumpOf(d.press(SLOT1, "short", T0))).toEqual({
      type: "jump",
      session: desktop,
      url: "claude://claude.ai/epitaxy/local_7b1f",
      markSeen: true,
    });
  });

  it("a remote session jumps to its code link", () => {
    const { d } = deck();
    d.update(hubState({ sessions: [remote] }), [], T0);
    d.tick(T0);
    expect(jumpOf(d.press(SLOT1, "short", T0))).toMatchObject({
      url: "claude://claude.ai/code/session_01Mac",
    });
  });

  it("the pressed slot shows the jumping flash for FLASH_MS.jumping, then its footer again", () => {
    const { d, svgOf } = deck();
    d.update(hubState({ sessions: [desktop] }), [], T0);
    d.tick(T0);
    d.press(SLOT1, "short", T0 + 100);
    d.tick(T0 + 250);
    expect(svgOf(SLOT1)).toContain(">Open…<");
    d.tick(T0 + 100 + FLASH_MS.jumping);
    expect(svgOf(SLOT1)).not.toContain(">Open…<");
  });

  it("'Open…' lasts 2.5 s, past the ~2 s Claude Desktop needs to show the session", () => {
    expect(FLASH_MS).toEqual({ jumping: 2_500, no_target: 2_000 });
    const { d, svgOf } = deck();
    d.update(hubState({ sessions: [desktop] }), [], T0);
    d.tick(T0);
    d.press(SLOT1, "short", T0);
    d.tick(T0 + 2_250);
    expect(svgOf(SLOT1)).toContain(">Open…<");
    d.tick(T0 + 2_500);
    expect(svgOf(SLOT1)).not.toContain(">Open…<");
  });

  it("the longer flash costs no extra frames: one state frame on, one off", () => {
    const { d, sentTo } = deck();
    // a calm Desktop session: no breathing, no working dot; its clock shows minutes only
    const calm = view({ key: { host: "win", sessionId: "calm" }, hostSessionId: "local_calm" });
    d.update(hubState({ sessions: [calm] }), [], T0);
    d.tick(T0);
    const before = sentTo(SLOT1);
    d.press(SLOT1, "short", T0 + 100);
    for (let t = T0 + 250; t <= T0 + 3_000; t += 250) d.tick(t);
    expect(sentTo(SLOT1) - before).toBe(2);
  });

  it("a session without a link: no jump, a no_target command and 'No link' on the key", () => {
    const { d, svgOf } = deck();
    d.update(hubState({ sessions: [cli] }), [], T0);
    d.tick(T0);
    expect(d.press(SLOT1, "short", T0)).toEqual([{ type: "no_target", session: cli }]);
    d.tick(T0 + 250);
    expect(svgOf(SLOT1)).toContain(">No link<");
    d.tick(T0 + FLASH_MS.no_target - 1);
    expect(svgOf(SLOT1)).toContain(">No link<");
    d.tick(T0 + FLASH_MS.no_target);
    expect(svgOf(SLOT1)).not.toContain("No link");
  });

  it("the inbox jumps without marking seen; a landing is reported only with a link", () => {
    const { d, svgOf } = deck();
    d.update(hubState({ sessions: [cli, desktop] }), [], T0);
    // cli waits longest (needs_permission outranks needs_input): first press lands on it
    expect(d.press(INBOX, "short", T0)).toEqual([{ type: "no_target", session: cli }]);
    d.tick(T0 + 250);
    expect(svgOf(INBOX)).toContain(">No link<");
    expect(jumpOf(d.press(INBOX, "short", T0 + 1_000))).toMatchObject({
      session: desktop,
      markSeen: false,
    });
    expect(d.tick(T0 + 6_000)).toEqual([{ type: "landed", session: desktop }]);
    d.press(INBOX, "short", T0 + 20_000);
    expect(d.tick(T0 + 25_000)).toEqual([]);
  });

  it("a long press still only acknowledges, without a jump or a flash", () => {
    const { d, svgOf } = deck();
    d.update(hubState({ sessions: [desktop] }), [], T0);
    d.tick(T0);
    expect(d.press(SLOT1, "long", T0)).toEqual([{ type: "seen", session: desktop }]);
    d.tick(T0 + 250);
    expect(svgOf(SLOT1)).not.toContain(">Open…<");
  });
});
