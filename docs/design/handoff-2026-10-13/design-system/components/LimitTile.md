Zeigt den Füllstand des 5h- oder Wochenlimits als Ring mit Tempo-Marke. `VibeTribe.limit(model)`. Nie animiert.

**Der Renderer liefert:** `label`, `usedPct`, `pacePct`, `resetIn`, `level`, `ahead`, `stale`, `note`.

| Element | Geometrie | Stil | id |
|---|---|---|---|
| Spur | Bogen um (72,72), r 54, 250°, Öffnung unten (Start 235°) | `track`, `stroke-ring` | `vt-ring-track` |
| Füllung | gleicher Pfad, `stroke-dasharray = L·p 400`, L = 235,62 | `level-neutral`/`-amber`/`-red`; veraltet/Sign in `ink-faint` | `vt-ring` |
| Tempo-Marke | Radial r 45 → 62 beim Winkel `235 + 2,5·pacePct` | `ink` 3,5 über `ground`-Aussparung 9 | `vt-pace` (`data-angle`) |
| Label | Mitte, Grundlinie 58 | `meta-strong`, `ink-muted` | `vt-label` |
| Prozent | zentriert, Grundlinie 92 | `pct` 32/700 + `unit` „%“ | `vt-pct`, `vt-pct-unit` |
| Vor Plan | Pfeil 18 px rechts der Zahl | Stufenfarbe | `vt-ahead` |
| Reset / Notiz | Mitte, Grundlinie 130, in der Ringöffnung | `meta`; „Sign in“ `meta-strong`/`ink` | `vt-reset`, `vt-note` |

- Die Tempo-Marke schneidet den Ring als Form; sie bleibt ohne Farbe lesbar. Bei veralteten Daten und „Sign in“ entfällt sie.
- Keine Daten: nur Spur, Zahl `–`. Neues Fenster: 0 %, Notiz „New window“ („New window“ ist mit 125 px zu breit).
- Die Stufe steht auch in der Zahl; Farbe ist Verstärkung, nicht Träger.
