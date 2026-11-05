# 0011: Setup from the plugin, a Node copy as hook runtime, WSL by click

- Status: accepted (2026-10-18), extends 0002 and 0005

## Context
- VibeTribe is to appear for free in the Elgato Marketplace (user, 2026-10-18). A Marketplace user gets only the `.streamDeckPlugin` package: no repo, no pnpm, often no Node.js, no terminal on Windows. Until now `reporter.mjs setup` set up the hooks by hand, on Windows and in WSL, with the user's `node` (`process.execPath`).
- New plugins must be DRM-ready (since 2026-01-19): the plugin's files are immutable and possibly encrypted, and the manifest isn't read at runtime.
- Stream Deck brings its own Node: `%APPDATA%\Elgato\StreamDeck\NodeJS\<version>\node.exe` (measured 2026-10-18: `24.13.1` for the plugin, next to it `20.20.0`, list in `NodeJS\manifest.json`). The folder carries the version; an app update brings a new folder, and whether old ones stay isn't promised.
- In WSL the reporter runs as a Linux process (statusline passthrough, host detection via `WSL_DISTRO_NAME`). A Windows `node.exe` through interop would be a Windows process there: wrong host, and the existing statusline would run in the wrong shell.

## Decision
- **Setup only on click:** the Property Inspector of every VibeTribe action shows "Claude Code hooks" with "Set up hooks" / "Update hooks" / "Remove hooks". Without this click the plugin never changes `~/.claude/settings.json`. For this the plugin calls the reporter's setup functions (`@vibetribe/reporter/setup`: `install`, `uninstall`, `setupState`) in its own process; there is no second copy of the logic. The status key shows "Setup" while the hooks are missing or outdated (source `setup` of the hub).
- **Hook runtime = copy of Stream Deck's Node:** setup copies the running `node.exe` (Stream Deck's) to `%USERPROFILE%\.vibetribe\node-<version>.exe` (`process.versions.node`); hooks and statusline call this copy. An existing copy of the same version is never replaced, because Windows locks an `.exe` while a hook runs it (nearly always while Claude Code runs). Setup then deletes other copies unless they are locked; the copy the previous settings name stays, because running sessions still use it. After an update there are thus up to two copies until the next update.
- **Reporter in the plugin code:** the reporter's bundle is embedded as text in `bin/plugin.js` and written to `%USERPROFILE%\.vibetribe\reporter.mjs` during setup. The plugin never reads its own folder.
- **Reliable start:** the search for the WSL distribution never blocks connecting to Stream Deck; it runs in the background (up to 15 s), again on each opening of the page, until it finds something. The WSL source then joins the running hub.
- **Token at start:** the plugin creates `%USERPROFILE%\.vibetribe\token` at start if missing (like the port file). The hub thus accepts events as soon as the hooks are set up, without a restart.
- **WSL by a second click:** the plugin finds the default distribution through `wsl.exe -l -v` (the line with `*`, regardless of language; `VIBETRIBE_WSL_DISTRO` takes priority) and then shows "Set up in WSL" / "Remove from WSL". The click starts `wsl.exe -d <distro> --cd ~ -e sh -lc …` with the distribution's Linux `node` (20 or later, from the login `PATH`) and the reporter from `%USERPROFILE%\.vibetribe` (via `wslpath`). Without `node` in WSL, the Property Inspector explains what is missing. Without WSL there is neither the WSL source nor the WSL buttons.

## Alternatives
- **Stream Deck's Node directly as hook runtime:** no copying, but the path carries the version and changes with app updates; every hook would then fail until the user sets up again. Rejected.
- **Write the path anew at each plugin start:** changes `settings.json` without a click (against the user's requirement) and doesn't help between update and start. Rejected.
- **Claude Code's runtime:** the native `claude.exe` contains no callable Node; Bun via `BUN_BE_BUN` is undocumented. Rejected.
- **Windows `node.exe` through interop for WSL:** wrong host and wrong shell for the statusline (see context). Rejected.
- **Only a command line to copy for WSL:** still needs `node` in WSL and a terminal; the click does the same without typos. Rejected; the error message says Node.js 20 or later is needed in WSL.
- **Reporter as a file in the plugin folder (`bin/reporter.mjs`):** possibly encrypted under DRM. Rejected.

## Consequences
- Each copy takes about 90 MB in `%USERPROFILE%\.vibetribe`; it isn't updated with Stream Deck until the user sets up again. It runs only the reporter.
- A new plugin version with a changed reporter shows "Setup" until the user clicks "Update hooks" (`setupState` = `outdated`).
- Whoever uninstalls the plugin without clicking "Remove hooks" first keeps the hooks; they stay harmless (fail-open) and can be removed without the repo (README, "Uninstall": the copy `node-<version>.exe` with `reporter.mjs setup --uninstall`).
- In WSL, setup needs Node.js 20 or later on the login `PATH` (`~/.profile`); older `apt` packages (Ubuntu 22.04: 12, 24.04: 18) and `nvm`/`fnm` only in `~/.bashrc` aren't enough, and the page says so. The reporter is built for Node 20 and ran on 20.20.0 and 24 on 2026-10-18.
- The SDK (`@elgato/streamdeck` 3.0.2) writes its own log to `<plugin folder>/logs`; the SDK offers no way to change this. These are generated files, not shipped ones; whether DRM allows this is shown by the DRM build from the Maker Console before release.
- The plugin now depends on the package `@vibetribe/reporter` (only its setup part); the reporter itself stays independent.
