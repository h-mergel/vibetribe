# 0006 – Remote-Sessions über die Session-Liste des Kontos, `HostKind` `remote`

- Status: akzeptiert (2026-10-13), teilweise ersetzt durch 0007 (Handler-Prüfung beim Start)

## Kontext
Sessions auf einem anderen Rechner (MacBook) waren für einen Mac-Agenten mit Tailscale vorgesehen (Plan 5). Probe J2 zeigt: Die Session-Liste, die Claude Desktop und claude.ai nutzen (`GET /v1/code/sessions`, OAuth), enthält jede Session mit Remote Control, ohne Agent und ohne Netzfreigabe. Der Rechner einer Session ist darin nicht genannt. Der Kern kannte als dritte Herkunft `mac`; geliefert wurde dafür noch nichts.

## Entscheidung
- Neue Quelle `sessions:remote` in der Zentrale: alle 20 s die Liste (gemessen in Probe J2b: 15 Abfragen im 20-s-Takt, alle 200, kein 429) mit dem Token des Usage-Pollers (nur lesend), Backoff bis 5 min, toleranter Parser. Eine Session ist remote, solange keine lokale Session-Datei ihre `bridgeSessionId` trägt.
- Ids: Die API liefert `cse_<X>`, lokale Dateien `session_<X>` (Probe J2c). Der Client normalisiert beide Formen auf `session_<X>`; `RemoteSession.id` hat immer diese Form, damit Abgleich, Sprunglink und Anzeige einheitlich bleiben.
- Durchgänge: Ein bereits gemeldeter Durchgang gilt nur als neu, wenn sich `last_event_at` änderte und die Zentrale die Session seither nicht untätig sah oder `unread` von `false` auf `true` wechselte. Ein bloßes Weiterrücken von `last_event_at` (Probe J2b: 3 in 15 Abfragen, J2c: 0, Ursache unbekannt) löst kein neues Fertig aus.
- `HostKind` `mac` wird zu `remote` umbenannt (Abzeichen und Status-Zeile `REM`): „ein anderer Rechner“ statt „ein Mac“. Hook-Events eines Reporters auf einem Mac ordnet `hostKindOf` bereits `remote` zu. Ein künftiger Mac-Agent mit Lebenszeichen müsste seine Quelle als `sessions:remote` melden oder in der Status-Taste dorthin abgebildet werden; das leistet der Code heute nicht.
- Angezeigt werden nur Sessions mit `environment_kind = bridge` (Remote Control) und Einträge ohne das Feld; eine Konstante (`REMOTE_ENVIRONMENT_KINDS`) schaltet z. B. Cloud-Sessions zu.
- Das Protokoll v1 bleibt unverändert: `source.os` ist das Betriebssystem des Reporters (`mac` bleibt gültig), die Host-ID `mac:<hostname>` ebenso. Die Zentrale bildet `os = mac` ausdrücklich auf `remote` ab (`hostKindOf`); `OsKind` und `HostKind` sind damit entkoppelt.
- Sprünge laufen über einen Port `JumpOpener`; unter Windows `rundll32 url.dll,FileProtocolHandler` mit geprüftem `claude://`-Link. `rundll32.exe` und `reg.exe` werden über den absoluten Pfad unter `%SystemRoot%\System32` gestartet, nie über den Suchpfad. `opened` heißt nur „Windows hat den Link angenommen“: Ob Desktop nach vorne kommt (Vordergrund-Sperre) und ob der versionierte MSIX-Handler noch existiert, sieht das Plugin nicht; den Handler prüft es einmal beim Start (nebenher, ohne den Start zu verzögern, nie im Headless-Modus) und warnt im Log, auch wenn der Eintrag nicht gelesen werden kann („could not be read“).

## Alternativen
- `remote` zusätzlich zu `mac`: zwei Begriffe für dasselbe Verhalten (Lebenszeichen, `no_signal`), ohne Nutzen.
- Protokoll auf `remote` umstellen: Bruch des Drahtformats v1 für eine reine Benennung; das Betriebssystem bleibt eine richtige Angabe.
- Mac-Agent zuerst: Installation auf dem Mac, Tailscale, Firewall-Regel – viel Betrieb für dieselbe Sicht.

## Konsequenzen
- Abhängigkeit von einer weiteren undokumentierten Schnittstelle: Ausfälle werden zu `no_signal` (90 s), dann entfernt (210 s); Status-Taste REM fehlt.
- Gröber als Hooks: kein Tool-Name, keine Unterscheidung Freigabe/Frage, keine Hintergrund-Jobs, bis 20 s Verzögerung.
- Titel aus der Liste stehen im lokalen Zustand (Debug-Seite, Log der Sprünge); Tokens nie.

## Nachtrag (2026-10-14)

- „Status-Taste REM fehlt“ heißt: Die Zeile REM der Status-Taste gibt es immer, solange die Remote-Liste konfiguriert ist (Quelle `sessions:remote`). Bei einem Ausfall zeigt sie `down` (Gesundheit `missing`), ohne Konfiguration `off`. Die Entscheidung selbst bleibt unverändert.
