---
name: tile-check
description: Verify Stream Deck tiles after any change to a tile, a tile word, a font size, a frame or the renderer — compares with the Claude Design reference SVGs, measures every text and symbol of both variants with resvg, and looks at the PNGs. Use before committing tile changes and when reviewing them.
---

# Tile check

Character limits do not guarantee width. Every change on a tile is checked against the Claude Design reference, by measurement and by looking at it.

## Steps

1. **Reference** (in WSL, repo root):
   ```bash
   CI=true pnpm vitest run packages/render/test/reference.test.ts packages/render/test/fuzz.test.ts
   ```
   `reference.test.ts` compares 52 models per variant byte for byte with `docs/design/handoff-2026-10-13/reference/<luftig|dicht>/` (handoff names: `luftig` = comfortable, `dicht` = compact). A diff there means the port no longer matches the handoff: fix the renderer, never the reference files (a wanted design change comes as a new handoff from Claude Design). `fuzz.test.ts` (port of the handoff's `review.mjs`) checks about 5,500 combinations per variant for safe area and overlaps.
2. **Measure:**
   ```bash
   pnpm tiles:measure
   ```
   Must end with `tiles:measure: … all texts inside [10, 134], none below 18 px, no overlaps`. A `FAIL <variant> <sample>: …` line names the element and its box. Fix the layout rule (never below 18 px), then measure again.
3. **New text or new state?** Add a sample to `CORE_SAMPLES` in `packages/render/scripts/samples.ts` that shows the worst realistic case (longest word, largest number, all badges, press feedback), so the measurement covers it. Gallery and measurement share this list; it also contains the 52 reference models.
4. **Render and look:**
   ```bash
   pnpm gallery
   ```
   Open the changed tiles with the Read tool, e.g. `\\wsl.localhost\Ubuntu\home\heinrich\dev\projects\vibetribe\out\gallery\comfortable\slot-needs_permission.png` (and the same under `compact\`). Check: text readable, inside the frame, nothing overlaps, colors match the state. `out/gallery/index.html` shows both variants at 144 px and at the device size 72 px; compare with `docs/design/handoff-2026-10-13/reference/png/`.
5. **Report** what you measured and what you saw in the PNGs (both variants).

## Limits

- Widths in the renderer come from DejaVu Sans advance widths without kerning (`packages/render/src/adv.json`); resvg differs by at most 2 px. `pnpm tiles:measure` and the fuzz test use the real font in WSL (`/usr/share/fonts/truetype/dejavu`).
- The Stream Deck renders with the Windows fonts — final verification happens on the device (spec §14, probe I).
- Titles in scripts DejaVu Sans lacks (CJK, Thai, …) are filtered in the model (`tileTitle`); the folder name stands in when nothing readable is left.
