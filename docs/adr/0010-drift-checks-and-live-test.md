# 0010: Drift checks and a live test on Haiku

- Status: accepted (2026-10-17)

## Context
- VibeTribe depends on undocumented interfaces (ADR 0003, 0006, 0007, 0008, 0009). Two broke silently within two days: WSL's moving port block (2026-10-16) and Claude Desktop's new data folder (2026-10-17). Both were noticed only on the deck.
- Until now the rule had no exception: VibeTribe never starts a model call (token refresh only through `claude -p /cost`, spec §7.1).

## Decision
- `pnpm drift` checks every assumption about these interfaces read-only and without a model call, using the production parsers and mappers; exit 1 on drift; never titles, ids, content or tokens in the output.
- The hub checks the part without tokens and without WSL at start and hourly, and logs only changes.
- `pnpm e2e:live --spend-tokens` is the only exception to "no model call" (user, 2026-10-17: Haiku approved for tests): only with this flag, Haiku, a tiny prompt, at most $0.05 per host, only on explicit request, never in tests, CI, the hub or the plugin. Token refresh stays with `/cost`.

## Alternatives
- **Only checks without a model call:** whether hooks arrive in a real run and the deck shows Done can be seen only in a real turn. Rejected.
- **Live test in `pnpm check` or CI:** costs on every run and needs the real profile. Rejected.
- **Own copy of the formats in `pnpm drift`:** would drift apart; `pnpm drift` calls the production parsers. Rejected.
- **All checks hourly in the hub:** the API checks would need extra requests with the token, the port check would need WSL; the hub shows API errors as source errors anyway. Rejected.

## Consequences
- After updates of Claude Desktop, Claude Code, Windows or WSL, run `pnpm drift` once; a `changed` names what moved.
- A new value in the remote list counts as drift until it is in `KNOWN_REMOTE_VALUES`.
- A run of `pnpm e2e:live` costs tokens and shows a session `vibetribe-e2e-…` as Done on the deck for a few seconds.
- What can be checked only with side effects (jump, `claude://` handler, Property Inspector, tiles on the device) stays a manual check.
