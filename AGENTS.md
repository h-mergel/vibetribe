# VibeTribe: guide for AI agents

VibeTribe is a Stream Deck MK.2 plugin that shows all of a developer's Claude Code sessions (Windows, WSL, Claude Desktop, Remote Control): who needs attention, since when, and one press opens the session. It also shows the 5-hour and weekly limits and extra usage.

- Binding spec (German): `docs/superpowers/specs/2026-10-10-vibetribe-design.md`
- Decisions: `docs/adr/`
- All commands and debugging: `docs/development.md`
- Pitfalls by area: `.claude/rules/` (Claude Code loads each file when you touch matching paths; other agents read the one for their area)

Product text, code, comments, commits, ADRs and agent guides are English.

## Hard rules

- Never print, log or commit OAuth tokens or credential contents. Probes print only structure and status fields, never titles, ids or content.
- Never read conversation content (transcripts, prompts).
- Ask the machine's owner before changing their real setup: hook setup, `pnpm plugin:deploy`, `pnpm profile:layout … --write`, starting `hub.mjs`, restarting their Stream Deck app. Reading what a task needs doesn't require asking; `pnpm drift` is always fine.
- Model calls exist only in `pnpm e2e:live --spend-tokens`, on the owner's explicit request. Never in tests, CI, the hub or the plugin.
- Tests never touch ports 43710, 37710, 31710 or 25710, the real `%APPDATA%\Elgato`, `%APPDATA%\vibetribe`, `%USERPROFILE%\.vibetribe`, Claude Desktop folders, `~/.claude`, the network or a model.
- The raw Elgato device image (`assets-local/`) never enters git.

## Environment

The repo lives in Linux or WSL, the plugin runs on Windows. Run pnpm, node and git in the Linux environment, never from Windows against a `\\wsl.localhost` path (exceptions are marked in `docs/development.md`). Machine-specific notes belong in a git-ignored `CLAUDE.local.md`.

## Commands

- `pnpm exec biome check --write .`, then `pnpm check`: must be green before every commit. `CI=true pnpm check` matches GitHub Actions.
- `CI= pnpm test …` writes new file snapshots; commit them.
- `pnpm tiles:measure`: required after any change to a tile, a word or a font size (skill `tile-check`).
- `pnpm plugin:headless`: hub and deck without a Stream Deck.
- `pnpm plugin:build`, `pnpm plugin:pack`: build and package.

## Architecture (spec §3.1, not negotiable)

- Ports and adapters. `packages/core` is the domain: no I/O, no `Date.now()` (time is a parameter), no runtime dependencies, nothing about Stream Deck, HTTP or files.
- Dependencies point inward only: `plugin → render → core`. The reporter stands alone; only `@vibetribe/reporter/setup` may be imported by the plugin (ADR 0011). The event format and the port file are the only shared contracts (`packages/protocol`).
- Anything external sits behind a narrow interface defined by its user. One composition root wires by constructor injection. No singletons, no DI framework, no inheritance for reuse.
- Validate external input at the adapter and translate it to types. Adapters don't throw into `core`; failures become health state and a log line.
- TypeScript strict, `verbatimModuleSyntax` (`import type`), no `enum`s, no parameter properties, private fields as `#field`.
- Contracts that callers must follow are doc comments at the code.

## How we work

- SOLID, KISS, YAGNI: no frameworks where the standard library is enough, no speculative extension points, no needless duplication. A new dependency needs its reason in the commit.
- TDD for every behaviour change: write the test, watch it fail, implement, watch it pass.
- One responsibility per file, at most 300 lines in `src`; for tests and scripts that is a guideline.
- No comments that repeat the code. No plan, ruling or task references in code, comments or test titles.
- Conventional Commits (`feat(core): …`, `fix(render): …`, `test: …`, `docs: …`, `ci: …`, `chore: …`).
- New features: spec first, then a plan, both reviewed by the strongest model before execution.
- Architecture decisions become an ADR in `docs/adr/` (short MADR, numbered, content never rewritten).

## Agents and skills

| Task | Use |
|---|---|
| Implement a task or change in `packages/` | agent `vibetribe-dev` |
| Review the diff of a task or branch | agent `vibetribe-reviewer` |
| Changed a tile, tile text, font size or word | skill `tile-check` |

Skills are plain files in `.claude/skills/`, not symlinks: the Windows `claude` can't resolve Linux symlinks over `\\wsl.localhost`.

## Code review rules

A review checks in this order and backs every finding with `file:line`:

1. **Spec:** does the diff meet the requirement, nothing missing, nothing extra?
2. **Architecture:** rules above kept (core without I/O, dependencies inward, one responsibility, nothing speculative)?
3. **Tests:** real behaviour? Would the test fail without the line under test? Edge cases covered (clock jumps, duplicates, order, empty or invalid input, boundaries)?
4. **Tiles:** `pnpm tiles:measure` green, minimum font 18 px, no filters or web fonts or external resources, all text escaped.
5. **Fail-open:** nothing can block or slow Claude Code (reporter always exits 0, no stdout in hooks, short timeouts).
6. **Contracts:** documented at the code where callers must follow an order or invariant.

Severity: Critical (wrong result, crash, data loss, security), Important (missed requirement, fragile behaviour, a test that proves nothing, maintainability damage), Minor (polish, broader tests).
