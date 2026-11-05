# 0006: Remote sessions via the account's session list, `HostKind` `remote`

- Status: accepted (2026-10-13), partly superseded by 0007 (handler check at start)

## Context
Sessions on another machine (a MacBook) were meant for a Mac agent with Tailscale. Probe J2 shows: the session list that Claude Desktop and claude.ai use (`GET /v1/code/sessions`, OAuth) contains every session with Remote Control, without an agent and without opening the network. It doesn't name a session's machine. The core knew `mac` as a third origin; nothing had been delivered for it yet.

## Decision
- New source `sessions:remote` in the hub: the list every 20 s (measured in probe J2b: 15 requests at 20 s intervals, all 200, no 429) with the usage poller's token (read-only), backoff up to 5 min, a tolerant parser. A session is remote as long as no local session file carries its `bridgeSessionId`.
- Ids: the API returns `cse_<X>`, local files `session_<X>` (probe J2c). The client normalises both to `session_<X>`; `RemoteSession.id` always has this form, so matching, jump links and display stay uniform.
- Turns: a turn already reported counts as new only if `last_event_at` changed and the hub has since seen the session not idle, or `unread` went from `false` to `true`. `last_event_at` merely moving on (probe J2b: 3 in 15 requests, J2c: 0, cause unknown) triggers no new Done.
- `HostKind` `mac` is renamed to `remote` (badge and status line `REM`): "another machine" instead of "a Mac". `hostKindOf` already maps hook events from a reporter on a Mac to `remote`. A future Mac agent with heartbeats would have to report its source as `sessions:remote` or be mapped there on the status key; the code doesn't do that today.
- Only sessions with `environment_kind = bridge` (Remote Control) and entries without the field are shown; a constant (`REMOTE_ENVIRONMENT_KINDS`) can add e.g. cloud sessions.
- Protocol v1 stays unchanged: `source.os` is the reporter's operating system (`mac` stays valid), as does the host id `mac:<hostname>`. The hub explicitly maps `os = mac` to `remote` (`hostKindOf`), which decouples `OsKind` and `HostKind`.
- Jumps go through a port `JumpOpener`; on Windows `rundll32 url.dll,FileProtocolHandler` with a checked `claude://` link. `rundll32.exe` and `reg.exe` start from their absolute path under `%SystemRoot%\System32`, never through the search path. `opened` only means "Windows accepted the link": the plugin can't see whether Desktop comes to the front (foreground lock) or whether the versioned MSIX handler still exists. It checks the handler once at start (alongside, without delaying the start, never in headless mode) and warns in the log, also if the entry can't be read ("could not be read").

## Alternatives
- `remote` in addition to `mac`: two terms for the same behaviour (heartbeat, `no_signal`), without benefit.
- Switch the protocol to `remote`: breaks wire format v1 for a mere naming change; the operating system remains correct information.
- Mac agent first: installation on the Mac, Tailscale, a firewall rule: a lot of upkeep for the same view.

## Consequences
- Dependence on another undocumented interface: outages become `no_signal` (90 s), then removal (210 s); the status key's REM is missing.
- Coarser than hooks: no tool name, no distinction between approval and question, no background jobs, up to 20 s delay.
- Titles from the list sit in local state (debug page, jump log); tokens never.

## Addendum (2026-10-14)

- "The status key's REM is missing" means: the REM line of the status key always exists while the remote list is configured (source `sessions:remote`). During an outage it shows `down` (health `missing`), without configuration `off`. The decision itself stays unchanged.
