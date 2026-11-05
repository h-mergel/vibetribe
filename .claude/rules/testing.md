---
paths:
  - "**/*.test.ts"
  - "**/test/**"
---

# Tests

- Tests never bind fixed ports: use port 0 or a port the test itself holds (`block()` in `listener.test.ts`, `freePort()` in `plugin/test/helpers.ts`). A fixed port can sit in WSL's reserved block.
- The guard `test/real-ports-guard.mjs` (vitest `setupFiles`) keeps every test and started Node process off 43710 and the fallback ports, and rebinds if port 0 lands on one. It travels via `NODE_OPTIONS`: when setting that for a child process, append instead of replacing. If `FALLBACK_PORTS` changes, `GUARDED_PORTS` must follow (a test compares them).
- Tests that press a slot must run `tick` once first.
- Use `createRundll32Opener` only with a fake `spawn`, or Claude Desktop opens.
- Never read the real profile: use fake `DirPort`s or temporary paths (`desktopConfigFiles(desktopDirs(env, home))`, `readDesktopPins` with a fake `read`, `windowsHubConfig` with `home`/`env`). The bundle's smoke test points `LOCALAPPDATA` at its scratch folder. `scan` in `hub/test/background-fixtures.ts` takes any session list.
- Tests never call `wsl.exe`.
- New file snapshots (`__snapshots__/*.svg`) are written only with `CI` empty; commit them, and check the diff after `-u`.
- Quote test filters fully (`pnpm vitest run -t "…"`): an unquoted `>` creates empty files in the repo.
