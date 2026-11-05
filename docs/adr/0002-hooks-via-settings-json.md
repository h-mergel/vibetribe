# 0002: Hooks via `settings.json` instead of a Claude Code plugin

- Status: accepted (2026-10-10)

## Context
A Claude Code plugin could install hooks with one command. But Claude Desktop doesn't load plugins in WSL sessions, and plugins can't set a statusline.

## Decision
`vibetribe setup` adds hooks and a statusline passthrough per host to `~/.claude/settings.json`: with a backup, atomically, idempotently, keeping other entries; `--uninstall` removes only its own.

## Alternatives
- Claude Code plugin: doesn't cover Desktop WSL sessions.
- Manual instructions: error-prone.

## Consequences
Setup has to run per host (Windows, WSL, Mac) and handle other tools' hook entries; this must be tested.
