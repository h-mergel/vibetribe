# Probe J2b – Abfragetakt der Session-Liste (2026-10-13)

**Frage:** Verträgt `GET /v1/code/sessions` eine Abfrage alle 20 s mit dem OAuth-Token der Anmeldedatei, oder antwortet sie wie der Usage-Endpunkt mit 429? Welche Werte nehmen `environment_kind`, `worker_status` und die übrigen Status-Felder an, und ändert sich `last_event_at` ruhender Sessions?

**Methode:** `probes/remote-sessions/rate.mjs` (WSL-Node), Lauf am 2026-10-13, 15 Abfragen im Abstand von 20 s mit Abbruch beim ersten 429, Ausgabe ohne Titel/IDs/Tokens. Token aus `C:\Users\<user>\.claude\.credentials.json`.

**Ergebnis:** 15 Abfragen, Status 200 (15x), Latenz 227–426 ms, Rate-Limit-Header keine. Kein 429. Je Abfrage 25 Sessions (17 `connected`).

```json
{
  "spacingS": 20,
  "calls": 15,
  "limited": false,
  "statuses": [
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200,
    200
  ],
  "quietChangedTotal": 3,
  "enums": {
    "environment_kind": {
      "bridge": 375
    },
    "connection_status": {
      "connected": 255,
      "disconnected": 120
    },
    "status": {
      "active": 75,
      "archived": 300
    },
    "status_bucket": {
      "review_ready": 27,
      "completed": 330,
      "blocked": 15,
      "working": 3
    },
    "worker_status": {
      "idle": 372,
      "running": 3
    },
    "status_category": {
      "review_ready": 27,
      "completed": 90,
      "need_input": 60
    }
  },
  "recommendedIntervalS": 20
}
```

Auffälligkeiten:

- `badIds` war in allen 15 Abfragen 25: keine der IDs passt zu `^session_[A-Za-z0-9]{1,64}$`. Das ID-Muster aus Task 4 und Task 7 muss geklärt werden (echte Form nicht ausgegeben).
- `quietChangedTotal` = 3: ruhende Sessions (`worker_status = idle`, nicht `blocked`) bekamen in 3 von 14 Vergleichen (Abfragen 8, 11, 13, je 1 Session) ein neues `last_event_at` ohne `running`-Zwischenzustand. Die Durchgangs-Erkennung in Task 5 ("neues `last_event_at` = neuer Durchgang") ist damit nicht ohne Weiteres tragfähig.
- `worker_status` kennt `idle` und `running`; `environment_kind` nur `bridge`.

**Folge für die Spec:** §4.3 Remote-Liste: Abfrage alle 20 s. Der Wert `running` für `worker_status` gilt als `working` (Zuordnung in §4.3 unverändert). `environment_kind` hat nur `bridge`; `REMOTE_ENVIRONMENT_KINDS` blendet nichts zusätzlich aus. Offen: ID-Muster (`badIds`) und Durchgangs-Erkennung (`quietChangedTotal` > 0), Entscheidung des Nutzers.
## Nachtrag J2c (2026-10-13)

Folgeprobe mit gleichem Takt wie J2b (15 Abfragen, 20 s Abstand, alle 200, kein 429). Nur Formen und Zahlen, keine IDs.

- **ID-Form:** Alle 25 API-IDs haben die Form `cse_` + 24 alphanumerische Zeichen (Länge 28). Lokale Session-Dateien tragen `bridgeSessionId` = `session_` + 24 alphanumerische Zeichen (Länge 32). Kein API-Feld enthält einen `session_…`-Wert. Die Zeichenmuster zweier lokaler IDs stimmen mit den Suffixen zweier API-IDs überein: Die API liefert dieselbe Session unter anderem Präfix, `cse_<X>` entspricht `session_<X>`.
- **Folge:** Der Remote-Client akzeptiert `cse_`/`session_` und normalisiert auf `session_<X>`; damit passen Abgleich mit lokalen `bridgeSessionId`s und der Sprunglink `claude://claude.ai/code/session_<X>`.
- **Ruhige `last_event_at`-Änderungen:** 0 von 15 Abfragen (J2b: 3 von 15). Die Ursache der J2b-Sprünge bleibt unbekannt (plausibel: Aktivität auf einem anderen Gerät); `unread`/`status_category` der damals betroffenen Sessions wurden nicht erfasst.
