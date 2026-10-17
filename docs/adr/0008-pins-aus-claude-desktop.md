# 0008 – Angepinnte Sessions aus dem internen Zustand von Claude Desktop

- Status: akzeptiert (2026-10-16), ergänzt durch 0009 („gesehen“ aus den Session-Dateien)

## Kontext
- Der Nutzer pinnt in der Sidebar von Claude Desktop die Sessions an, die ihm wichtig sind. Auf dem Deck sollen sie ihre Slots behalten. Seine Regeln vom 2026-10-16: laufend schlägt angepinnt; bei Gleichstand gewinnt die angepinnte; Alarme verdrängen zuerst Sessions ohne Pin.
- Claude Desktop bietet dafür keine Schnittstelle. Die Pins stehen in `claude_desktop_config.json` (`preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder`, Einträge `code:local_<uuid>` in Sidebar-Reihenfolge), beim MSIX-Paket unter `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`. Die Desktop-Id kennt VibeTribe schon aus jeder Session-Datei (`hostSessionId`, Sprunglink).
- Angepinnte Remote-Sessions (`session_…`) stehen nur im IndexedDB-Speicher der claude.ai-Seite (LevelDB). Die Remote-Liste des Kontos hat kein Pin-Feld.

## Entscheidung
- Die Zentrale liest die Datei alle 5 s, nur lesend, und übernimmt nur die Einträge `code:local_…` (`HubState.pins`). Fehlt die Datei oder hat sie eine andere Form, gibt es keine Pins; ist sie gerade unlesbar (gesperrt, halb geschrieben), bleiben die zuletzt gelesenen. Kein Log mit Titeln oder Ids.
- Die Slot-Zuordnung in `core` (`SlotTable.promote`) bekommt die Liste als Parameter; ohne Pins verhält sie sich genau wie vorher.
- Ein Kästchen „Prefer pinned sessions“ im Property Inspector der Slot-Aktion (globale Einstellung, Standard an) nimmt die Pins aus der Zuordnung.
- Remote-Pins bleiben außen vor.

## Alternativen
- **Eigener Pin in VibeTribe** (Einstellung je Slot-Taste oder eine Geste auf der Taste): dokumentiert und stabil, aber eine zweite Pin-Liste neben der in Desktop, die der Nutzer doppelt pflegen müsste; kurzer und langer Druck sind belegt. Verworfen.
- **Keine Pins:** Alarme verdrängen auch die wichtigen Sessions, und eine wichtige ruhende Session ohne Slot kommt nie zurück, weil Ruhige nie tauschen. Verworfen.
- **IndexedDB lesen** (für Remote-Pins): LevelDB-Protokoll und komprimierte Tabellen, von Desktop laufend fortgeschrieben, Format jederzeit änderbar. Zu brüchig für zwei Remote-Pins. Zurückgestellt.

## Konsequenzen
- Ändert Claude Desktop Ort oder Form der Datei, verschwinden die Pins still, und das Deck arbeitet wie ohne Pins. Die Spalte „Pin“ der Debug-Seite zeigt, ob Pins ankommen.
- Der Paketname `Claude_pzs8sxrjxfjjc` steht fest im Code (`compose.ts`); eine klassische Installation wird unter `%APPDATA%\Claude` gefunden.
- Das Plugin hat zum ersten Mal einen Property Inspector (`ui/slot.html`) und globale Einstellungen.
- Tests lesen nie das echte Profil (`desktopConfigPaths(env, home)` mit temporären Pfaden).
