---
paths:
  - "packages/core/**"
---

# Core domain

- A session's end doesn't stop late events: don't bypass the store's tombstones (60 s).
- `HostKind` is `windows | wsl | remote`; `mac` exists only as `OsKind` in the protocol (`hostKindOf`).
- The badge follows `hostKind` only (`badgeOf`). `entrypoint` and `hostSessionId` only choose the jump link (`jumpUrlFor`). `APP` and `?` exist only in the fixed handoff samples (`OriginBadge` in `render`).
- "Needs attention" is exactly `needsAttention`: `needs_permission`, `needs_input`, `error` or `done_unseen`, each unseen.
  - The same rule drives eviction (`SlotTable.promote`, hold time `ATTENTION_HOLD_MS`, 30 s) and the inbox `+N`. Never change them separately.
  - The inbox count itself stays `isWaiting`.
- An unseen `done_unseen` gets a thick, calm frame with a tint in the Done colour (`frameWeight`) and never breathes (`animatedIds` leaves it out).
- `SlotTable.sync` only fills free slots; `promote` evicts. The deck calls `promote` only in `update`/`tick`, never in `keyAppeared`.
- `promote(views, now, canAssign, pins)` without pins is exactly eviction by attention; `sync` knows no pins. The rules (running = anything but `idle`/`no_signal`) are in spec §6.3; never change them apart from there.
