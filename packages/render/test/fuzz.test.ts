import type { SessionState } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { layoutIssues, place } from "../scripts/measure-lib";
import type { InboxTile, SlotTile, SourceHealth, Tile } from "../src/model";
import { VARIANTS } from "../src/model";
import { type Box, boxOf } from "../src/png";
import { render } from "../src/render";

/**
 * Port of the handoff's tools/review.mjs (about 6,500 combinations per variant, 0 findings in the
 * reference renderer), plus our press feedback ("Open…", "No link") on slots and the inbox.
 * Every element must stay inside [10, 134] and no two may overlap. Boxes are measured with resvg
 * and cached per fragment (most fragments repeat across combinations).
 */
const cache = new Map<string, Box | null>();
const measure = (fragment: string): Box | null => {
  if (!cache.has(fragment)) cache.set(fragment, boxOf(fragment));
  return cache.get(fragment) ?? null;
};

const STATES: SessionState[] = [
  "needs_permission",
  "needs_input",
  "error",
  "done_unseen",
  "throttled",
  "working",
  "background",
  "idle",
  "no_signal",
];
const TITLES = [
  "Mobile Entwicklung Northwind",
  "A",
  "",
  "vibetribe-streamdeck-plugin",
  "Überprüfung Änderungsprotokoll",
  "WWWWWWWWWWWWWWWWWWWW",
  "日本語のプロジェクト",
  "a/b/c/d/e/f/g/h/i/j/k/l",
  "x".repeat(60),
  "🚀🚀🚀",
];
const BADGES: SlotTile["badge"][] = ["APP", "WIN", "WSL", "REM", "?"];
const SLOT_EXTRAS: Partial<SlotTile>[] = [
  {},
  { bgCount: 12 },
  { bgStale: true },
  { wait: 59 },
  { wait: 3599 },
  { wait: 35_999 },
  { wait: 360_000 },
  { detail: "Kompaktiert" },
  { detail: "server_error", wait: 700 },
  { flash: "jumping" },
  { flash: "no_target", wait: 42 },
];

function cases(): [string, Tile][] {
  const out: [string, Tile][] = [];
  for (const title of TITLES)
    for (const state of STATES)
      for (const badge of BADGES)
        for (const extra of SLOT_EXTRAS)
          out.push([
            `slot ${state} "${title.slice(0, 12)}" ${badge} ${JSON.stringify(extra)}`,
            { kind: "slot", state, title, badge, frame: "thick", ...extra },
          ]);
  const flashes: InboxTile["flash"][] = [undefined, "jumping", "no_target"];
  for (const waiting of [0, 1, 9, 12, 123])
    for (const overflow of [0, 3, 12, 123])
      for (const cycle of [null, { index: 9, total: 12 }, { index: 12, total: 123 }])
        for (const wait of [null, 42, 40_000])
          for (const flash of flashes)
            out.push([
              `inbox w${waiting} ov${overflow} cyc${JSON.stringify(cycle)} ${flash ?? ""}`,
              {
                kind: "inbox",
                waiting,
                overflow,
                cycle,
                top: waiting
                  ? { title: "Mobile Entwicklung Northwind", state: "needs_permission", wait }
                  : null,
                ...(flash ? { flash } : {}),
              },
            ]);
  for (const usedPct of [null, 0, 5, 99.6, 100, 140, -5])
    for (const label of ["5h", "Week"] as const)
      for (const ahead of [true, false])
        out.push([
          `limit ${label} ${usedPct} ahead${ahead}`,
          { kind: "limit", label, usedPct, pacePct: 120, resetIn: "23d 23h", level: "red", ahead },
        ]);
  for (const used of ["0,00 €", "12.345,67 €", "123.456,78 €", "1.234.567,89 €"])
    for (const ratio of [0, 0.5, 1.3, null])
      out.push([
        `extra ${used} ${ratio}`,
        { kind: "extra", used, limit: "100.000,00 €", ratio, level: "red" },
      ]);
  const rows = (sources: string[], health: string) =>
    sources.map((source) => ({ source, health: health as SourceHealth }));
  out.push([
    "status 6 rows + long alert",
    {
      kind: "status",
      alert: "Verbindung verloren",
      rows: rows(["WIN", "WSL", "REM", "LIM", "X", "Y"], "missing"),
    },
  ]);
  out.push([
    "status expanded",
    {
      kind: "status",
      expanded: true,
      alert: "Port in use",
      rows: rows(["WIN", "WSL", "REM", "LIM"], "missing"),
    },
  ]);
  return out;
}

describe("layout fuzz (handoff review.mjs)", () => {
  it.each(VARIANTS)(
    "%s: nothing leaves the safe area and nothing overlaps",
    (variant) => {
      const findings: string[] = [];
      const all = cases();
      let measured = 0;
      for (const [name, tile] of all) {
        const placed = place(render(tile, { variant }), measure);
        measured += placed.length;
        for (const issue of layoutIssues(placed)) findings.push(`${name}: ${issue}`);
      }
      expect(all.length).toBeGreaterThan(5_000);
      // every tile has at least three measured elements: a check that measures nothing proves nothing
      expect(measured).toBeGreaterThan(3 * all.length);
      expect(findings.slice(0, 20)).toEqual([]);
    },
    120_000,
  );
});
