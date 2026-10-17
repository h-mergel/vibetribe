import type { HostSnapshot } from "@vibetribe/core";
import type { SessionSource } from "@vibetribe/hub";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySurface, type RunningVibeTribe, startVibeTribe } from "../src/compose";
import { svgFromDataUrl } from "./helpers";

let app: RunningVibeTribe | null = null;
afterEach(async () => {
  await app?.stop();
  app = null;
});

const file = (sessionId: string, name: string): HostSnapshot["sessions"][number] => ({
  sessionId,
  pid: 7,
  cwd: "C:/p",
  entrypoint: "claude-desktop",
  name,
  hostSessionId: `local_${sessionId}`,
  bridgeSessionId: null,
  status: "idle",
  waitingFor: null,
});

describe("startVibeTribe with Claude Desktop's pins", () => {
  it("applies the pins only once the preference is known, then switches without a restart", async () => {
    const surface = new MemorySurface();
    const lines: string[] = [];
    const source: SessionSource = {
      name: "sessions:win",
      host: "win",
      hostKind: "windows",
      scan: async (now) => ({
        host: "win",
        hostKind: "windows",
        at: now,
        sessions: [file("a", "Loose"), file("b", "Pinned")],
      }),
    };
    app = await startVibeTribe({
      surface,
      hub: { port: 0, token: "t", sources: [source], usage: null, pins: async () => ["local_b"] },
      log: (l) => lines.push(l),
      tickMs: 10,
      maxFramesPerSecond: 100,
    });
    const { hub } = app.hub;
    app.keyAppeared({ id: "k", role: "slot", device: "d", row: 1, column: 0 });
    const shown = () => svgFromDataUrl(surface.images.get("k") ?? "") ?? "";
    await vi.waitFor(() => expect(shown()).toContain("Loose"));
    await vi.waitFor(() => expect(hub.state(0).pins).toEqual(["local_b"]));
    // ten ticks and more: until the preference is known, the pin moves nobody
    await new Promise((r) => setTimeout(r, 150));
    expect(shown()).toContain("Loose");
    const update = vi.spyOn(app.deck, "update");
    app.setPreferPinned(true);
    // at once, not only with the next refresh
    expect(update.mock.lastCall?.[0].pins).toEqual(["local_b"]);
    await vi.waitFor(() => expect(shown()).toContain("Pinned"));
    app.setPreferPinned(true);
    app.setPreferPinned(false);
    expect(update.mock.lastCall?.[0].pins).toEqual([]);
    expect(lines.filter((l) => l.startsWith("prefer pinned sessions"))).toEqual([
      "prefer pinned sessions: on",
      "prefer pinned sessions: off",
    ]);
  });
});
