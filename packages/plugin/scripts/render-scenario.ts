/**
 * Offline deck rendering: plays a scenario into a Hub in memory, lays the keys out like the MK.2
 * default profile and writes the key images as an HTML page — no Stream Deck, no HTTP, no clock.
 * Usage: pnpm deck:render <scenario.jsonl> [--after <ms>] [--tz <zone>] [--variant comfortable|compact]
 * `--after` (non-negative integer, default 1000 ms after the last event) picks the moment, e.g.
 * 300/600/900 ms to see the breathing phases one by one; `--tz` defaults to Europe/Berlin.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type DeckMirror,
  Hub,
  KEYS_PAGE_CSS,
  loadScenario,
  renderKeysSection,
} from "@vibetribe/hub";
import { parseEnvelope } from "@vibetribe/protocol";
import { DEFAULT_VARIANT, VARIANTS, type Variant } from "@vibetribe/render";
import { MemorySurface } from "../src/compose";
import { Deck } from "../src/deck/deck";
import { defaultMk2Layout } from "../src/deck/keys";

export const DEFAULT_TIME_ZONE = "Europe/Berlin";

export interface RenderedScenario {
  mirror: DeckMirror;
  html: string;
}

/**
 * Deterministic: event times start at 0 and `afterMs` after the last event is "now". The deck is
 * synced once, as if it started after the scenario: slots are handed out by severity, not by arrival.
 */
export function renderScenario(
  scenarioText: string,
  afterMs = 1_000,
  timeZone = DEFAULT_TIME_ZONE,
  variant: Variant = DEFAULT_VARIANT,
): RenderedScenario {
  const hub = new Hub();
  const surface = new MemorySurface();
  // no budget offline: every key gets its image in the single flush below
  const deck = new Deck({
    send: (id, image) => surface.setImage(id, image),
    maxFramesPerSecond: 100,
    timeZone,
    variant,
  });
  for (const key of defaultMk2Layout()) deck.keyAppeared(key, 0);
  let at = 0;
  for (const step of loadScenario(scenarioText)) {
    at += step.delayMs;
    const parsed = parseEnvelope(step.envelope);
    if (!parsed.ok) throw new Error(`invalid envelope: ${parsed.error}`);
    hub.ingest(parsed.value, at);
  }
  const now = at + afterMs;
  deck.update(hub.state(now), hub.drainRemovals(), now);
  deck.tick(now);
  const mirror = deck.mirror(now);
  const html = `<!doctype html><meta charset="utf-8"><title>VibeTribe Deck</title>
<style>${KEYS_PAGE_CSS}</style>
<h2>Deck</h2>${renderKeysSection(mirror)}`;
  return { mirror, html };
}

export interface RenderArgs {
  file: string;
  after: number;
  timeZone: string;
  variant: Variant;
}

const USAGE =
  "usage: deck:render <scenario.jsonl> [--after <ms>] [--tz <zone>] [--variant comfortable|compact]";

export function parseRenderArgs(argv: string[]): RenderArgs {
  const file = argv[0];
  if (!file || file.startsWith("--")) throw new Error(USAGE);
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const rawAfter = value("--after");
  if (rawAfter !== undefined && !/^[0-9]+$/.test(rawAfter)) {
    throw new Error("--after needs a non-negative integer number of milliseconds");
  }
  const timeZone = value("--tz") ?? DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone });
  } catch {
    throw new Error(`--tz: unknown time zone ${timeZone}`);
  }
  const variant = value("--variant") ?? DEFAULT_VARIANT;
  if (!VARIANTS.includes(variant as Variant))
    throw new Error(`--variant: comfortable or compact, not ${variant}`);
  return {
    file,
    after: rawAfter === undefined ? 1_000 : Number(rawAfter),
    timeZone,
    variant: variant as Variant,
  };
}

function main(argv: string[]): void {
  const { file, after, timeZone, variant } = parseRenderArgs(argv);
  const { mirror, html } = renderScenario(readFileSync(file, "utf8"), after, timeZone, variant);
  const out = join(process.cwd(), "out", "deck");
  mkdirSync(out, { recursive: true });
  const name = basename(file).replace(/\.jsonl$/, "");
  writeFileSync(join(out, `${name}.html`), html);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(mirror, null, 2));
  process.stdout.write(`deck: ${mirror.keys.length} keys -> ${join(out, `${name}.html`)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
  }
}
