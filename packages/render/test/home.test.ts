import type { SessionState, SessionView } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { homeTile } from "../src/fromCore";
import { type HomeTile, type Tile, VARIANTS } from "../src/model";
import { render } from "../src/render";
import { C } from "../src/theme";

const NOW = 1_000_000;

const session = (
  id: string,
  state: SessionState,
  over: Partial<SessionView> = {},
): SessionView => ({
  id,
  key: { host: "win", sessionId: id },
  hostKind: "windows",
  badge: "WIN",
  title: id,
  cwd: `/x/${id}`,
  state,
  detail: null,
  errorType: null,
  episodeSince: NOW - 90_000,
  episodeSeen: false,
  background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
  pid: null,
  entrypoint: "claude-desktop",
  hostSessionId: null,
  bridgeSessionId: null,
  ...over,
});

const still = { now: NOW, animated: new Set<string>() };
const tile = (over: Partial<HomeTile> = {}): HomeTile => ({
  kind: "home",
  top: null,
  others: [],
  waiting: 0,
  ...over,
});
const dot = (svg: string, i: number): string =>
  new RegExp(`<g id="vt-home-glyph-${i}">(<circle [^>]*/>)</g>`).exec(svg)?.[1] ?? "";
const isRing = (el: string): boolean =>
  el.includes('fill="none"') && el.includes(`stroke="${C.line}"`);

describe.each(VARIANTS)("home tile (%s)", (variant) => {
  const draw = (m: Tile): string => render(m, { variant });

  it.each([
    ["needs_permission", C.permission],
    ["needs_input", C.input],
    ["error", C.error],
    ["done_unseen", C.done],
  ] as const)("the top dot of %s has that state's colour and the larger radius", (state, color) => {
    const top = dot(draw(tile({ top: { state }, waiting: 1 })), 0);
    expect(top).toContain(`fill="${color}"`);
    expect(top).toContain('r="18"');
  });

  it("further sessions fill the circle clockwise in the given order, the rest stay rings", () => {
    const svg = draw(
      tile({ top: { state: "error" }, others: ["done_unseen", "working"], waiting: 2 }),
    );
    expect(dot(svg, 1)).toContain(`fill="${C.done}"`);
    expect(dot(svg, 2)).toContain(`fill="${C.working}"`);
    for (const i of [3, 4, 5]) expect(isRing(dot(svg, i))).toBe(true);
    const cx = [1, 2, 3, 4, 5].map((i) => Number(/cx="([\d.]+)"/.exec(dot(svg, i))?.[1]));
    expect(cx).toEqual([111.8, 111.8, 72, 32.2, 32.2]);
  });

  it("draws at most six dots", () => {
    const others = Array.from({ length: 9 }, (): SessionState => "idle");
    expect(draw(tile({ others })).match(/<circle /g)).toHaveLength(6);
  });

  it("no sessions: all rings, the top one still the larger, no count and no frame", () => {
    const svg = draw(tile());
    for (const i of [0, 1, 2, 3, 4, 5]) expect(isRing(dot(svg, i))).toBe(true);
    const outer = (el: string): number =>
      Number(/ r="([\d.]+)"/.exec(el)?.[1]) + Number(/stroke-width="([\d.]+)"/.exec(el)?.[1]) / 2;
    expect(outer(dot(svg, 0))).toBe(18);
    expect(outer(dot(svg, 1))).toBe(13);
    expect(svg).not.toContain("vt-count");
    expect(svg).not.toContain("vt-frame");
  });

  it("shows the number of waiting sessions in the centre, nothing at 0", () => {
    expect(draw(tile({ top: { state: "done_unseen" }, waiting: 3 }))).toMatch(
      /<text id="vt-count" x="72" [^>]*text-anchor="middle"[^>]*>3<\/text>/,
    );
    expect(draw(tile({ others: ["working"], waiting: 0 }))).not.toContain("vt-count");
  });

  it("a large count shrinks to stay between the dots", () => {
    const size = (waiting: number): number =>
      Number(
        /id="vt-count"[^>]*font-size="(\d+)"/.exec(
          draw(tile({ top: { state: "error" }, waiting })),
        )?.[1],
      );
    expect(size(12)).toBe(34);
    expect(size(100)).toBeLessThan(34);
    expect(draw(tile({ top: { state: "error" }, waiting: 100 }))).toContain(">99+<");
  });

  it("the breath level is the opacity of the top dot only", () => {
    const svg = draw(
      tile({ top: { state: "needs_input", level: 0.35 }, others: ["idle"], waiting: 1 }),
    );
    expect(dot(svg, 0)).toContain('fill-opacity="0.35"');
    expect(dot(svg, 1)).not.toContain("fill-opacity");
    expect(dot(draw(tile({ top: { state: "needs_input" }, waiting: 1 })), 0)).not.toContain(
      "fill-opacity",
    );
  });

  it("hub health: a thin amber frame when stale, a thick red one when down, none when fine", () => {
    const frame = (health: HomeTile["health"]): string =>
      /<rect id="vt-frame"[^>]*\/>/.exec(draw(tile({ health })))?.[0] ?? "";
    expect(frame("ok")).toBe("");
    expect(frame(undefined)).toBe("");
    expect(frame("stale")).toContain(`stroke="${C.permission}"`);
    expect(frame("missing")).toContain(`stroke="${C.error}"`);
    const width = (el: string): number => Number(/stroke-width="(\d+)"/.exec(el)?.[1]);
    expect(width(frame("missing"))).toBeGreaterThan(width(frame("stale")));
  });

  it("the back key is only a centred left arrow in ink: no text, no ring", () => {
    const svg = draw({ kind: "back" });
    expect(svg).toContain('d="M92 72H52M68 54L50 72L68 90"');
    expect(svg).toContain(`stroke="${C.ink}"`);
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("<circle");
  });
});

