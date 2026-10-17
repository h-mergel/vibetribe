import { describe, expect, it } from "vitest";
import { deckHarness, hubState, session, slot, T0 } from "./helpers";

describe("Deck with Claude Desktop's pins", () => {
  it("a pinned session takes the slot of a resting unpinned one at the next update", () => {
    const keys = [{ id: slot(1), role: "slot" as const, device: "mk2", row: 1, column: 0 }];
    const { d, svgOf } = deckHarness({ keys });
    const loose = session("a-loose");
    const pinned = session("b-pinned", { hostSessionId: "local_b" });
    d.update(hubState({ sessions: [loose, pinned] }), [], T0);
    d.tick(T0);
    expect(svgOf(slot(1))).toContain("a-loose");
    d.update(hubState({ sessions: [loose, pinned], pins: ["local_b"] }), [], T0 + 1_000);
    d.tick(T0 + 1_000);
    expect(svgOf(slot(1))).toContain("b-pinned");
  });
});
