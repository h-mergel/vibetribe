# Proben-Ergebnisse

Jede Probe hat eine Datei `<buchstabe>-<thema>.md` mit genau diesen Abschnitten:

- **Frage:** wörtlich aus Spec §14
- **Methode:** Skripte, Umgebung (Version Claude Code / Claude Desktop / Windows Terminal), Szenarien
- **Ergebnis:** beobachtete Fakten, mit Auszügen aus `summarize.mjs` (geschwärzt)
- **Folge für die Spec:** konkrete Änderung (Abschnitt + neuer Wortlaut) oder „keine“

## Stand (2026-10-10)

| Probe | Datei | Status |
|---|---|---|
| A | `a-hook-latency.md` | erledigt |
| B, C, M | `b-c-m-hook-events.md` | erledigt |
| D | – | zurückgestellt (Nutzer arbeitet nicht im Terminal; vor Plan 4, falls nötig) |
| E, F | `e-f-links.md` | erledigt |
| G | `g-liveness.md` | erledigt (Test mit gestoppter Distro nicht durchgeführt) |
| J | – | Plan 5 (braucht den Mac) |
| J2 | `j2-remote-sessions-api.md` | erledigt (2026-10-13; Remote-Sessions über `/v1/code/sessions`, Plan 3d) |
| J2b | `j2b-remote-sessions-rate.md` | erledigt (Plan 3d Task 1; Abfragetakt der Session-Liste) |
| K | `k-usage-endpoint.md` | erledigt |
| H, I, L, Q3 | `h-i-l-plugin.md` | erledigt (2026-10-13; Browser-CSRF-Test nicht wiederholt) |
