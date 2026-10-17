# Technical research: Claude Code session status on Stream Deck (Windows hub, WSL / Desktop / Mac sessions)

Date: 2026-10-10. Scope: read-only research (web docs + local file inspection). No secrets are reproduced here. Hook secrets, OAuth tokens, `.key` files, registry blobs and session IDs were deliberately not copied.

Legend:
- **[V]** verified, with a source (URL)
- **[L]** verified locally on this machine (file/command inspected)
- **[I]** inferred or unverified. Treat as a design assumption to test.

Local environment facts [L]: Stream Deck app 7.6.0.23012 (registry `last_started_streamdeck_version`, `StreamDeck.exe` ProductVersion). Claude Code 2.1.295 (from `version` in session files). The installed Agent Vitals plugin (v1.8.2.0, `SDKVersion: 2`, `Nodejs.Version: "20"`) is locally patched. It moves the hook port 45623 to 43623 because 45623 is inside the WSL ephemeral range, and it adds WSL session discovery and a Desktop deep link (see `bin/plugin.mjs` vs `bin/plugin.mjs.bak-port45623`).

---

## 1. Claude Code data sources

### 1.1 Hook events (docs: https://code.claude.com/docs/en/hooks)

[V] Common input fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`. The page also lists `prompt_id`, `scratchpad_dir` and `effort` as common fields.

[V] Handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent` (experimental).

[V] Default timeouts:
- 600 s for `command`, `http` and `mcp_tool`.
- 30 s for `prompt`; 60 s for `agent`.
- 30 s on `UserPromptSubmit` and the model-switch events.
- SessionEnd hooks share a 1.5 s budget, which can be raised to 60 s.

[V] 33 events exist. The ones that matter for status:

| Event | Fires | Key input fields | Relevance |
|---|---|---|---|
| `SessionStart` | start, resume, clear, compact, fork (`source`) | `source`, `model`, `agent_type`, `session_title`. On resume/fork (v2.1.251+) also `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` | register session → idle |
| `UserPromptSubmit` | prompt submitted | `prompt`, optional `session_title` | → working |
| `PreToolUse` | before a tool call | `tool_name`, `tool_input`, `tool_use_id` | activity / working. `AskUserQuestion` → needs input |
| `PermissionRequest` | a permission dialog would be shown | like PreToolUse minus `tool_use_id`, plus `mcp_server` for MCP tools, optional `permission_suggestions[]` | → needs permission. **Can decide** |
| `PermissionDenied` | auto mode denies | – | error/info |
| `PostToolUse` / `PostToolUseFailure` / `PostToolBatch` | after tools | `tool_response`, `duration_ms` | activity |
| `Notification` | notifications | `message`, `title`, `notification_type` ∈ `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*` | needs permission / needs input / idle |
| `Stop` | turn finished | `stop_hook_active`, `last_assistant_message`, `background_tasks[]`, `session_crons[]` | → finished |
| `StopFailure` | turn ended by API error | `error` ∈ `rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown`…; `error_details` | → **error** state |
| `SubagentStart` / `SubagentStop` | subagents | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message` | optional sub-activity |
| `PreCompact` / `PostCompact` | compaction | `trigger` (`manual`/`auto`), `custom_instructions` / `compact_summary` | "compacting" sub-state |
| `SessionEnd` | exit | `reason` ∈ `clear`, `resume`, `logout`, `prompt_input_exit`, `other` | remove session |
| also | `Setup`, `UserPromptExpansion`, `MessageDisplay`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate/Remove`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult` | | |

#### PermissionRequest decisions [V]

Output format:

```json
{"hookSpecificOutput":{"hookEventName":"PermissionRequest",
  "decision":{"behavior":"allow"|"deny","updatedInput":{...},"updatedPermissions":[...],"message":"...","interrupt":true}}}
