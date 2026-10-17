# Probe K – Usage-Endpunkt

## Frage

Welche Antwortform hat der Usage-Endpunkt, inklusive `extra_usage`? Wie verhält er sich mit den aufgeführten Headern, und welche Rate-Limits gelten tatsächlich?

## Methode

- `probes/usage/probe.mjs`: eine Abfrage `GET https://api.anthropic.com/api/oauth/usage` mit `Authorization: Bearer <Token>`, `anthropic-beta: oauth-2025-04-20` und `User-Agent: claude-code/<Version>`.
- Ausgegeben wurde nur die Struktur (`describeShape`), nie der Token.
- Anmeldedateien: `%USERPROFILE%\.claude\.credentials.json` (Windows) und `~/.claude/.credentials.json` (WSL).

## Ergebnis

- **Erster Lauf (10:xx Uhr):** Beide Dateien waren abgelaufen, die Antwort war **401**. Windows lief seit 2026-10-09 05:18Z ab, WSL seit 2026-10-03.
  - Der Grund: Claude Desktop verwaltet die Anmeldung selbst (`CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`, siehe B/C/M). Desktop-Sessions frischen die Dateien nicht auf.
- **Zweiter Lauf (18:xx Uhr):** **200.** Dazwischen lief einmal `claude -p` (Windows-CLI) im Repo, und **das hat die Windows-Datei aufgefrischt** (neues `expiresAt` +8 h).
- **Antwortstruktur, geschwärzt:**
  - `five_hour`, `seven_day`: `{ utilization: <Prozent>, resets_at: <ISO>, … }`
  - `limits[]`: `{ kind: "session" | "weekly_all" | <modellspezifisch>, group, percent, severity: "normal" | "warning" | …, resets_at, scope, is_active }`, dazu Limits pro Modell, z. B. Fable mit 19 %.
  - `extra_usage`: `{ is_enabled, monthly_limit, used_credits, utilization, currency: "EUR", decimal_places: 2, disabled_reason, … }`. Die Beträge sind **kleinste Währungseinheiten**, also 5000 = 50,00 €.
  - `spend`: `{ used / limit: { amount_minor, currency, exponent }, enabled, … }`
  - weitere Felder, nicht relevant: `seven_day_breakdown`, `weekly_scoped_shares`, diverse interne Schlüssel mit `null`
- **Rate-Limit-Header:** keine in der Antwort.
- **Konto des Nutzers zum Messzeitpunkt:** 5h bei 20 %, Woche bei 86 % (`warning`). **Extra Usage deaktiviert** (`is_enabled: false`).

## Folge für die Spec

- **§7.1 Feld-Mapping auf `EndpointInput`:**
  - `fiveHour` = `{ usedPct: five_hour.utilization, resetsAt: Date.parse(five_hour.resets_at) }`
  - `sevenDay` entsprechend aus `seven_day`
  - `extra` = `{ enabled: is_enabled, usedCredits: used_credits / 10^decimal_places, monthlyLimit: monthly_limit / 10^decimal_places, currency }`
- **§7.1 Token-Problem (neu, wichtig):**
  - Bei reiner Desktop-Nutzung ist die Anmeldedatei meist abgelaufen.
  - Gegenmaßnahme: Das Plugin stößt eine Erneuerung über das installierte CLI an, sobald der Token abgelaufen ist oder in weniger als 10 min abläuft, höchstens einmal pro Stunde. Es erneuert den Token nicht selbst.
  - Plan 3 muss den **günstigsten** CLI-Aufruf finden, der die Erneuerung auslöst. Kandidaten: ein Befehl ohne Modellaufruf, sonst `claude -p` mit Minimal-Prompt. Bis dahin zeigt die Kachel „Anmelden“.
- **§7.3 / §12:** Optional lässt sich `limits[].severity` statt der eigenen Schwellen verwenden. Das ist nicht nötig, die eigenen Schwellen bleiben.
