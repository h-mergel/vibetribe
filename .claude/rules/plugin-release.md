---
paths:
  - "packages/plugin/scripts/**"
  - "docs/marketplace/**"
  - "docs/readme/**"
---

# Packaging and store media

- `pnpm plugin:pack` writes to `dist/` (git-ignored) and, with DejaVu Sans installed, refreshes the tracked `docs/readme/setup.png` (commit it if it changed). It packs a copy under `dist/stage`, because `streamdeck pack` rewrites the manifest of the packed folder. Uploading is the owner's job in the Maker Console.
- Versions in the Maker Console: a revision of a rejected version keeps the same number; a higher number needs "Create version". Each new build needs a higher `Version` than the last one published.
- The official MK.2 image (Elgato press kit, no licence text) never enters the repo raw; `assets-local/` is git-ignored. Tests create a small image themselves. Change nothing on the device (logo, housing, proportions), only the key screens.
- The two composites in `docs/readme/` (`hero.png`, `deck.png`) contain that photo on purpose; the README's licence note excludes the device in them. They come out again if Elgato objects. No other press-kit image goes there.
- All 15 keys in store images show only VibeTribe, no original Elgato symbol may stay visible (`DECK_TILES`, crop `BLEED` in `marketplace-deck.ts`). The key field is a homography from four measured corners (`FIELD`) and is valid only for this image.
- `renderPixels` and resvg's pixels are premultiplied; `encodePng` converts back.
- `profile-files.ts` (`pnpm profile:layout`) writes only while the Stream Deck app is closed; see `docs/development.md`.
