# 0003 – Usage-Endpunkt als Hauptquelle für Limits

- Status: akzeptiert (2026-10-10)

## Kontext
Offiziell liefert nur das Statusline-JSON `rate_limits`; die Statusline läuft aber nur in Terminal-Sessions. Auf dem Zielrechner laufen fast alle Sessions in Claude Desktop. Extra-Usage-Credits gibt es nur über den undokumentierten Endpunkt `/api/oauth/usage`.

## Entscheidung
Der Endpunkt ist die Hauptquelle (≤ 1 Abfrage / 5 min, Backoff, Token nur lesen, Cache über Neustarts). Statusline-Daten ergänzen ihn; je Fenster gewinnt der jüngste Wert.

## Alternativen
Nur Statusline: Limits fehlen bei reiner Desktop-Nutzung.

## Konsequenzen
Abhängigkeit von einer undokumentierten Schnittstelle. Ausfälle werden als „Stand HH:MM“ bzw. „Anmelden“ angezeigt, nie als Fehler. Der Client ist ein austauschbarer Adapter.
