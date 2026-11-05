---
paths:
  - "packages/reporter/**"
  - "packages/protocol/**"
  - "packages/plugin/src/setup/**"
  - "packages/hub/src/compose.ts"
  - "packages/hub/src/sessions/ports.ts"
---

# Reporter and setup

- Reporter failures never reach Claude Code: exit 0 always, no stdout in hook roles.
- Only a click in the Property Inspector changes `~/.claude/settings.json` (`SetupController.handle`). Start, `refresh` and opening the page only read (`setupState`). The plugin itself writes the token and port file in `%USERPROFILE%\.vibetribe` at start.
- The hooks start the copy `~/.vibetribe/reporter.mjs` (per host), not `dist/`. A reporter change takes effect once that copy is replaced atomically; users see `Setup` until they click "Update hooks".
- The reporter reads the port file on every call next to the token (`hubUrlOf`). A `hubUrl` in `config.json` wins; `http://127.0.0.1:43710` from older setups doesn't count.
- Windows hooks run `%USERPROFILE%\.vibetribe\node-<version>.exe`, a copy of Stream Deck's Node. An existing copy is never overwritten, because Windows locks it while a hook runs. Other copies are deleted only after `settings.json` is written, except the one the previous settings name, and delete failures don't count.
- `wsl.exe` swallows backslashes in arguments, so Windows paths go in with forward slashes (`wslSetupArgs`). It answers in UTF-16 (UTF-8 with `WSL_UTF8=1`, `decodeWslOutput`) and writes its own errors to stdout.
- The default distribution comes from `wsl.exe -l -v` (the `*` line; `docker-desktop…` doesn't count). The search never runs before `streamDeck.connect()`, only in the background (`SetupController`), and the WSL source joins via `RunningHub.addSource`. `VIBETRIBE_WSL_DISTRO=none` turns WSL off without calling `wsl.exe`.
- Setup in WSL needs Node.js 20 or later on the login `PATH` (`sh -lc` reads `~/.profile`, not `~/.bashrc`). Exit 127 = no `node`, exit 4 = too old. The reporter is built for Node 20 (`target` in `packages/reporter/build.mjs`); raising it means raising `WSL_MIN_NODE` too.
- The event envelope and the port file are the only shared contracts (`packages/protocol`).
