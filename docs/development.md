# Development reference

All commands run from the repo root, in the Linux environment that holds the repo (the project is developed in WSL). Commands under "On the real machine" change it or start with its credentials: run them only when the machine's owner agrees. Those starting a Windows process are the only commands that run from Windows against the repo.

## Everyday

| Command | What it does |
|---|---|
| `pnpm install` | Dependencies (pnpm 10, Node 24) |
| `pnpm exec biome check --write .` | Formats and sorts imports; run before `pnpm check` |
| `pnpm check` | Biome, strict TypeScript and vitest; must pass before every commit |
| `CI=true pnpm check` | Exactly like GitHub Actions |
| `CI= pnpm test …` | Writes new file snapshots (`__snapshots__/*.svg`), which CI never does on purpose; add `-u` to update, then check the diff |
| `pnpm vitest run -t "…"` | Runs matching tests; always quote the filter, an unquoted `>` creates empty files in the repo |

## Tiles

| Command | What it does |
|---|---|
| `pnpm tiles:measure` | Measures every tile text and symbol in both variants with resvg; fails outside the safe area [10, 134] px, below 18 px, or on overlaps. Required after any change to tiles, words or font sizes (skill `tile-check`) |
| `pnpm gallery` | PNG gallery of all tiles in `out/gallery/<comfortable\|compact>/` (144 and 72 px), overview `out/gallery/index.html` |
| `pnpm deck:render <scenario> --after <ms> [--tz <zone>] [--variant comfortable\|compact]` | Renders a scenario's deck state after `<ms>` to `out/deck/<name>.html`; also shows breathing phases |

## Without a Stream Deck

`pnpm plugin:headless` runs hub and deck on port 43799 (it refuses 43710 and the fallback ports), with a mirror at `/debug/keys`.

- Remote sessions without the real interface: `VIBETRIBE_REMOTE_FIXTURE=packages/hub/fixtures/remote/sessions.json pnpm plugin:headless`.
- Press keys through stdin: `press mk2:1:0` or `long mk2:1:0`, then Enter. Jumps are only logged and appear under the jumps heading on `/debug/keys`.

`pnpm hub:simulate <scenario.jsonl> [--url …] [--token-file …]` plays a scenario from `packages/hub/fixtures/scenarios/` (host `sim`) against a running hub and finds the Windows token from WSL itself. If the plugin runs on a fallback port, pass `--url http://127.0.0.1:<port>`.

## Build and package

| Command | What it does |
|---|---|
| `pnpm --filter @vibetribe/reporter build` | Bundles the reporter to `packages/reporter/dist/reporter.mjs` (one file, `node:` imports only) |
| `pnpm hub:build` | Bundles the hub to `packages/hub/dist/hub.mjs` |
| `pnpm plugin:build` | Bundles the plugin to `packages/plugin/dev.h2k.vibetribe.sdPlugin/bin/plugin.js` and generates the bundled profile `profiles/VibeTribe.streamDeckProfile` (git-ignored, `scripts/bundled-profile.ts`) |
| `pnpm plugin:pack` | Builds, runs `streamdeck validate`, packs to `dist/dev.h2k.vibetribe.streamDeckPlugin` and writes Maker Console media to `dist/marketplace/`; with DejaVu Sans installed it also refreshes `docs/readme/setup.png`. The thumbnail and `gallery-1-deck` need the official MK.2 image (`VIBETRIBE_DEVICE_IMAGE`, default `assets-local/mk2-front.png`); without it the command still packs and names what it skipped |

## On the real machine (consent)

- `node packages/reporter/dist/reporter.mjs setup [--uninstall]` adds or removes hooks and the statusline passthrough in `~/.claude/settings.json` (backup, atomic). Order: Windows first (through the `\\wsl.localhost` path, creates the token), then WSL.
- `pnpm plugin:deploy` copies the plugin to `%APPDATA%\Elgato\StreamDeck\Plugins\dev.h2k.vibetribe.sdPlugin`. Then quit the Stream Deck app **completely** and start it again: `streamdeck://plugins/restart/dev.h2k.vibetribe` does nothing outside developer mode, and a first install needs the restart too. A `.streamDeckPlugin` of the same version isn't reinstalled by the app, so deploy instead.
- `node <path>\packages\hub\dist\hub.mjs` starts the hub on its own under Windows and reads real session files and credentials. Never alongside the plugin.
- `pnpm profile:layout show <ProfilesV3>` and `apply <ProfilesV3> <layout.json> [--write]` rearrange page 1 of the MK.2 profile and move other keys with their images to page 2. Other keys stay byte for byte; it aborts rather than lose anything; without `--write` it only previews. `--write` refuses while `StreamDeck.exe` runs, backs up both manifests as `manifest.json.vibetribe-<time>.bak`, writes atomically (page 2 before page 1), reads back and restores on failure. `--i-checked-streamdeck-is-closed` overrides only "can't check", never a running app. Back up `%APPDATA%\Elgato\StreamDeck\ProfilesV3` first.
- `pnpm e2e:live --spend-tokens` is a real end-to-end run that **costs tokens** (Haiku, one turn "ok", at most $0.05 per host): `claude -p` in a throwaway folder with the installed hooks against the hub in the running Stream Deck app. Never add `--bare`: it switches off the hooks and makes the test worthless. It checks Haiku without an API key, hooks, Done on the deck, the session file and the disappearance at the end via `/debug/state.json`, and prints the cost. Never in `pnpm check` or CI: without the flag or with `CI` set it exits 2. If aborted early, its session stays on the deck until the hub removes it. Windows uses `claude.exe`; WSL only if `claude` is on the `PATH`.

## Read-only check

`pnpm drift` checks, read-only and without a model call, whether the undocumented interfaces still look the way the code reads them: Desktop folder, pins, Desktop session files, session files on Windows and WSL, credentials, session list, usage, ports, port file, the running hub and the plugin folder. One line per assumption (`ok`, `changed: …`, `skipped: …`), exit 1 on drift, never titles, ids, content or tokens. Run it after each update of Claude Desktop, Claude Code, Windows or WSL, and whenever pins, "seen" or jumps silently stop working. It needs no consent.

## Debugging

- Hub: `http://127.0.0.1:<port>/debug` and `/debug/state.json`. The port is in `%USERPROFILE%\.vibetribe\port` or the log line `hub listening on …`, usually 43710.
- Plugin: `/debug/keys` (HTML) and `/debug/keys.json` mirror the last accepted images. The page reloads each second and can't show breathing at 4 frames/s; use `pnpm deck:render --after` for that.
- Logs: `%APPDATA%\vibetribe\logs\hub.log` and `plugin.log`.
- Environment variables: `VIBETRIBE_MAX_FRAMES` (1–100, default 10) and `VIBETRIBE_VARIANT` (`comfortable` by default, or `compact`; anything else falls back to `comfortable`) reach the plugin only after a full restart of the app (on Windows e.g. `setx VIBETRIBE_VARIANT compact`).

## Documentation language

Product text, code, comments, commits, ADRs and agent guides are English. The spec, design notes and research are German.
