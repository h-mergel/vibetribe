# 0003: Usage endpoint as the main source for limits

- Status: accepted (2026-10-10)

## Context
Officially, only the statusline JSON provides `rate_limits`, but the statusline runs only in terminal sessions. On the target machine nearly all sessions run in Claude Desktop. Extra usage credits exist only through the undocumented endpoint `/api/oauth/usage`.

## Decision
The endpoint is the main source (at most 1 request per 5 min, backoff, token read-only, cache across restarts). Statusline data supplements it; per window the newest value wins.

## Alternatives
Statusline only: limits are missing with pure Desktop use.

## Consequences
Dependence on an undocumented interface. Outages show as "As of HH:MM" or "Sign in", never as an error. The client is a replaceable adapter.
