# 0004: Observed file status transitions instead of `statusUpdatedAt`

- Status: accepted (2026-10-10)

## Context
Spec §4.2 names `statusUpdatedAt > episode.since` as the exit condition of an episode (e.g. a permission request was answered). The comparison mixes timestamps of two clocks (the host's session file, the episode start from the event) and assumes the file is read promptly.

## Decision
`core` detects exits from observed status transitions of the session file between consecutive snapshots or deltas, not by comparing timestamps. No clocks of different hosts are compared; the approach also works with polling.

## Alternatives
- Compare `statusUpdatedAt` as in the spec: clock drift between hosts (Mac, WSL, Windows) can swallow or fake exits.

## Consequences
- `SessionFileInfo` contains no `statusUpdatedAt`.
- If a poll right after `prompt_submit` still reads a stale status `idle`, `idle` can show for up to one poll interval.