describe("homeTile", () => {
  it("takes the most urgent waiting session for the top, then all others by severity", () => {
    const m = homeTile(
      [
        session("idle", "idle"),
        session("done", "done_unseen"),
        session("work", "working"),
        session("input", "needs_input"),
        session("approve", "needs_permission"),
      ],
      still,
    );
    expect(m.top?.state).toBe("needs_permission");
    expect(m.others).toEqual(["needs_input", "done_unseen", "working", "idle"]);
    expect(m.waiting).toBe(3);
  });

  it("a more urgent state beats an older episode", () => {
    const m = homeTile(
      [
        session("new", "error", { episodeSince: NOW - 1_000 }),
        session("old", "error", { episodeSince: NOW - 9_000 }),
        session("first", "needs_input", { episodeSince: NOW - 500 }),
      ],
      still,
    );
    expect(m.top?.state).toBe("needs_input");
    expect(m.others).toEqual(["error", "error"]);
  });

  it("nobody waiting: the top stays free, working sessions take the other dots", () => {
    const m = homeTile([session("a", "working"), session("b", "idle")], still);
    expect(m.top).toBeNull();
    expect(m.others).toEqual(["working", "idle"]);
    expect(m.waiting).toBe(0);
  });

  it("no sessions at all", () => {
    expect(homeTile([], still)).toEqual({ kind: "home", top: null, others: [], waiting: 0 });
  });

  it("keeps at most five further sessions", () => {
    const views = Array.from({ length: 9 }, (_, i) => session(`s${i}`, "idle"));
    expect(homeTile(views, still).others).toHaveLength(5);
  });

  it("the top dot breathes only when the deck says that session breathes", () => {
    const fresh = session("a", "needs_permission", { episodeSince: NOW });
    expect(homeTile([fresh], { now: NOW, animated: new Set(["a"]) }).top?.level).toBe(0.35);
    expect(homeTile([fresh], still).top?.level).toBe(1);
    const other = session("b", "needs_input", { episodeSince: NOW });
    expect(homeTile([fresh, other], { now: NOW, animated: new Set(["b"]) }).top?.level).toBe(1);
  });
});
