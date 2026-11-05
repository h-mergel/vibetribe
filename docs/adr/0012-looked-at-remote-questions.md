# 0012: Remote questions that were looked at become calm

- Status: accepted (2026-11-04); extends 0006 and 0009

## Context
- `/v1/code/sessions` reports `status_bucket = blocked` and `status_category = need_input` as soon as a turn ends with a question or an offer. `unread` is `true` on nearly every session, even weeks-old ones (probe 2026-11-04: 33 of 38). The rule "read and quiet worker = idle" therefore rarely applies, and REM tiles stay on `Input` for hours although the user read them long ago.
- The user wants (2026-11-04): whoever looked at a waiting remote session sees it as `Idle` until it has news. No timeout: a question nobody looked at stays loud for any length of time.

## Decision
- "Looked at" is what "seen" already means (`Hub.markSeen`): a slot jump that didn't fail, the inbox landing after a successful jump, acknowledging by long press. The hub then remembers the `last_event_at` of the wait and passes the session to the store as `idle`, at once by applying the last list again.
- "News" is a changed `last_event_at`, a list that no longer shows the session waiting, or a running worker. `RemoteTracker` checks both; no new field is added.
- The memory lives only in RAM, at most one value per session; what the list hasn't shown for 24 h drops out. A list outage changes nothing.
- After a restart the question is `Input` again until the user looks at it anew, as with remote Done.

## Alternatives
- **Focus from Claude Desktop (as in 0009):** on 2026-11-04 none of this machine's 3 REM sessions had a file under `claude-code-sessions` (575 files searched, also as raw text; 18 files with `bridgeSessionIds`). All connected sessions with a file run locally and already have the path from 0009. There would be nothing to match. Rejected.
- **Timeout:** a question would fall silent without anyone seeing it. Ruled out by the user.
- **`user_message_count` as a signal:** a change from `blocked` to `working` didn't change the value in the probe. Rejected.
- **`updated_at` as a signal:** moves without a state change as well (probe: a working session). Rejected.
- **Saving in `background.json`:** the file has its own rules (background jobs only, comparison, writing only with jobs); not worth it for questions one press calms again. Rejected.

## Consequences
- A remote session the user opens only directly in Claude Desktop or on claude.ai stays `Input` until they look at it through the deck or `unread` becomes `false`.
- If `last_event_at` moves without a new turn (probe J2b saw this on idle sessions), the question gets loud once too often. In 20 minutes of probing with 13 connected sessions this didn't happen; the error is on the loud side.
- A waiting session with a running worker stays loud even after being looked at (`Input`, seen, thin frame): that is mostly a real approval, and the list doesn't distinguish it from a question (§4.3). The complaint doesn't return through this: in the probe of 2026-11-04 the worker of all 7 `blocked` sessions was quiet.
