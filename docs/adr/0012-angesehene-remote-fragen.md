# 0012 – Angesehene Remote-Fragen werden ruhig

- Status: akzeptiert (2026-11-04); ergänzt 0006 und 0009

## Kontext
- `/v1/code/sessions` meldet `status_bucket = blocked` und `status_category = need_input`, sobald ein Durchgang mit einer Frage oder einem Angebot endet. `unread` ist bei fast jeder Session `true`, auch bei wochenalten (Sonde 2026-11-04: 33 von 38). Die Regel „gelesen und ruhender Worker = untätig“ greift deshalb kaum, und REM-Kacheln stehen stundenlang auf `Input`, obwohl der Nutzer sie längst gelesen hat.
- Der Nutzer will (2026-11-04): Wer eine wartende Remote-Session angesehen hat, sieht sie als `Idle`, bis sie etwas Neues hat. Kein Zeitablauf: Eine nicht angesehene Frage bleibt beliebig lange laut.

## Entscheidung
- „Angesehen“ ist, was schon „gesehen“ heißt (`Hub.markSeen`): Slot-Sprung, der nicht fehlschlug, Landung der Inbox nach gelungenem Sprung, Quittieren per langem Druck. Die Zentrale merkt sich dazu das `last_event_at` der Wartezeit und gibt die Session als `idle` in den Store, sofort durch erneutes Anwenden der letzten Liste.
- „Etwas Neues“ ist ein geändertes `last_event_at`, eine Liste, die die Session nicht mehr wartend zeigt, oder ein laufender Worker. Beides prüft `RemoteTracker`; es kommt kein neues Feld dazu.
- Das Merken liegt nur im Speicher, je Session höchstens eine Angabe; was die Liste 24 h nicht mehr zeigt, fällt weg. Ein Ausfall der Liste ändert nichts.
- Nach einem Neustart ist die Frage wieder `Input`, bis der Nutzer sie erneut ansieht, wie schon beim Remote-Done (R9).

## Alternativen
- **Fokus aus Claude Desktop (wie 0009):** Am 2026-11-04 trug keine der 3 REM-Sessions dieses Rechners eine Datei unter `claude-code-sessions` (575 Dateien durchsucht, auch als Rohtext; 18 Dateien mit `bridgeSessionIds`). Alle verbundenen Sessions mit Datei laufen lokal und haben den Weg aus 0009 schon. Es gäbe nichts abzugleichen. Verworfen.
- **Zeitablauf:** Eine Frage verstummte, ohne dass jemand sie sah. Vom Nutzer ausgeschlossen.
- **`user_message_count` als Signal:** Ein Wechsel von `blocked` nach `working` änderte den Wert in der Sonde nicht. Verworfen.
- **`updated_at` als Signal:** Bewegt sich auch ohne Wechsel des Zustands (Sonde: arbeitende Session). Verworfen.
- **Speichern in `background.json`:** Die Datei hat eigene Regeln (Inhalt nur Hintergrund-Jobs, Vergleich, Schreiben nur mit Jobs); das lohnt nicht für Fragen, die ein Druck wieder beruhigt. Verworfen.

## Konsequenzen
- Eine Remote-Session, die der Nutzer nur direkt in Claude Desktop oder auf claude.ai öffnet, bleibt `Input`, bis er sie über das Deck ansieht oder `unread` `false` wird.
- Rückt `last_event_at` ohne neuen Durchgang vor (Probe J2b sah das bei untätigen Sessions), wird die Frage einmal zu oft laut. In 20 Minuten Sonde bei 13 verbundenen Sessions kam das nicht vor; der Fehler liegt auf der lauten Seite.
- Eine wartende Session mit laufendem Worker bleibt auch nach dem Ansehen laut (`Input`, gesehen, dünner Rahmen): Das ist meist eine echte Freigabe, und die Liste unterscheidet sie nicht von einer Frage (§4.3). Die Beschwerde kommt dadurch nicht zurück: In der Sonde vom 2026-11-04 ruhte der Worker aller 7 `blocked`-Sessions.
