import type { RemoteSession } from "@vibetribe/hub";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RunningVibeTribe, startVibeTribe } from "../src/compose";
import type { KeyPlacement } from "../src/deck/keys";
import type { JumpResult } from "../src/jump/opener";
import { MemorySurface } from "../src/memory-surface";
import { svgFromDataUrl } from "./helpers";

const T0 = Date.UTC(2026, 10, 4, 12, 0);
const INBOX: KeyPlacement = { id: "inbox", role: "inbox", device: "mk2", row: 0, column: 0 };
const SLOT: KeyPlacement = { id: "slot", role: "slot", device: "mk2", row: 1, column: 0 };
const HOME: KeyPlacement = { id: "home", role: "home", device: "mk2", row: 0, column: 1 };

let app: RunningVibeTribe | null = null;
afterEach(async () => {
  await app?.stop();
  app = null;
});

const asking = (name: string, since: number): RemoteSession => ({
  id: `session_01${name}`,
  title: name,
  status: "waiting",
  doneUnread: false,
  quiet: true,
  at: since,
});

/** Two remote questions on one slot key: the older on the key, the other as "+1". */
async function start(result: JumpResult) {
  let clock = T0;
  const urls: string[] = [];
  const lines: string[] = [];
  const surface = new MemorySurface();
  app = await startVibeTribe({
    surface,
    hub: { port: 0, token: "t", usage: null, sources: [] },
    opener: {
      open: async (url) => {
        urls.push(url);
        return result;
      },
    },
    log: (l) => lines.push(l),
    now: () => clock,
    tickMs: 10,
    maxFramesPerSecond: 100,
  });
  const running = app;
  running.keyAppeared(INBOX);
  running.keyAppeared(SLOT);
  running.keyAppeared(HOME);
  const { hub } = running.hub;
  const listing = [asking("Old", T0 - 60_000), asking("New", T0 - 1_000)];
  hub.ingestRemote(listing, T0);
  const svg = (id: string) => svgFromDataUrl(surface.images.get(id) ?? "") ?? "";
  const inboxCount = () => /id="vt-count"[^>]*>(\d+)</.exec(svg(INBOX.id))?.[1];
  const homeCount = () => />(\d+)</.exec(svg(HOME.id))?.[1];
  const frameOf = (id: string) => /<[^<]*id="vt-frame"[^>]*>/.exec(svg(id))?.[0] ?? "";
  const viewOf = (name: string) => hub.state(clock).sessions.find((s) => s.title === name);
  const stateOf = (name: string) => viewOf(name)?.state;
  await vi.waitFor(() => expect(svg(SLOT.id)).toContain(">Old<"));
  await vi.waitFor(() => expect(inboxCount()).toBe("2"));
  await vi.waitFor(() => expect(homeCount()).toBe("2"));
  expect(svg(INBOX.id)).toContain(">+1<");
  return {
    running,
    hub,
    listing,
    urls,
    lines,
    svg,
    inboxCount,
    homeCount,
    frameOf,
    viewOf,
    stateOf,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe("a remote question looked at from the deck", () => {
  it("a slot press calms it on the key and in the inbox count; the next poll keeps it calm", async () => {
    const { running, hub, listing, urls, svg, inboxCount, stateOf, now } = await start("opened");
    running.press(SLOT.id, "short");
    await vi.waitFor(() => expect(stateOf("Old")).toBe("idle"));
    expect(urls).toEqual(["claude://claude.ai/code/session_01Old"]);
    await vi.waitFor(() => expect(inboxCount()).toBe("1"));
    await vi.waitFor(() => expect(svg(SLOT.id)).toContain(">Idle<"));
    hub.ingestRemote(listing, now() + 1);
    expect(stateOf("Old")).toBe("idle");
    expect(stateOf("New")).toBe("needs_input");
  });

  it("a session without a slot leaves the +N when it is looked at", async () => {
    const { hub, svg, inboxCount, now } = await start("opened");
    const other = hub.state(now()).sessions.find((s) => s.title === "New");
    if (!other) throw new Error("missing");
    hub.markSeen(other, now());
    await vi.waitFor(() => expect(inboxCount()).toBe("1"));
    expect(svg(INBOX.id)).not.toContain(">+1<");
  });

  it("a failed jump is no look", async () => {
    const { running, urls, stateOf } = await start("failed");
    running.press(SLOT.id, "short");
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(stateOf("Old")).toBe("needs_input");
  });

  it("cycling the inbox calms only the session it lands on", async () => {
    const { running, urls, stateOf, advance } = await start("opened");
    running.press(INBOX.id, "short");
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    running.press(INBOX.id, "short");
    await vi.waitFor(() => expect(urls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(stateOf("Old")).toBe("needs_input");
    expect(stateOf("New")).toBe("needs_input");
    advance(6_000);
    await vi.waitFor(() => expect(stateOf("New")).toBe("idle"));
    expect(urls.at(-1)).toBe("claude://claude.ai/code/session_01New");
    expect(stateOf("Old")).toBe("needs_input");
  });

  it("a new turn makes the calmed session loud on the deck again", async () => {
    const { running, hub, listing, svg, inboxCount, homeCount, stateOf, now, advance } =
      await start("opened");
    running.press(SLOT.id, "short");
    await vi.waitFor(() => expect(stateOf("Old")).toBe("idle"));
    await vi.waitFor(() => expect(inboxCount()).toBe("1"));
    await vi.waitFor(() => expect(homeCount()).toBe("1"));
    advance(20_000);
    hub.ingestRemote(
      listing.map((s) => (s.title === "Old" ? { ...s, at: now() - 1_000 } : s)),
      now(),
    );
    expect(stateOf("Old")).toBe("needs_input");
    await vi.waitFor(() => expect(inboxCount()).toBe("2"));
    await vi.waitFor(() => expect(homeCount()).toBe("2"));
    await vi.waitFor(() => expect(svg(SLOT.id)).toContain(">Input<"));
  });

  it("a calmed session gives its slot to a waiting one once the hold has ended", async () => {
    const { running, svg, inboxCount, stateOf, advance } = await start("opened");
    running.press(SLOT.id, "short");
    await vi.waitFor(() => expect(stateOf("Old")).toBe("idle"));
    await vi.waitFor(() => expect(svg(SLOT.id)).toContain(">Old<"));
    advance(30_000);
    await vi.waitFor(() => expect(svg(SLOT.id)).toContain(">New<"));
    expect(inboxCount()).toBe("1");
    expect(svg(INBOX.id)).not.toContain(">+1<");
  });

  it("a failed inbox jump and its landing are no look", async () => {
    const { running, urls, lines, viewOf, advance } = await start("failed");
    running.press(INBOX.id, "short");
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    advance(6_000);
    await vi.waitFor(() =>
      expect(lines.some((l) => l.endsWith("not seen, the jump failed"))).toBe(true),
    );
    expect(viewOf("Old")).toMatchObject({ state: "needs_input", episodeSeen: false });
    expect(viewOf("New")).toMatchObject({ state: "needs_input", episodeSeen: false });
  });

  it("a question while the worker runs stays Input after a slot press, with a thin frame", async () => {
    const { running, hub, listing, svg, frameOf, viewOf, now } = await start("opened");
    hub.ingestRemote(
      listing.map((s) => ({ ...s, quiet: false })),
      now(),
    );
    await vi.waitFor(() => expect(frameOf(SLOT.id)).toContain("stroke-opacity"));
    running.press(SLOT.id, "short");
    await vi.waitFor(() => expect(viewOf("Old")?.episodeSeen).toBe(true));
    expect(viewOf("Old")?.state).toBe("needs_input");
    await vi.waitFor(() => {
      expect(frameOf(SLOT.id)).toContain("vt-frame");
      expect(frameOf(SLOT.id)).not.toContain("stroke-opacity");
    });
    expect(svg(SLOT.id)).toContain(">Input<");
  });
});
