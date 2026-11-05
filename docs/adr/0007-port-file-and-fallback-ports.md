# 0007: Fallback ports and a port file for the hub, no handler check at start

- Status: accepted (2026-10-16)

## Context
- With mirrored networking, WSL reserves a block of 4096 ports on each start, on the Windows side too (`/proc/sys/net/ipv4/ip_local_port_range`). The block is invisible (no process in `netstat`) and moves between WSL starts (measured 44620–48715, on 2026-10-16 40525–44620). If 43710 lies inside, the hub in the plugin doesn't bind (`EADDRINUSE`): no hooks, no debug page, status key "Port in use". ADR 0005 assumed the fixed port 43710.
- After a Stream Deck restart the old instance sometimes still holds the port; the hub never tried binding again.
- Claude Desktop is an MSIX package. The handler check at start (ADR 0006) read `HKCR\claude\shell\open\command`. `reg.exe` found that key only when Stream Deck started from WSL, never when the user started it; jumps worked anyway, because `rundll32` resolves `claude://` through the package registration.

## Decision
- The hub first tries 43710, then the fallback ports 37710, 31710, 25710 (`FALLBACK_PORTS`): below Windows' dynamic range (49152–65535) and 6000 apart each, so a WSL block hits at most one. If none binds, it retries every 5 s.
- It writes the bound port atomically to `%USERPROFILE%\.vibetribe\port`, next to the token. The reporters read it there (in WSL through `/mnt/c`), otherwise 43710 applies; an explicit `hubUrl` wins. Next to the event envelope, the port file is the second contract between reporter and hub and, like it, lives in `packages/protocol` (`DEFAULT_PORT`, `PORT_FILE`, `parsePortNumber`).
- The handler check at start is dropped.

## Alternatives
- Detect the MSIX package (`Get-AppxPackage` or AppX keys) and warn only for packages without a registration: a second probe for a registration Windows maintains with the package. Rejected.
- Check the port ranges in `setup` and store a free port: the WSL block keeps moving after setup, and a fixed port lands in it again on the next WSL start. Rejected.

## Consequences
- `hub.mjs` tries only the first port and exits with 2 if it is taken. The plugin and `hub.mjs` never run at the same time: if the plugin is on a fallback port and 43710 is free, `hub.mjs` starts and overwrites the port file.
- A reporter change takes effect only once its copy `~/.vibetribe/reporter.mjs` is replaced per host; setup and `settings.json` stay unchanged.
- Tests load a guard (`test/real-ports-guard.mjs`) that refuses connections to and binds on these four ports, also in Node processes they start.
