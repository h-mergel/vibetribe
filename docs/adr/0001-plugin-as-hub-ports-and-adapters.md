# 0001: Plugin as the hub, ports and adapters

- Status: accepted (2026-10-10)

## Context
Session states come from several sources (hooks on Windows/WSL/Mac, session files, the usage endpoint) and go to a Stream Deck. The Stream Deck app starts the plugin anyway; an extra Windows service would need autostart and upkeep.

## Decision
The Stream Deck plugin is the hub. Internally it uses ports and adapters:
- `@vibetribe/core` is the domain: pure functions and classes without I/O, time as a parameter.
- `@vibetribe/render` maps domain views to SVG.
- The plugin holds adapters for HTTP input, the session file reader, the usage client, jump targets and deck output, behind narrow interfaces defined by their user (the plugin). A single composition root wires them.
- Dependencies point inward only: plugin → render → core.

Target picture: the plugin adapters and the composition root follow later; `render` also has a PNG export (subpath `@vibetribe/render/png`) for tests and the gallery.

## Alternatives
- Own background service and a thin plugin: more upkeep without benefit in v1. Stays possible because `core` has no plugin dependency.
- Fork of Agent Vitals: a bundled SDK v2 script made for one machine, without a clear cut between logic and I/O.

## Consequences
- Domain logic can be tested completely without a Stream Deck.
- New sources or jump targets are new adapters; `core` stays unchanged.
- If the plugin is down, the hub is missing; the reporters are built for that (fail-open).
