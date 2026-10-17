Zeigt, ob eine Datenquelle (WIN, WSL, REM für Remote-Sessions, LIM) kaputt ist. `VibeTribe.status(model)`.

**Der Renderer liefert:** `rows` (je `source`, `health`), optional `alert` (≤ 11 Zeichen), optional `expanded` (luftig: alle Quellen zeigen).

**Bedienung:** Tippen setzt `expanded` für 5 s, danach zurück. Halten öffnet Einrichtung/Diagnose. Luftig zeigt sonst nur gestörte Quellen bzw. einen großen Haken mit `Sources ok`.

| health | Symbol | Kürzel | Wort |
|---|---|---|---|
| ok | Haken `health-ok` | `ink-muted` | „ok“ `ink-muted` |
| stale | Uhr `health-stale` | `ink` | „stale“ `ink` |
| missing | × `health-missing` | `ink` | „down“ fett `ink` |
| off | Strich `health-off` | `ink-faint` | „off“ `ink-faint` |

- Zeilen ohne Alert: Grundlinien 33 / 60 / 87 / 114; mit Alert: 30 / 54 / 78 / 102, Alert mittig auf 127 in `state-error` fett, dazu dicker Rahmen `state-error`. Der Alert-Rahmen atmet nie.
- `off` ist kein Fehler: es dämpft nur. `missing` ist sichtbar, aber ohne Rahmen; nur ein Alert bekommt einen Rahmen.
- Alles ok: die Kachel tritt zurück (gedämpfte Kürzel, kleine Haken).
- Ids: `vt-status-<SRC>` (`data-health`), `vt-status-glyph-<SRC>`, `vt-status-label-<SRC>`, `vt-status-word-<SRC>`, `vt-alert`.
