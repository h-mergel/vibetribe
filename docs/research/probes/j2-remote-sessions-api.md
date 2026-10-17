# Probe J2 – Remote-Control-Sessions ohne Mac-Agent (2026-10-13)

**Frage:** Kann die Zentrale Sessions sehen, die auf einem anderen Rechner (MacBook) laufen und per Remote Control in Claude Desktop erscheinen – ohne Agent auf dem Mac?

**Ergebnis: ja, über die Schnittstelle, die auch claude.ai/Desktop nutzt.**

## Was nicht trägt

- `~/.claude/sessions` und Hooks: nur lokale Sessions (Windows/WSL).
- Desktop-App-Daten `%APPDATA%\Claude\claude-code-sessions\…\local_*.json`: nur lokale Desktop-Sessions (Felder u. a. `sessionId`, `cliSessionId`, `cwd`, `title`, `lastActivityAt`, `permissionMode`, `remoteControlAutoEligible`); keine Remote-Sessions.
- `bridge-state.json`: nur die Remote-Control-Brücke dieses Rechners (`environmentId`, `localSessionId`, `remoteSessionId`).
- Local Storage / IndexedDB: praktisch keine Bridge-IDs (3 Treffer) – keine zwischengespeicherte Liste.

## Was trägt

`GET https://api.anthropic.com/v1/code/sessions?limit=50` mit dem OAuth-Token aus `~/.claude/.credentials.json` (Header `Authorization: Bearer …`, `anthropic-beta: oauth-2025-04-20`, `anthropic-version: 2023-06-01`) → **200 in ≈ 330 ms**. Pfad gefunden in `%APPDATA%\Claude\logs\claude.ai-web.log` (Endpoint-Liste, Tokens/IDs redigiert). `/v1/sessions`, `/v1/environments`, `/v1/code/environments` → 404.

Antwort: `{ data: Session[], next_cursor, resume_token? }`. Relevante Felder je Session (beobachtete Werte):

| Feld | Werte | Nutzen |
|---|---|---|
| `id` | `session_01…` | = `bridgeSessionId` der lokalen Session-Datei; Sprung `claude://claude.ai/code/<id>` (Probe F) |
| `environment_kind` | `bridge` | Remote Control |
| `connection_status` | `connected`, `disconnected` | lebt die Session auf ihrem Rechner |
| `status` | `active`, `archived` | archivierte ignorieren |
| `status_bucket` | `blocked`, `completed` | wartet auf Nutzer / fertig |
| `worker_status` | `idle` (andere Werte noch nicht beobachtet) | arbeitet gerade? |
| `external_metadata.post_turn_summary.status_category` | `need_input`, `completed` | Grund des Wartens |
| `unread` | bool | ungesehen |
| `last_event_at`, `updated_at`, `created_at` | ISO | Episoden-Zeit |
| `title` | Text | Kachel-Titel (Seitenleisten-Titel) |
| `external_metadata.rate_limit_info` | `rateLimitType`, `resetsAt`, `status` | zweite Quelle für Limits |

Bei der Probe: 23 Sessions, davon 3 `active` + `connected` (2 × `blocked`/`need_input`, 1 × `completed`).

## Zuordnung „läuft auf dem Mac“

Die Antwort nennt den Rechner nicht (`environment_id` leer). Lokale Sessions mit Remote Control erscheinen ebenfalls. Regel: Eine API-Session ist **lokal**, wenn eine lokale Session-Datei dieselbe `bridgeSessionId` trägt; sonst läuft sie auf einem anderen Rechner (hier: Mac) → Abzeichen `MAC`.

## Grenzen

- Undokumentiert, kann sich mit Desktop-/API-Updates ändern → Parser tolerant, Quelle fällt sauber auf „aus/Fehler“ zurück.
- Kein Push: Abfrage nötig (Vorschlag 20 s, Backoff bei 429/Fehler). Wartezustände erscheinen mit dieser Verzögerung.
- Gröber als Hooks: kein Tool-Name, kein Unterschied Freigabe/Frage, keine Hintergrund-Jobs.
- Offen: Werte von `worker_status` während eine Session arbeitet, und wie schnell `status_bucket` nach einer Freigabe-Anfrage umspringt (braucht eine laufende Mac-Session).

## Datenschutz der Probe

Nur Struktur und Enum-Werte ausgegeben; keine Titel, Prompts, Pfade oder Tokens. Skripte im Scratchpad, nicht im Repo.
