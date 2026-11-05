# 0005: Hub inside the plugin, deploy by copy, SVG data URLs

- Status: accepted (2026-10-13), partly superseded by 0007 (fixed port 43710)

## Context
The repo lives in WSL; the Stream Deck plugin runs on Windows. An NTFS junction can't point at `\\wsl.localhost`, and the Windows CLI `streamdeck` isn't installed. `streamdeck://plugins/restart/<uuid>` doesn't reload the plugin outside developer mode (probe Q3). The Stream Deck app rasterises SVG data URLs itself; mirror and hardware show the same images (probe I).

## Decision
- The hub runs in the plugin process (port 43710), as in ADR 0001; the plugin is the only composition root. `hub.mjs` stays for standalone use and exits with 2 if the port is taken.
- Build in WSL (`pnpm plugin:build`), deploy by copy (`pnpm plugin:deploy`: `manifest.json`, `bin/`, `imgs/` to `%APPDATA%\Elgato\StreamDeck\Plugins\dev.h2k.vibetribe.sdPlugin`, staged with a swap). Afterwards the Stream Deck app must be quit completely and restarted.
- Key images are SVG data URLs; no resvg in the plugin, PNG only for the manifest icons (build time).
- One class `VibeTribeAction(role, deck)` with `manifestId`, instead of an `@action` decorator and six subclasses.

## Alternatives
- Junction or symlink to the WSL folder: can't be resolved on Windows.
- Windows CLI `streamdeck link`: not installed, an extra dependency.
- PNG in the plugin: a native `.node` in the bundle and about 2–3 ms of rasterising per image, without benefit.
- Hub as its own process: two processes, coordinating ports and lifecycle, no benefit for the user.

## Consequences
- After each build `pnpm plugin:deploy` and a full restart of the app; deploying to the user's machine only with their consent.
- Environment variables (`VIBETRIBE_MAX_FRAMES`) reach the plugin only after a full app restart.
- Marketplace packaging later through `streamdeck pack` on the copied folder.
