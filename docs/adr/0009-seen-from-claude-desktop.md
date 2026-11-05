# 0009: "Seen" from Claude Desktop's session files

- Status: accepted (2026-10-16); extends 0008

## Context
- The user often opens sessions directly in Claude Desktop instead of through the deck. Their Done (or an unseen alarm) then stayed loud until they jumped from the deck, acknowledged it or typed in the session.
- Claude Desktop offers no interface for this. Its file per Code session (`claude-code-sessions\<ws>\<acct>\local_<uuid>.json`, in the folder from ADR 0008) carries `lastFocusedAt`: Desktop sets it when the user opens or switches to the session (click test 2026-10-16), not while it stays open.

## Decision
- As in ADR 0008: read only, never write, fail soft, no titles or ids in the log, at the same 5 s interval (one loop for Desktop's state).
- Only the files of local sessions with a Desktop id that currently need attention are read; their paths come from a folder scan that reruns only for an unknown id.
- If `lastFocusedAt` is later than the start of the unseen episode (and not after now), the episode counts as seen, by the same path as a jump from the deck; this applies to every kind of unseen episode.
- The plugin ignores the focus caused by the deck's own inbox jumps (Desktop sets it about 2 s after opening by link) until 5 s after the jump: when cycling, only the landing counts, as before.

## Alternatives
- **Done only:** an approval the user has in front of them in Desktop would keep breathing and reminding on the deck. Rejected; a jump from the deck also sees every episode.
- **Guess "in the foreground right now"** (Desktop's window in front, session last focused): no file says this, and a wrong guess would swallow a Done. Rejected (user: rather one Done too many).
- **Read all 61 files per tick:** 7.9 MB every 5 s for mostly zero to three candidates. Rejected.
- **Desktop's transcripts or IndexedDB:** larger, binary or continuously written. Rejected.

## Consequences
- A session already open when its turn ended stays loud until the user jumps or clicks it anew (deliberate).
- If Desktop changes the location, names or form of the files or the field, this silently stops working; jumps, typing and acknowledging remain the other ways to "seen".
- The deck's own inbox jumps don't count as focus: when cycling, skipped sessions stay unseen. If the user clicks one of them in Desktop within 5 s of its jump, that doesn't count either; a later click does.
- Tests never read the real profile (`DesktopFocus` with a fake `DirPort`, `windowsHubConfig` with temporary paths).
