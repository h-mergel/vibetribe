# 0008: Pinned sessions from Claude Desktop's internal state

- Status: accepted (2026-10-16), extended by 0009 ("seen" from the session files)

## Context
- The user pins the sessions that matter to them in Claude Desktop's sidebar. On the deck these should keep their slots. Their rules of 2026-10-16: running beats pinned; on a tie the pinned one wins; alarms evict sessions without a pin first.
- Claude Desktop offers no interface for this. The pins are in `claude_desktop_config.json` (`preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder`, entries `code:local_<uuid>` in sidebar order), for the MSIX package under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`. VibeTribe already knows the Desktop id from each session file (`hostSessionId`, jump link).
- Pinned remote sessions (`session_…`) exist only in the IndexedDB store of the claude.ai page (LevelDB). The account's remote list has no pin field.

## Decision
- The hub reads the file every 5 s, read-only, and takes only the entries `code:local_…` (`HubState.pins`). If the file is missing or has another form, there are no pins; if it is unreadable right now (locked, half written), the last read pins stay. No log with titles or ids.
- The slot assignment in `core` (`SlotTable.promote`) gets the list as a parameter; without pins it behaves exactly as before.
- A checkbox "Prefer pinned sessions" in the slot action's Property Inspector (global setting, default on) takes the pins out of the assignment.
- Remote pins stay out.

## Alternatives
- **Own pin in VibeTribe** (a setting per slot key or a gesture on the key): documented and stable, but a second pin list next to Desktop's that the user would have to maintain twice; short and long press are taken. Rejected.
- **No pins:** alarms also evict the important sessions, and an important idle session without a slot never comes back, because calm sessions never swap. Rejected.
- **Read IndexedDB** (for remote pins): LevelDB log and compressed tables, continuously written by Desktop, format changeable at any time. Too brittle for two remote pins. Deferred.

## Consequences
- If Claude Desktop changes the file's location or form, the pins silently disappear and the deck works as without pins. The "Pin" column on the debug page shows whether pins arrive.
- The package name `Claude_pzs8sxrjxfjjc` is fixed in the code (`compose.ts`); a classic installation is found under `%APPDATA%\Claude`.
- The plugin gets its first Property Inspector (`ui/slot.html`) and global settings.
- Tests never read the real profile (`desktopConfigPaths(env, home)` with temporary paths).
