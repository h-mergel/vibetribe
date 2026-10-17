Zeigt die verbrauchte Extra Usage und den Anteil am Monatslimit. `VibeTribe.extra(model)`. Nie animiert.

**Der Renderer liefert:** `used`, `limit`, `ratio`, `level`, `stale`, `note`.

| Element | Position | Stil | id |
|---|---|---|---|
| Label „Extra“ | x 10, Grundlinie 28 | `meta-strong`, `ink-muted` | `vt-label` |
| Anteil | rechts @134, Grundlinie 28 | `meta-strong`, `ink` | `vt-pct` |
| Betrag | x 10, Grundlinie 76 | `amount` 34→30→28→24→20→18, bis Zahl + € ≤ 122 px | `vt-amount` |
| € | hinter dem Betrag | `unit` 20/700, `ink-muted` | `vt-amount-unit` |
| of limit / Notiz | x 10, Grundlinie 102 | `meta`; Kurzformen siehe README | `vt-limit`, `vt-note` |
| Balken | y 114, Höhe 12, Breite 124 · ratio (min. 12) | `track` / Stufenfarbe, `radius-bar` | `vt-bar-track`, `vt-bar` |

- Ohne Limit: kein Balken, Zeile „No limit“.
- Deaktiviert (`note: 'Disabled'`): Betrag „off“ und alles in `ink-faint`, leere Spur bleibt als Form.
- „Sign in“ steht fett in `ink`: es ist eine Handlung.
