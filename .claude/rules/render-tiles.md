---
paths:
  - "packages/render/**"
  - "docs/design/**"
---

# Tiles

- After any change to a tile, a word or a font size, run the `tile-check` skill. Truncating by characters doesn't guarantee a width.
- Control characters in titles break SVG and resvg: text reaches a tile only through `text()`/`escapeXml`.
- `@vibetribe/render` doesn't load resvg. PNG and measuring go only through the subpath `@vibetribe/render/png`.
- `packages/render` is a port of the reference renderer in `docs/design/handoff-2026-10-13/`. `reference.test.ts` compares byte for byte with `reference/<luftig|dicht>/`; the only exception is frame geometry (below). The handoff is external material and keeps its names: `luftig` = `comfortable`, `dicht` = `compact` (`HANDOFF_FOLDER`). A wanted design change comes as a new handoff, never by editing the reference SVGs.
- `textWidth` uses advance widths (`adv.json`) per UTF-16 code unit, without kerning; unknown characters count 0.62 em. Titles pass through `tileTitle` in the model: scripts without DejaVu glyphs drop out, with the folder name as a stand-in.
- Frame inset (deliberate deviation from the handoff): the housing covers the outer pixels, so the outer edge of every `vt-frame` sits at 2 px (`frame` in `render/src/shared.ts`). Compact draws the thick frame 7 px wide instead of 8 so its inner edge stays at 9 px. `reference.test.ts` masks only `vt-frame` geometry; `frameInset.test.ts` checks the inset.
- Comfortable: regular text (400) gets `stroke-text` (0.7 px outline in its own colour). All its text therefore goes through the local `text` in `comfortable.ts`, and the shared limit tile through `limit(m, STROKE.text)`.
