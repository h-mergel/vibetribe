# Architecture Decision Records

Short MADR format: context, decision, alternatives, consequences. One file per decision, numbered in sequence. The content is never rewritten; superseded ADRs get the status "superseded by NNNN". Translations and link fixes don't count as rewriting.

| # | Title | Status |
|---|---|---|
| [0001](0001-plugin-as-hub-ports-and-adapters.md) | Plugin as the hub, ports and adapters | accepted |
| [0002](0002-hooks-via-settings-json.md) | Hooks via `settings.json` instead of a Claude Code plugin | accepted |
| [0003](0003-usage-endpoint-as-main-source.md) | Usage endpoint as the main source for limits | accepted |
| [0004](0004-observed-status-transitions.md) | Observed file status transitions instead of `statusUpdatedAt` | accepted |
| [0005](0005-hub-in-plugin-deploy-by-copy.md) | Hub inside the plugin, deploy by copy, SVG data URLs | accepted, partly superseded by 0007 |
| [0006](0006-remote-sessions-via-session-list.md) | Remote sessions via the account's session list, `HostKind` `remote` | accepted, partly superseded by 0007 |
| [0007](0007-port-file-and-fallback-ports.md) | Fallback ports and a port file for the hub, no handler check at start | accepted |
| [0008](0008-pins-from-claude-desktop.md) | Pinned sessions from Claude Desktop's internal state | accepted, extended by 0009 |
| [0009](0009-seen-from-claude-desktop.md) | "Seen" from Claude Desktop's session files | accepted |
| [0010](0010-drift-checks-and-live-test.md) | Drift checks and a live test on Haiku | accepted |
| [0011](0011-setup-from-the-plugin.md) | Setup from the plugin, a Node copy as hook runtime, WSL by click | accepted |
| [0012](0012-looked-at-remote-questions.md) | Remote questions that were looked at become calm until the session has news | accepted |
