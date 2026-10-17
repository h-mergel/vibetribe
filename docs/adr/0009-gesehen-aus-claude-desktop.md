# 0009 – „Gesehen“ aus den Session-Dateien von Claude Desktop

- Status: akzeptiert (2026-10-16); ergänzt 0008

## Kontext
- Der Nutzer öffnet Sessions oft direkt in Claude Desktop statt über das Deck. Dann blieb ihr Done (bzw. ein ungesehener Alarm) laut, bis er über das Deck sprang, quittierte oder in der Session tippte.
- Claude Desktop bietet keine Schnittstelle dafür. Seine Datei je Code-Session (`claude-code-sessions\<ws>\<acct>\local_<uuid>.json`, im Ordner aus ADR 0008) trägt `lastFocusedAt`: Desktop setzt es, wenn der Nutzer die Session öffnet oder zu ihr wechselt (Klicktest 2026-10-16), nicht, solange sie offen bleibt.

## Entscheidung
- Wie ADR 0008: nur lesen, nie schreiben, fail-soft, keine Titel oder Ids im Log, im selben 5-s-Takt (eine Schleife für Desktops Zustand).
- Gelesen werden nur die Dateien lokaler Sessions mit Desktop-Id, die gerade Aufmerksamkeit brauchen; ihre Pfade kommen aus einem Verzeichnis-Scan, der nur bei einer unbekannten Id neu läuft.
- Ist `lastFocusedAt` später als der Beginn der ungesehenen Episode (und nicht nach jetzt), gilt sie als gesehen, über denselben Weg wie ein Sprung vom Deck; das gilt für jede Art ungesehener Episode.
- Den Fokus, den die eigenen Inbox-Sprünge des Decks auslösen (Desktop setzt ihn etwa 2 s nach dem Öffnen per Link), lässt das Plugin bis 5 s nach dem Sprung weg: Beim Durchblättern zählt weiter nur die Landung.

## Alternativen
- **Nur Done:** Eine Freigabe, die der Nutzer in Desktop vor sich hat, würde am Deck weiter atmen und erinnern. Verworfen; ein Sprung vom Deck sieht ebenfalls jede Episode.
- **„Gerade im Vordergrund“ erraten** (Fenster von Desktop vorne, Session zuletzt fokussiert): keine Datei sagt das; ein Fehlgriff verschluckte ein Done. Verworfen (Nutzer: lieber ein Done zu viel).
- **Alle 61 Dateien je Takt lesen:** 7,9 MB alle 5 s für meist null bis drei Kandidaten. Verworfen.
- **Transkripte oder IndexedDB von Desktop:** größer, binär bzw. laufend fortgeschrieben. Verworfen.

## Konsequenzen
- Eine Session, die schon offen war, als ihr Durchgang endete, bleibt laut, bis der Nutzer springt oder sie neu anklickt (bewusst).
- Ändert Desktop Ort, Namen oder Form der Dateien oder das Feld, wirkt Plan 12 still nicht mehr; Sprünge, Tippen und Quittieren bleiben die übrigen Wege zu „gesehen“.
- Die eigenen Inbox-Sprünge des Decks zählen nicht als Fokus: Beim Durchblättern bleiben die übersprungenen Sessions ungesehen. Klickt der Nutzer eine davon innerhalb von 5 s nach ihrem Sprung selbst in Desktop an, zählt auch das nicht; ein späterer Klick zählt.
- Tests lesen nie das echte Profil (`DesktopFocus` mit Fake-`DirPort`, `windowsHubConfig` mit temporären Pfaden).
