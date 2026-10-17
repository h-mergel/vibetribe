Zeigt eine laufende Session: Zustand, Titel, Wartezeit oder Detail, Herkunft. `VibeTribe.slot(model)` bzw. `render({kind:'slot', …})`.

**Der Renderer liefert:** `title`, `state`, `badge`, optional `wait` (Sekunden), `detail`, `bgCount`/`bgStale`, `frame` (`thick`/`thin`/`normal`), `level`, `jumping`, `tick` (nur working, 0–2).

**Varianten:** Die Tabelle beschreibt „dicht“. „Luftig“ (Standard) nutzt 14 px Rand, Symbol 22, Wort 20, Titel 22 px auf Grundlinien 72/99, reguläre Texte mit 0,7-px-Kontur, Fuß 126, zeigt die Herkunft immer unten rechts, das ◑-Abzeichen unten links (oder im Kopf, wenn eine Uhr läuft) und das Detail nur als Fehlerart; siehe Variants.

**Anatomie** (144er-Raster, dicht)

| Element | Position | Stil | id |
|---|---|---|---|
| Zustandssymbol | Box 28 @ (10,10) | Zustandsfarbe; gefüllt bei `frame: thick` und `done_unseen` | `vt-glyph` |
| Zustandswort | x 42, Grundlinie 31 | `state-word` 20/700 (→18), Zustandsfarbe | `vt-state-word` |
| Hintergrund ◑n | rechts @134, Grundlinie 31 | 15-px-Halbkreis + `meta-strong`, `ink-muted` | `vt-bg-glyph`, `vt-bg-count` |
| Titel | x 10, Grundlinien 64 / 88 | `title` 20/400 (→18), `ink`; Offline `ink-muted` | `vt-title-1`, `vt-title-2` |
| Uhr | x 10, Grundlinie 127 | Zahl `clock` 20/700 `ink` + Einheit `meta` `ink-muted` (s, min, h) | `vt-clock`, `vt-clock-unit` |
| Detail | Titelzeile 2 oder Fuß links | `meta` 18/400, `ink-muted` | `vt-detail` |
| Sprung | Fuß links | `meta` 18/400, `ink`: „Open…“ | `vt-jump` |
| Herkunft | rechts @134, Grundlinie 127 | `meta-strong` 18/700, `ink-muted` | `vt-badge` |
| Rahmen / Tönung | Rand | `stroke-frame-thick`/`thin`/`dashed`, `tint` | `vt-frame`, `vt-tint` |

**Zustände**

| state | Wort | Symbol | Fuß links | Rahmen |
|---|---|---|---|---|
| needs_permission | Approve | Raute ! | Uhr | thick → thin |
| needs_input | Input | Sprechblase ? | Uhr | thick → thin |
| error | Error | Achteck × | Uhr (Detail in Titelzeile 2, falls frei) | thick → thin, nie animiert |
| done_unseen | Done | Kreis ✓, gefüllt | Uhr | thick bis gesehen, nie animiert |
| throttled | Limited | Sanduhr | Detail | keiner |
| working | Working | 3 Punkte (`tick`) | Detail | keiner |
| background | n jobs / ? jobs | Halbkreis | Detail | keiner |
| idle | Idle | Balken | – | keiner |
| no_signal | Offline | Kreis durchgestrichen | – | gestrichelt `ink-faint` |

- Tu: Uhr und Zustandswort immer zeigen; Detail nur ganz oder gar nicht.
- Tu: Uhr in der ersten Minute sekündlich, danach minütlich aktualisieren; bei atmenden Tasten nur im Atembild.
- Lass: Text, Symbol oder Uhr mit `level` dimmen. Nur `vt-frame` und `vt-tint` folgen `level`.
- Lass: Rahmen bei `throttled`, `working`, `background`, `idle`.
