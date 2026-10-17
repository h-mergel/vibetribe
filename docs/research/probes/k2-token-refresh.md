# Probe K2 – Token-Erneuerung über das CLI (Plan 3b, Task 11)

Stand 2026-10-13, erster echter Lauf der Zentrale (`hub.mjs`, Windows Node 24.14.1).

## Ergebnis

- **Nicht ausgelöst.** Der Windows-Token war beim Lauf noch etwa 480 min gültig. Die Zentrale hat deshalb korrekt **keinen** CLI-Aufruf gemacht (Erneuerung erst bei ≤ 4 min Restlaufzeit oder 401).
- Usage-Abfrage erfolgreich: 5h 24 %, Woche 7 %, Extra Usage aus (Limit 50 EUR). `auth: ok`.
- `claude.exe` gefunden unter `%USERPROFILE%\.local\bin\claude.exe`, Version 2.1.287.

## Offen (nächster Ablauf)

- Ob `claude -p /cost --output-format json --no-session-persistence --setting-sources ""` den Token tatsächlich erneuert.
- Ob dabei eine Phantom-Session entsteht (Hooks sollten wegen `--setting-sources ""` nicht feuern; eine Session-Datei könnte trotzdem kurz auftauchen).
- Beobachtung: Hub-Log `%APPDATA%\vibetribe\logs\hub.log` und `/debug` während der Erneuerung. Notieren werden nur `expiresAt`-Werte, nie Tokens.

## Sonst beobachtet

- Echte Sessions: 4 Windows-Desktop-Sessions, 1 WSL-Desktop-Session, alle mit Seitenleisten-Titel und Abzeichen `APP`; Zustände `working`/`idle` stimmen.
- Quellen `sessions:win`, `sessions:wsl:Ubuntu`, `hooks:win`, `hooks:wsl:Ubuntu`, `usage`, `ingress`: alle `ok`.
- Simulator aus WSL (`pnpm hub:simulate …three-sessions-one-waiting.jsonl`) fand den Windows-Token selbst; Sessions `atlas`/`northwind`/`n8nfmt` auf Host `sim` mit `working`/`needs_permission`/`done_unseen`.
- Weder Hub-Token noch OAuth-Token in Log, `state.json` oder Debug-Seite.