```

- `allow` cannot override a matching deny rule. `updatedInput` is re-checked against deny/ask rules.
- `message` and `interrupt` apply only to deny.
- Exit 2 is not honored for this event. A hook that returns no decision leaves the normal dialog flow unchanged.
- **"Always allow" suggestions:** `permission_suggestions` entries look like `{type:"addRules", rules:[{toolName, ruleContent}], behavior:"allow", destination:"localSettings"}`.
  - Types: `addRules`, `replaceRules`, `removeRules`, `setMode` (`default|auto|acceptEdits|dontAsk|bypassPermissions|plan`), `addDirectories`, `removeDirectories`.
  - Destinations: `session`, `localSettings`, `projectSettings`, `userSettings`.
  - To make "Always" work, echo one suggestion back in `updatedPermissions`.
  - The docs warn that this array "isn't an exact list of dialog options". Some options, such as switching to auto mode, have no entry.
- **Concurrency:** Desktop and VS Code host Claude Code via `canUseTool`. There, hooks run alongside the host UI and "whichever decides first applies". A `permission_prompt` Notification fires about 6 s after the request unless it is answered sooner.
- **Non-interactive:** if no hook decides, the call is denied.

How Agent Vitals implements approvals [L] (`plugin.mjs`, `src/approve.js` / `src/hookserver.js`):
- It installs one **HTTP** hook: `"PermissionRequest": [{"matcher":"","hooks":[{"type":"http","url":"http://127.0.0.1:<port>/permission/<secret>","timeout":<hold+3>}]}]`.
- The secret is ≥32 chars, compared constant-time, and carried in the URL path. The server accepts only Host `127.0.0.1:<port>`/`localhost:<port>`, POST only, body ≤1 MB.
- Hold timeout: default 20 s, plus a 3 s pad. Queue max 8. On timeout, eviction or the session moving on, it responds `{}` (no decision), so the normal dialog applies.
- `ALLOW` → `{behavior:"allow"}`. `DENY` → `{behavior:"deny", message:"Denied from Stream Deck"}`.
- `ALWAYS` → `{behavior:"allow", updatedPermissions:[entry]}`, only if the suggestions contain **exactly one** `addRules`/`allow` entry with exactly one rule. It is refused for `mcp__*` tools, and the destination is forced to `session` or `localSettings`.
- A deny is remembered for 30 s so that an immediate retry cannot be "Always"-ed.
- `AskUserQuestion` permission requests are treated as **input-needed**, not approvable.
- A request is dropped as stale when the session file's `statusUpdatedAt` or the transcript mtime advances (the user answered in the terminal).

#### HTTP hooks [V]

- Fields: `url`, `headers` (`$VAR`/`${VAR}` interpolation only for names in `allowedEnvVars`), `allowedEnvVars`, `timeout`, `onFailure` (`continue` default, or `block`; v2.1.295+).
- Responses:
  - 2xx with empty body = success.
  - 2xx with a JSON body is parsed like command-hook output.
  - Non-2xx or connection failure = non-blocking error, execution continues. This makes a stopped deck fail open.
- Admin/user knobs: `allowedHttpHookUrls`, `httpHookAllowedEnvVars`, `disableAllHooks`, `allowManagedHooksOnly` (https://code.claude.com/docs/en/settings-reference).
- [I] Useful trick: an HTTP hook can carry terminal identity in headers, for example `"headers":{"X-WT-Session":"$WT_SESSION","X-Tmux-Pane":"$TMUX_PANE"}` with `allowedEnvVars:["WT_SESSION","TMUX_PANE","TERM_PROGRAM"]`. This gives jump-to-session data without a command hook.

#### `terminalSequence` [V]

Any hook can return `terminalSequence`, and Claude Code writes it through its own terminal path. Allowlist:
- OSC 0/1/2 (titles)
- OSC 9 (Windows Terminal notifications incl. `9;4` taskbar progress)
- OSC 99, OSC 777
- BEL

Everything else (CSI, OSC 8, OSC 52, OSC 1337) is rejected. This is the sanctioned way for a hook to retitle the tab or tab-progress the session.

#### Plugin-packaged hooks [V] (https://code.claude.com/docs/en/plugins-reference)

- A Claude Code plugin ships `hooks/hooks.json` (wrapped in a top-level `"hooks"` key) and merges with user/project hooks.
- Placeholders: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` (persistent), `${CLAUDE_PROJECT_DIR}`.
- `userConfig` prompts the user at enable time. `sensitive:true` values go to the OS credential store. Values are exposed to hooks as `CLAUDE_PLUGIN_OPTION_<KEY>`, or as `${user_config.KEY}` in exec-form `args`.
- Install is one command: `/plugin install <name>@<marketplace>` or `claude plugin install …`. `claude plugin validate` checks the manifest.
- **Important limits:**
  - A plugin's `settings`/`settings.json` can only set `agent` and `subagentStatusLine`. **A plugin cannot install a `statusLine`.** [V]
  - **Plugins are not available in Claude Desktop WSL sessions yet** (https://code.claude.com/docs/en/desktop-wsl: "connectors and plugins" are listed as unavailable). For Desktop-in-WSL sessions, hooks must go into `~/.claude/settings.json` inside the distro. [V]
  - Desktop otherwise shares hooks/settings with the CLI: "Hooks and skills defined in settings apply to both" (https://code.claude.com/docs/en/desktop). [V]
- Monitors (`experimental.monitors`) can run a persistent background process per session, but only in interactive sessions. [V]

### 1.2 Statusline JSON (https://code.claude.com/docs/en/statusline) [V]

- Fields:
  - `session_id`, `session_name`, `transcript_path`, `cwd`, `workspace.{current_dir,project_dir,added_dirs,git_worktree,repo.*}`, `model.{id,display_name}`, `version`
  - `cost.{total_cost_usd,total_duration_ms,total_api_duration_ms,total_lines_added,total_lines_removed}`
  - `context_window.{total_input_tokens,total_output_tokens,context_window_size,used_percentage,remaining_percentage,current_usage}`, `exceeds_200k_tokens`
  - `fast_mode`, `effort.level`, `thinking.enabled`, `prompt_cache`, `prompt_id`, `pr.*`, `worktree.*`, `agent.name`, `vim.mode`, `output_style.name`
  - **`rate_limits.five_hour.{used_percentage,resets_at}`**, **`rate_limits.seven_day.{…}`**, and `rate_limits.spend_limit.*` (gateway only). `resets_at` is in Unix epoch seconds.
- Caveats:
  - `rate_limits` appears only for Pro/Max subscribers (or behind a gateway with spend limits), only after the first API response, and each window drops once its reset passes.
  - `cost.total_cost_usd` is a client-side estimate at list price (or `modelPricing`). It resets on `/clear`.
- Refresh triggers: each assistant message, `/compact`, permission-mode change, optional `refreshInterval` (≥1 s), rate-limit reset, prompt-cache expiry. Updates are debounced at 300 ms. The statusline is hidden during permission prompts.
- [I] The statusline is a terminal-UI feature. Desktop Code tab and VS Code extension sessions presumably never run it, so it is not a universal source. It also needs the user's own `statusLine` setting (one per user) and cannot come from a plugin, so a tee-wrapper approach is needed: our script forwards the JSON and then calls the user's previous statusline command.

### 1.3 Usage limits: official vs. unofficial

- **Official:** statusline `rate_limits` (above) is the only documented programmatic source. A May 2026 feature request notes that `/usage` is interactive-only and that there is no `claude usage --json` (https://claudeissues.com/issue/58632-feature-request-add-cli-support-for-querying-5-hour-rolling-quota-in-non-interac). [V-community]
- **Unofficial OAuth endpoint, as Agent Vitals uses it** [L]:
  - `GET https://api.anthropic.com/api/oauth/usage`
  - Headers: `Authorization: Bearer <claudeAiOauth.accessToken>`, `anthropic-beta: oauth-2025-04-20`, `Content-Type: application/json`.
  - Token source: on Windows/Linux, `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`. On macOS, Keychain item service `"Claude Code-credentials"` (`security find-generic-password -s "Claude Code-credentials" -w`), with the file as fallback.
  - Polling: base every 120 s. On 429 the interval doubles up to 900 s. A cache file `usage-cache.json` (30 min validity) lives in the plugin dir. An extra poll fires 8 s after a window's `resets_at`.
  - The plugin **never refreshes tokens**, which is correct: refreshing would rotate the refresh token and can log Claude Code out.
- Response shape [L] (logged by the plugin as "usage raw shape"):
  - `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` / `seven_day_oauth_apps` / `seven_day_cowork` … each `{utilization, resets_at (ISO), limit_dollars, used_dollars, remaining_dollars, locked_reason}` or `null`.
  - `extra_usage {is_enabled, monthly_limit, used_credits, utilization, currency, decimal_places, disabled_reason, …}`.
  - Several opaque code-named buckets.
  - A `limits[]` array with `{kind: "session"|"weekly_all"|"weekly_scoped", group, percent, resets_at, scope.model.display_name}`. Agent Vitals prefers `five_hour`/`seven_day` and falls back to `limits[]`.
  - The shape contains dollars/credits info that could drive a "credits" key.
- Reliability [L]: the local `agent-vitals.log` (since 2026-10-07) contains **94 × HTTP 429** and **71 × HTTP 401** failures.
  - The 401s (from 2026-10-10 08:24 on) look like an expired access token in the Windows `.credentials.json` (last modified 2026-10-09 14:47) while active sessions run in Desktop/WSL. [I]
- Community reports [V-community]:
  - Persistent 429 with `retry-after: 0` since March 2026, still open, no maintainer reply (https://claudeissues.com/issue/30930-…, https://claudeissues.com/issue/31021-…).
  - Reported mitigations: send `User-Agent: claude-code/<version>`, and expect a reset every 3–5 min.
  - Limits may be per access token.
- **Recommendation:** use statusline `rate_limits` plus hook-forwarded data as primary. Use the OAuth endpoint only as an opt-in fallback: ≥5 min interval, honor backoff, never refresh, read the token from the *most recently refreshed* credentials file (Windows vs WSL vs Mac), and show "stale since …" instead of failing.

### 1.4 `~/.claude/sessions/<pid>.json` [L, partly V]

- **Who writes them:** each Claude Code process writes `<pid>.json` (CLI and Desktop-hosted alike). Observed `entrypoint` values: `claude-desktop` (Windows: 3/3; WSL: 610/611), `cli` (1).
- **Documented counterpart:** `claude agents --json` (v2.1.145+, `waitingFor` since v2.1.162) prints `cwd`, `kind`, `startedAt`, `id`, `state` (`working|blocked|done|failed|stopped`, background sessions), `pid`, `status` (`busy|waiting|idle`), `waitingFor` (`permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`), `sessionId`, `name` (https://code.claude.com/docs/en/agent-view). The JSON files themselves are **not** documented: use them as an internal, best-effort source.
- **Fields observed** (Windows 3 files, WSL 611 files):
  - `pid`, `sessionId` (uuid), `cwd`, `startedAt`, `procStart`. Windows uses FILETIME-like digits; Linux uses clock ticks.
  - `version`, `peerProtocol` (1), `peerFeatures` (`["notify_idle","artifact_yield"]`, WSL adds `"reply_across_default_dirs"`).
  - `kind` (`interactive`), `entrypoint`.
  - `hostSessionId` (`local_…`, Desktop sessions), `bridgeSessionId` (some; likely Remote Control [I]).
  - `pidDomain` (`win32:<hostname>` or `linux:<id>:pid:[<ns>]`), `messagingSocketPath` (`\\.\pipe\LOCAL\cc-msg-…` or `/run/user/1000/cc-socks/<pid>.sock`).
  - `name`, `nameSource` (`user`), `nameSince`, `formerNames`.
  - `updatedAt`, **`status`** (`busy|idle|waiting`; Agent Vitals also handles `shell`), **`statusUpdatedAt`** (ms), **`waitingFor`** (observed: `input needed`).
- Pitfalls [L]:
  - Stale files are not cleaned up. The WSL directory has 611 JSON files, 283 of them without `status` (older versions).
  - Liveness must be checked: pid alive + `procStart`/start-time match. Agent Vitals compares process start time vs `startedAt` to detect recycled PIDs. For WSL it checks `\\wsl.localhost\Ubuntu\proc\<pid>\cmdline` contains `claude`, only while `vmmemWSL` is running, so the poller never boots WSL.
  - `<pid>.<hash>.key` files sit next to them. On native Windows these are presumably the named-pipe auth keys for cross-session messaging [I]. Treat them as secrets and never read them.
- Agent Vitals state mapping [L]:
  - `waiting` + `waitingFor ∈ {input needed, dialog open}` → input-needed.
  - Other `waiting` → needs-approval.
  - `busy`/`shell` → working.
  - `idle` and `statusUpdatedAt` < 60 s ago → finished, else idle.
  - No status → transcript mtime < 60 s = working.
  - Polled every 5 s.
- Inbox socket [V] (https://code.claude.com/docs/en/cross-session-messaging):
  - `messagingSocketPath` / `CLAUDE_CODE_MESSAGING_SOCKET` lets local processes post plain-text messages into a session. Native Windows requires an auth line with `CLAUDE_CODE_MESSAGING_TOKEN`.
  - Messages can never approve permissions.
  - WSL sessions and native Windows sessions cannot reach each other.
  - Possible use: a "send canned prompt" key. Not useful for approvals.

### 1.5 Transcripts for cost [L]

- Path: `~/.claude/projects/<slugified cwd>/<sessionId>.jsonl`. The slug replaces `/ \ _ :` with `-` (Agent Vitals `slugifyCwd`). WSL Desktop sessions opened via UNC show up as `--wsl-localhost-Ubuntu-…` on the Windows side.
- `type:"assistant"` lines carry:
  - `message.{id, model, usage}` with `usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}, service_tier, speed, …}`
  - plus `requestId`, `timestamp`, `sessionId`, `cwd`, `entrypoint`, `version`, `effort`.
- **No `costUSD` field.** Cost must be computed.
- **Duplicates are the norm:** in the most recent WSL transcript, 76 of 85 assistant `message.id`s appear on more than one line (streamed content blocks). Dedupe by `message.id` (Agent Vitals keeps the line with the max token total). Pricing comes from a local table (`RATES`, cache-write 1.25×/2×, cache-read multiplier).
- Prefer statusline `cost.total_cost_usd` per session where available. Use transcripts for cross-session daily/5h/7d aggregation.

---

## 2. Claude Desktop `claude://` deep links

- [V] Documented (https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link):
  - `claude://claude.ai/new?q=`, `claude://claude.ai/chat/{id}`, `claude://claude.ai/project/{id}`.
  - `claude://code/new?q=&folder=&file=` (folder needs confirmation).
  - `claude://cowork/new?…`.
- [V] SSH variant (https://code.claude.com/docs/en/desktop): `claude://code/new?ssh_host=user%40host&ssh_port=&ssh_folder=&q=` (Desktop ≥ v2.110.0).
- [V-community] `claude://code/continue?session=<local_id>` is **undocumented**. Issue #90035 (opened 2026-08-27, open; Desktop 1.37937.3, macOS) reports the handler is feature-gated ("code entry deep link gated off"): it only brings the app to the front and does not switch sessions. Workaround: `claude://resume?session=<cli uuid>` switches but imports a duplicate entry (https://claudeissues.com/issue/90035-…).
- [L] Agent Vitals' local patch opens `claude://code/continue?session=<hostSessionId>` via `rundll32 url.dll,FileProtocolHandler` when `hostSessionId` matches `^local_[A-Za-z0-9-]{1,64}$`.
  - Whether the gate is lifted in the installed Desktop build is **unverified**. Desktop logs under `%APPDATA%\Claude\logs` stop at 2026-08-21 and contain no `code/continue` entries.
  - The `local_<uuid>` id format matches Desktop's partition dirs `launch-preview-session-local_<uuid>`.
- Separate scheme [V]: `claude-cli://open?q=&cwd=&repo=` opens a **new** CLI session in Windows Terminal (or PowerShell/cmd). It cannot resume or focus a session (https://code.claude.com/docs/en/deep-links).

---

## 3. Jump-to-session

### 3.1 Windows Terminal

- [V] `wt.exe` can target windows (`-w <id|name|0|last|new>`) and tabs by **index** only: `focus-tab -t <index>` (https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments). There is no CLI to focus by `WT_SESSION` GUID or by title. Execution aliases don't work from WSL, so use `cmd.exe /c wt.exe …`.
- [L] UI Automation works. A read-only UIA enumeration on this machine found Windows Terminal tabs exposed as `ControlType.TabItem` (class `ListViewItem`), `Name` = tab title, supporting `SelectionItemPattern`. Sequence: `Select()` + `SetForegroundWindow(window)`. This is the most direct "focus tab by title" path.
- [V] `WT_SESSION` / `WT_PROFILE_ID` identify WT sessions and are visible inside WSL (https://nickjanetakis.com/blog/how-to-find-your-wsl-2-profile-id-guid). [I] They are presumably propagated via `WSLENV` (not verified here). Windows Terminal exposes no API that maps a `WT_SESSION` GUID to a tab.
- [V-community] Claude Code continuously sets the tab title (spinner + "Claude Code"/session name). `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` reportedly does not always work (https://claudeissues.com/issue/28222-…). Title matching on Claude's own title is therefore fragile.
- Recommended approach [I]:
  1. **Best (sessions we launch):** a deck "new session" key runs `wt -w claude new-tab --title "cc·<shortid>" --suppressApplicationTitle -d <dir> <claude>`. The title is then stable, and jump = UIA select tab by exact Name + foreground window.
  2. **Existing sessions:** forward `WT_SESSION` + pid from a hook (command hook env, or HTTP header interpolation). On jump:
     - (a) UIA-enumerate WT tabs and match on session name or cwd basename in Name.
     - (b) Fall back to EnumWindows title match (what Agent Vitals does today: substring of `name` or cwd basename, then `ShowWindow`+`SetForegroundWindow`).
     - (c) Optionally emit `terminalSequence` OSC 2 from a hook to stamp a recognizable tag. It may be overwritten by Claude's own title updates, so test it.
  3. Foreground-lock: `SetForegroundWindow` from a background process is often refused by Windows. Agent Vitals spawns PowerShell for it. The usual reliable trick is `AllowSetForegroundWindow` / simulated Alt keypress / `AttachThreadInput` [I].

### 3.2 VS Code

- [V] `vscode://anthropic.claude-code/open?prompt=&session=<id>`: "If the session is already open in a tab, that tab is focused". The session must belong to the workspace open in the focused window (https://code.claude.com/docs/en/vs-code). So: first raise the right VS Code window (EnumWindows title contains the folder), then open the URI.
- [I] For the CLI running in VS Code's **integrated terminal**, no Claude URI exists. Option: a tiny companion VS Code extension with `window.registerUriHandler` (`vscode://<pub>.<ext>/focus?pid=…`). It iterates `window.terminals`, compares `await t.processId` with the ancestor shell PID of the claude process, and calls `t.show()`.

### 3.3 Claude Desktop

- Bring the app forward (`shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude`, which Agent Vitals resolves via `Get-StartApps`) [L], then try `claude://code/continue?session=local_…`. This is gated per #90035, so verify on the installed build. [I] An Electron/UIA click on the sidebar session row by title is a possible fallback, but brittle.

### 3.4 Remote Mac (deck on Windows)

"Jump" options, in order of usefulness [I unless noted]:
1. **Remote Control** [V] (https://code.claude.com/docs/en/remote-control):
   - Enable with `--remote-control`, `/remote-control`, or `remoteControlAtStartup:true`. The session is then reachable at claude.ai/code. Jump = open that session URL in a Windows browser.
   - This also gives full answer/approve capability.
   - [I] The session file's `bridgeSessionId` is probably that remote session id. Verify the URL format.
2. **Claude Desktop on Windows using an SSH environment to the Mac** [V: SSH sessions exist; the remote must be macOS/Linux]: the UI lives on Windows, so jump = Desktop deep link (same gating caveat).
3. **ssh + tmux:** the session runs in tmux on the Mac, viewed through an ssh tab in Windows Terminal. Jump = focus that WT tab (UIA), then `tmux select-window/select-pane -t $TMUX_PANE` executed by the Mac bridge. `TMUX_PANE` is captured by the hook.
4. **Screen Sharing / RDP / Parsec viewer on Windows:** focus the viewer window locally, and the Mac bridge raises the right Terminal/iTerm/VS Code window via AppleScript.
   - Agent Vitals' mac code is a working reference [L]: it walks the ps tree from the session pid to the GUI app bundle. For Terminal it matches the tab by `tty`. For VS Code it uses `AXRaise` on a window whose title contains the cwd basename. Requires Automation/Accessibility permissions.
5. Otherwise "jump" degrades to showing details on the deck (name, cwd, waiting reason, last message).

---

## 4. Transport for WSL / Mac → Windows plugin

Facts:
- [V] In WSL **mirrored** mode, Linux reaches Windows servers at `127.0.0.1`; multicast is supported (https://learn.microsoft.com/en-us/windows/wsl/networking).
- [L] Agent Vitals relies on exactly this: an HTTP hook URL `http://127.0.0.1:43623/…` from WSL sessions to the Windows plugin.
- [L] The plugin comment states that ports in 44620–48715 fail with EADDRINUSE because mirrored mode reserves them on Windows. Pick a fixed port outside that range and also outside Windows' own dynamic range (check `netsh int ipv4 show excludedportrange protocol=tcp`) [I].

Recommendation:
1. **Native Windows + WSL (mirrored): no bridge needed.**
   - Claude Code `type:"http"` hooks POST straight to the plugin on `127.0.0.1:<port>`, path-secret or `Authorization: Bearer $SD_TOKEN` via `allowedEnvVars`.
   - Short timeouts for status events (2–5 s). Long hold only for `PermissionRequest`. Fail-open is built in: a non-2xx or connection failure is a non-blocking error.
   - The plugin additionally polls `sessions/*.json` on both sides, the WSL side only while `vmmemWSL` runs (as Agent Vitals does).
   - Hook install:
     - CLI/VS Code on Windows: a Claude Code plugin (`hooks/hooks.json`, one-command install).
     - **Desktop WSL sessions:** `~/.claude/settings.json` inside the distro, because plugins aren't loaded there.
2. **Mac: run a small bridge daemon** (launchd agent, Node single file).
   - Why a bridge and not direct HTTP hooks:
     - jump-to-session needs a Mac-side executor (AppleScript/tmux);
     - `sessions/*.json`, transcripts and Keychain are local;
     - hooks keep hitting `127.0.0.1` on the Mac and stay fast and fail-open when the Windows PC is off.
   - The bridge keeps **one outbound WebSocket** to the Windows plugin and multiplexes: session snapshots/deltas, hook events, held PermissionRequests (request id → decision), and jump commands (Windows → Mac).
   - Network: **Tailscale** (MagicDNS name, WireGuard encryption, NAT/VPN-proof) as the default path. Plain LAN is opt-in.
   - Auth: pairing token (≥32 random bytes) generated in the plugin, shown in the Property Inspector, pasted into the bridge config. Send it as the first WS message or a header and compare constant-time. Allow-list the peer IP / Tailscale CGNAT range.
   - TLS: unnecessary inside Tailscale. On a raw LAN, use TLS with a self-signed cert pinned by fingerprint during pairing, or at least HMAC each message. Approvals are security-relevant and must not travel unauthenticated.
   - Discovery: mDNS/DNS-SD (`bonjour-service`, `_ccdeck._tcp`) is fine on the same LAN. It does **not** cross Tailscale/VPN (no multicast). Always allow a manual host:port.
   - Windows inbound: the plugin must bind a non-loopback interface for remote bridges. Keep the loopback listener separate and keep strict Host checks on it. This needs a Windows Firewall rule for Stream Deck's bundled `node.exe`, scoped to the Private profile or the Tailscale interface.
   - Alternative: the plugin dials out to the bridge. This avoids a Windows firewall rule but needs a macOS listener.
3. Optional WSL bridge: only if NAT mode must be supported, or if `\\wsl.localhost` polling proves too slow. Same protocol as the Mac bridge.

---

## 5. Stream Deck SDK constraints

| Topic | Finding |
|---|---|
| SDK / package | [V] `@elgato/streamdeck` is now **3.0.2** (npm, modified 2026-10-08), Node ≥20.5.1. v3 requires `Software.MinimumVersion` "7.1"; settings events fire only on PI changes; `Action` is a union of `KeyAction`/`DialAction`/`NeoInfobarAction`; `getSecrets` removed (https://docs.elgato.com/streamdeck/sdk/releases/upgrading/v3). Manifest `SDKVersion` allows 2 or 3, "3 recommended"; `Nodejs.Version` "20" or "24" (https://docs.elgato.com/streamdeck/sdk/references/manifest). "SDK v2" in the brief should be re-evaluated: targeting the v2 manifest (`SDKVersion: 2`) blocks Marketplace publishing (next row). |
| Marketplace | [V] Since 2026-01-19 (new plugins) and 2026-02-19 (updates): **DRM compatible, MinimumVersion ≥ 6.9, manifest SDKVersion ≥ 3** (maker.elgato.com notice, via search). DRM rules: "Files distributed in your plugin are immutable", and don't read the manifest at runtime. DRM is enabled by default with CLI ≥1.6. Upload via Maker Console, which offers a downloadable DRM build for beta (https://docs.elgato.com/streamdeck/sdk/introduction/distribution). [I] Do **not** write logs/caches into the `.sdPlugin` dir as Agent Vitals does (`agent-vitals.log`, `usage-cache.json`). Use `%APPDATA%`/`os.homedir()` instead. |
| CLI | [V] `npm i -g @elgato/cli@latest` (current 1.10.2; docs say Node 24+). Commands: `create`, `link [path]`, `unlink`, `restart <uuid>`, `stop <uuid>`, `dev [--disable]`, `validate`, `pack/bundle` (validates first; `.sdignore`), `config`, `list` (https://docs.elgato.com/streamdeck/cli/intro). |
| Key sizes | [V] Manifest key images 72×72 / 144×144 @2x; encoder icon 72/144; touch-strip background 200×100 / 400×200 (manifest ref). Device-native key pixels (HID docs): Classic/MK.2 72×72, Mini 80×80, XL 96×96, Neo 96×96 (infobar 248×58), Plus 120×120 (strip 800×100), Plus XL 112×112 (36 keys, 6 dials, strip 1200×100). Mobile / Virtual Stream Deck sizes are not documented. [V] Guideline: for programmatic updates supply one size, the 144 px one, and let Stream Deck scale. |
| setImage | [V] SVG (recommended), PNG, JPEG, WEBP as file path, base64 data URL or SVG string (`data:image/svg+xml,` + `encodeURIComponent`). **No animated GIF** via setImage. A user-set custom image wins over setImage. `target` hardware/software/both, `state` 0/1 (https://docs.elgato.com/streamdeck/sdk/guides/keys). |
| Update rate | [V] "Keep programmatic updates to a maximum of 10 per second" (https://docs.elgato.com/guidelines/streamdeck/plugins/images-and-layouts). [L] Agent Vitals animates with a 600 ms tick (3-phase pulse ≈1.7 fps) plus a 30 s full refresh, and sends raw WebSocket `setImage` events with 144×144 SVG. Practical plan: ≤2–4 fps for pulses, diff-skip identical SVGs per context, coalesce bursts. |
| Dials / touch strip | [V] Per-dial canvas 200×100 on + and + XL ("Plugins cannot render across the entire touch strip"); Neo infobar canvas 232×50 (`Controllers: "Neo"`, SD 7.6+). Built-in layouts `$X1, $A0, $A1, $B1, $B2, $C1`; custom JSON layouts with `bar`, `gbar`, `pixmap`, `text` items (`key`, `rect`, `zOrder` 0–700…); `setFeedback` by item key; touch targets ≥35×35 (layouts ref + guidelines). |
| Devices / events | [V] SD 7.0 added `onDeviceDidChange`, the Virtual Stream Deck device type (11), passive deep links, and `SupportedInKeyLogicActions`. 7.1 added embedded resources + Node 24. 6.9 added `SupportURL` and Studio (changelog https://docs.elgato.com/streamdeck/sdk/references/changelog). |
| Debugging | [V] Manifest `Nodejs.Debug: "enabled"` (`--inspect`, random port), `"break"`, or a fixed `"--inspect=127.0.0.1:12345"`. `streamdeck dev` enables developer mode. The Property Inspector is debuggable at **http://localhost:23654/**, or via registry DWORD `html_remote_debugging_enabled`. Plugin logs: `<plugin>.sdPlugin/logs/<uuid>.N.log` via `streamDeck.logger`. [L] App logs: `%APPDATA%\Elgato\StreamDeck\logs\StreamDeck.N.log`; `html_remote_debugging_enabled` is not currently set in `HKCU\Software\Elgato Systems GmbH\StreamDeck`. |

---

## 6. Debugging and visual verification

- **verygoodplugins/streamdeck-mcp** [V] (https://github.com/verygoodplugins/streamdeck-mcp):
  - Edits profile manifests on disk (ProfilesV3).
  - Tools: `streamdeck_read_profiles/read_page/write_page/find_actions/read_plugins/create_icon/create_action/restart_app/install_mcp_plugin`. A legacy USB mode adds `set_button`/`get_button`…
  - **No screenshot or readback of the rendered key images.** `read_page` returns configuration only.
  - The app must be quit before writes; auto-restart is macOS-only.
- **Elgato's built-in MCP** [V+L]:
  - Stream Deck 7.4+ creates an "MCP Deck" (32 keys) whose actions AI clients can *trigger* (Corsair press release, 2026-05-26).
  - [L] Locally `MCP_enabled = true`, and the log shows `MCP local server listening on: \\.\pipe\elgato-mcp-streamdeck`.
  - Nothing indicates it can read key images. [I] It can't verify rendering, but it could drive end-to-end tests by triggering actions.
- **Recommended verification stack** [I]:
  1. **Pure render function** `(viewModel, deviceProfile) → SVG string`. Unit-test with snapshot SVG text, and rasterize with **`@resvg/resvg-js` 2.6.2** (or `sharp` 0.35.5) to PNG at 72/96/120/144 px. Compare against golden PNGs with `pixelmatch`. This catches clipping and text overflow per device size.
  2. **Debug mirror in the plugin:**
     - keep the last image per context plus device/row/col from `willAppear`;
     - serve a loopback-only page `http://127.0.0.1:<port>/debug/deck` showing the live grid, a JSON list and PNGs, guarded by the same secret;
     - write files under `%APPDATA%\…\debug\`, not the plugin dir (DRM).
     This lets an agent (or Claude via curl/browser) see exactly what each key shows.
  3. **Virtual Stream Deck** (SD 7.0+ device type 11; [L] registry shows a `vsd2_current_port`): place actions on a VSD and screenshot its window (PrintWindow/UIA) for true end-to-end checks without hardware.
  4. **Property Inspector** via `http://localhost:23654/` after `streamdeck dev`. Node plugin via `Nodejs.Debug` + VS Code/Chrome attach.
  5. **Hook replay harness:** POST recorded hook JSON (PermissionRequest, Notification, Stop, StopFailure…) to the plugin. Agent Vitals has a `selftest` that does this [L].

---

## Key design implications (summary)

1. Status signal = hooks (event-driven, includes error via `StopFailure`) + `sessions/*.json` polling (state recovery, Desktop sessions, waitingFor). `claude agents --json` is the documented equivalent of that file data.
2. Approvals = `PermissionRequest` HTTP hook with hold-and-fall-through. "Always" = echo exactly one sanitized `permission_suggestions` entry in `updatedPermissions`. In Desktop/VS Code the hook races the GUI (first decision wins).
3. Usage = statusline `rate_limits` (official, CLI only, subscribers only; needs a tee-statusline because plugins can't ship one) + optional OAuth `/api/oauth/usage` fallback (undocumented, 429/401-prone; this machine shows both).
4. Cost = statusline `cost.total_cost_usd` per session + transcript aggregation with `message.id` dedupe.
5. Jump: WT via UIA tab select (verified selectable), best with deck-launched titled tabs. VS Code via `vscode://anthropic.claude-code/open?session=`. Desktop via the gated `claude://code/continue` (verify). Mac via Remote Control URL or a Mac bridge running AppleScript/tmux.
6. Transport: WSL mirrored + Windows → direct HTTP to 127.0.0.1 (port outside 44620–48715). Mac → bridge daemon with an outbound authenticated WebSocket over Tailscale.
7. Build for manifest SDKVersion 3 / `@elgato/streamdeck` v3 / SD ≥7.1 with DRM-safe file writes if Marketplace publishing is a goal.
