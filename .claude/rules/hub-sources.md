---
paths:
  - "packages/hub/**"
  - "packages/plugin/scripts/drift.ts"
  - "packages/plugin/src/compose.ts"
---

# Hub and its sources

## Remote sessions

- `/v1/code/sessions` is undocumented. The parser is tolerant; a schema change shows as the error "unexpected response" of source `sessions:remote`, not as an empty list.
- The API returns ids as `cse_<X>`, local files carry `session_<X>`. The client normalises to `session_<X>`; matching, jump links and fixtures rely on it.
- A new turn (Done) of a remote session counts only after observed non-idleness or `unread` going `false` → `true`. `last_event_at` moving on its own doesn't count.
- `review_ready` (bucket or category) is finished like `completed` (`DONE_VALUES` in `remote/api.ts`). `need_input` wins before that, but a question at the end of a turn is input only until the turn is read (`unread = false` with a quiet worker → `idle`, then seen).
- After every plugin restart each unread finished remote turn reports Done once. That isn't a bug.
- Looked-at questions (ADR 0012): `RemoteTracker.ack` remembers the `last_event_at` of a waiting session with a quiet worker (`RemoteSession.quiet`); `#calm` passes it to the store as `idle` until the value changes, it stops waiting or its worker runs. This survives list outages (`forget` deliberately keeps it) and lives only in memory. Remote sessions have no Claude Desktop file, so opening them there can't be detected.
- Cloud sessions: `REMOTE_ENVIRONMENT_KINDS` in `remote/api.ts` (default `["bridge"]`, `"all"` shows every kind).
- Bridge ids of local sessions are held by `LocalBridges` (`remote/local-bridges.ts`), not `hub.ts`.
- Token refresh only through `claude -p /cost` (`REFRESH_ARGS` in `usage/refresh.ts`), never a model call. Each attempt logs `token refresh: ok` or `token refresh: no change`.

## Ports

- WSL with mirrored networking reserves a moving block of 4096 ports on Windows too, invisible to `netstat`, and 43710 can be inside it. The plugin then binds the first free port from `FALLBACK_PORTS` (`compose.ts`) and otherwise retries every `BIND_RETRY_MS` (5 s, `http/listener.ts`).
- A closed `Listener` no longer tries ports. `RunningHub.port` is `null` while no port is bound (also after `close()`); `open_debug` opens only with a port.
- The health value `ingress` (port failure, missing token) is set only by the `Listener`, never by the plugin's composition, or a later bind would clear the token warning.
- `hub.mjs` tries only the first port and exits with 2 if it is taken.

## Background jobs

- They live in `%APPDATA%\vibetribe\background.json` (ids and kinds only; entries not yet restored keep their original `savedAt` and expire after 6 h). Tests and headless mode never write the file; only `windowsHubConfig` wires it.
- `keepBackgrounds`: after a failure at most one new attempt per `BACKGROUND_RETRY_MS` (30 s); `canSave` blocks writing. `startHub` allows it only while the listener runs and isn't stopped.

## Claude Desktop state

- Internal to Desktop and read-only (ADR 0008, 0009). Pins: `claude_desktop_config.json`, `preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder`, entries `code:local_<uuid>`. Desktop can move the folder with an update; `/debug` then shows no pins.
- Pins work only through `hostSessionId` from the session file. Pinned remote sessions live in claude.ai's IndexedDB and aren't read.
- `readDesktopPins` returns `null` for "unreadable right now" (the last pins stay) and `[]` for "no file or another form". Never mix them up.
- "Seen in Desktop" reads `lastFocusedAt` from `claude-code-sessions\<ws>\<acct>\local_<uuid>.json`, only for waiting Desktop sessions (`DesktopFocus`, paths from a scan, rescanned only for an unknown id). Never read all files per tick: they total megabytes.
- There is one loop for Desktop's state: `pollDesktop` in `desktop-poll.ts` (`DESKTOP_POLL_MS`). Don't add a second.
- The rule is `episodeSince < lastFocusedAt ≤ now`, compared after reading, marked through `Hub.markSeen`. A session already open gets no new `lastFocusedAt`, so its Done stays on purpose; don't add a "Desktop is in front" heuristic.

## Drift checks

- Format knowledge exists once: `hub/src/doctor/` calls the production parsers and mappers. To adapt a format, change the parser. New values of the remote list belong in `KNOWN_REMOTE_VALUES`, or `pnpm drift` reports them as `changed`.
- The hub checks only `desktop folder`, `desktop pins`, `desktop session files` and `port file` hourly (`HubConfig.drift`) and logs only changes (`drift: …`, `drift resolved: …`); `skipped` changes nothing. New checks there need neither tokens nor WSL.
- The usage request of `pnpm drift` counts at the endpoint and can push the hub into its 429 backoff, leaving the limit tiles on `As of …` for up to 30 min. Don't run it in a loop.
- The session check counts only files of live pids and fields only on live processes: WSL holds hundreds of old `<pid>.json`. An unreadable Windows process list makes only `session files (Windows)` `skipped`.
- The remote list check also reports `no usable id` and missing string fields, using the mapper's selection (`isShownRemote`).
- What needs side effects (opening a link → `lastFocusedAt`, `claude://` handler, Property Inspector, tiles on the device, token refresh) stays a manual check; the list is in spec §11.3.
