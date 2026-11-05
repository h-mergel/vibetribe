---
paths:
  - "packages/plugin/src/**"
  - "packages/plugin/dev.h2k.vibetribe.sdPlugin/**"
  - "packages/plugin/build.mjs"
---

# Plugin and deck

## Bundle and files

- The esbuild bundle for the SDK needs the `createRequire` banner (`ws` is CommonJS).
- The plugin never reads its own folder or `manifest.json` (DRM; test "DRM" in `manifest.test.ts`, also through the bundle). Leave the SDK's logger to `<Plugin>/logs` as it is (ADR 0011).
- The reporter ships as text inside `bin/plugin.js` (`__REPORTER_SOURCE__`, built in memory by `reporterBuild` from `packages/reporter/build.mjs`, never via `reporter/dist`, which the reporter's tests write to at the same time).
- `deploy.sh` copies only what `FILES` lists; a new folder in `.sdPlugin` belongs there.
- The plugin and `hub.mjs` never run at the same time. Environment variables reach the plugin only after a full restart of the app.

## Keys

- Slot numbers stay reserved for their keys, also while hidden. A slot key hidden for over 60 s (deleted, long on another page) frees its number and session; the next new slot key takes the smallest free number.
- A session on a hidden slot that needs attention moves to a visible key (swaps with a calm one), but only `KEYS_SETTLE_MS` after the last key change (`surfaceHidden`).
- A slot press takes its session from `#shown.sessionOf(id)` (the last accepted image), never the slot table.
- Read the clock of a breathing key only through `breathStepStart`, or each new second costs an extra frame.
- Status key: a tap expands it for 5 s, holding opens `/debug`. Holding the inbox acknowledges all `done_unseen`.
- `FLASH_MS.jumping` (2.5 s) follows the time Claude Desktop takes to show a session. It costs no frames; the flash stays bound to the pressed session (`PressFeedback`).
- The action `dev.h2k.vibetribe.home` switches only through `DeckSurface.switchProfile`. `switchToProfile` needs exactly the `Name` from the manifest (`BUNDLED_PROFILE`, a path without extension); without a name it goes to the previous profile. Nobody reports a wrong name. The `.streamDeckProfile` format is undocumented and follows Stream Deck's own exports.

## Jumps and web pages

- Jump links reach the system only through `jumpUrlFor` and the port `JumpOpener`. `rundll32.exe` starts from its absolute path under `%SystemRoot%\System32`, never via the search path, and never in headless mode or tests.
- A jump that returns `opened` doesn't prove Desktop came to the front (foreground lock).
- The deck's own inbox opens are filtered out (`InboxOpens`, window `CYCLE_WINDOW_MS`), or cycling would mark every skipped session as seen. If you change `jump()` or the inbox, check the test "cycling the inbox through Claude Desktop …" in `compose-jump.test.ts`.
- Web pages open only through `openWebPage` with exactly allowed URLs (`isAllowedWebUrl`); `isJumpUrl` stays for `claude://` links.

## Composition and settings

- "Prefer pinned sessions" off or not yet read: the composition gives the deck a state without pins (`setPreferPinned`; `null` until the first call). `HubState.pins` and the "Pin" column on `/debug` still show them.
- The Property Inspector is one file, `ui/vibetribe.html`, without a library, and Biome checks its script too (hence `window.connectElgatoStreamDeckSocket = …`). The default "on" exists twice: `PREFER_PINNED_DEFAULT` and `settings[KEY] !== false` in the page (`manifest.test.ts` checks the page, `settings.test.ts` the constant).
