import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnvelope } from "@vibetribe/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRenderArgs, renderScenario } from "../scripts/render-scenario";
import { MemorySurface, type RunningVibeTribe, startVibeTribe } from "../src/compose";
import { defaultMk2Layout } from "../src/deck/keys";
import { svgFromDataUrl } from "./helpers";

const scenario = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../hub/fixtures/scenarios/${name}.jsonl`, import.meta.url)),
    "utf8",
  );

describe("renderScenario", () => {
  it("plays three-sessions-one-waiting into a full MK.2 layout", () => {
    const { mirror, html } = renderScenario(scenario("three-sessions-one-waiting"));
    expect(mirror.keys).toHaveLength(15);
    expect(mirror.keys.every((k) => k.image !== null)).toBe(true);
    const svg = (id: string) =>
      svgFromDataUrl(mirror.keys.find((k) => k.id === id)?.image ?? "") ?? "";
    // severity order: the permission request first, then the finished turn, then the working one
    expect(svg("mk2:1:0")).toContain(">Approve<");
    expect(svg("mk2:1:0")).toContain("northwind");
    expect(svg("mk2:1:1")).toContain(">Done<");
    expect(svg("mk2:1:2")).toContain(">Working<");
    expect(svg("mk2:1:3")).not.toContain("<text");
    expect(svg("mk2:0:0")).toContain('id="vt-count"');
    expect(html).toContain("<h2>Deck</h2>");
    expect(html).toContain("grid-template-columns:repeat(5,72px)");
  });

  it("five-waiting (probe H fixture): five candidates, exactly the two newest breathe", () => {
    const { mirror } = renderScenario(scenario("five-waiting"));
    const svg = (id: string) =>
      svgFromDataUrl(mirror.keys.find((k) => k.id === id)?.image ?? "") ?? "";
    for (const column of [0, 1, 2, 3, 4])
      expect(svg(`mk2:1:${column}`)).toMatch(/>Approve<|>Input</);
    expect(svg("mk2:0:0")).toContain(">5<");
    // slots follow severity: w1, w2, w4, w5 (permissions, oldest first), then w3 (input); the two
    // newest requests (w5 at 1.6 s, w4 at 1.2 s) breathe, so only slots 3 and 4 change over time
    const at = (ms: number) => renderScenario(scenario("five-waiting"), ms).mirror;
    const frames = [400, 525, 650, 775, 900, 1025, 1150, 1275].map(at);
    // the elapsed-time label of each tile ticks on its own; compare the shapes only
    const imageOf = (m: (typeof frames)[number], c: number) =>
      svgFromDataUrl(m.keys.find((k) => k.id === `mk2:1:${c}`)?.image ?? "")?.replace(
        /<text.*?<\/text>/g,
        "",
      );
    const distinct = (c: number) => new Set(frames.map((m) => imageOf(m, c))).size;
    expect([2, 3].map(distinct).every((n) => n > 1)).toBe(true);
    expect([0, 1, 4].map(distinct)).toEqual([1, 1, 1]);
    expect(svg("mk2:1:0")).toContain("alpha");
    expect(svg("mk2:1:1")).toContain("bravo");
  });

  it("rejects an invalid envelope with a line reference", () => {
    expect(() => renderScenario('{"delayMs":0,"envelope":{"v":2}}')).toThrow(/invalid envelope/);
  });

  it("is byte-identical across runs", () => {
    const a = renderScenario(scenario("five-waiting"), 600);
    const b = renderScenario(scenario("five-waiting"), 600);
    expect(b.html).toBe(a.html);
    expect(JSON.stringify(b.mirror)).toBe(JSON.stringify(a.mirror));
  });

  it("--after picks the breathing phase: 300 ms and 600 ms differ", () => {
    const at = (ms: number) => JSON.stringify(renderScenario(scenario("five-waiting"), ms).mirror);
    expect(at(300)).not.toBe(at(600));
  });

  it("passes the variant to the deck", () => {
    const text = scenario("three-sessions-one-waiting");
    const title = (variant: "comfortable" | "compact") =>
      svgFromDataUrl(
        renderScenario(text, 1_000, "UTC", variant).mirror.keys.find((k) => k.id === "mk2:1:0")
          ?.image ?? "",
      );
    expect(title("comfortable")).toContain('id="vt-title-1" x="14"');
    expect(title("compact")).toContain('id="vt-title-1" x="10"');
  });

  it("passes the time zone to the deck", () => {
    const text = scenario("three-sessions-one-waiting");
    const zone = (tz: string) =>
      JSON.stringify(renderScenario(text, 7_200_000, tz).mirror.keys.map((k) => k.image));
    expect(zone("Europe/Berlin")).toBe(zone("Europe/Berlin"));
  });
});

describe("parseRenderArgs", () => {
  it("defaults to 1000 ms and Europe/Berlin", () => {
    expect(parseRenderArgs(["a.jsonl"])).toEqual({
      file: "a.jsonl",
      after: 1_000,
      timeZone: "Europe/Berlin",
      variant: "comfortable",
    });
  });

  it("accepts --after and --tz", () => {
    expect(
      parseRenderArgs(["a.jsonl", "--after", "300", "--tz", "UTC", "--variant", "compact"]),
    ).toEqual({
      file: "a.jsonl",
      after: 300,
      timeZone: "UTC",
      variant: "compact",
    });
    expect(parseRenderArgs(["a.jsonl", "--after", "0"]).after).toBe(0);
  });

  it.each(["-1", "1.5", "abc", "", "1e3"])("rejects --after %j", (bad) => {
    expect(() => parseRenderArgs(["a.jsonl", "--after", bad])).toThrow(/--after/);
  });

  it("rejects a missing value, a missing file and an unknown zone", () => {
    expect(() => parseRenderArgs(["a.jsonl", "--after"])).toThrow(/--after/);
    expect(() => parseRenderArgs([])).toThrow(/usage/);
    expect(() => parseRenderArgs(["a.jsonl", "--tz", "Mars/Base"])).toThrow(/--tz/);
    expect(() => parseRenderArgs(["a.jsonl", "--variant", "eng"])).toThrow(/--variant/);
  });
});

describe("renderScenario equals the running plugin", () => {
  let app: RunningVibeTribe | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    await app?.stop();
    app = null;
  });

  it("produces the same key images as startVibeTribe + MemorySurface with an injected clock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const text = scenario("five-waiting");
    const surface = new MemorySurface();
    let clock = 0;
    app = await startVibeTribe({
      surface,
      hub: { port: 0, token: "t", sources: [], usage: null },
      log: () => {},
      now: () => clock,
      tickMs: 250,
      maxFramesPerSecond: 100,
    });
    let at = 0;
    for (const line of text.split("\n").filter(Boolean)) {
      const step = JSON.parse(line) as { delayMs: number; envelope: unknown };
      at += step.delayMs;
      clock = at;
      const parsed = parseEnvelope(step.envelope);
      if (!parsed.ok) throw new Error(parsed.error);
      app.hub.hub.ingest(parsed.value, at);
    }
    // the keys appear after the scenario, like the offline deck that is synced once at the end
    clock = at + 900; // a tick boundary of the 250 ms timer
    for (const key of defaultMk2Layout()) app.keyAppeared(key);
    vi.advanceTimersByTime(250);

    const offline = renderScenario(text, 900).mirror;
    const live = Object.fromEntries(
      offline.keys.map((k) => [k.id, surface.images.get(k.id) ?? null]),
    );
    expect(live).toEqual(Object.fromEntries(offline.keys.map((k) => [k.id, k.image])));
  });
});
