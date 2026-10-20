# Architecture Decision Records

Kurzes MADR-Format: Kontext, Entscheidung, Alternativen, Konsequenzen. Eine Datei pro Entscheidung, fortlaufend nummeriert, nie umschreiben – überholte ADRs bekommen Status „ersetzt durch NNNN“.

| # | Titel | Status |
|---|---|---|
| 0001 | Plugin als Zentrale, Ports & Adapters | akzeptiert |
| 0002 | Hooks über `settings.json` statt Claude-Code-Plugin | akzeptiert |
| 0003 | Usage-Endpunkt als Hauptquelle für Limits | akzeptiert |
| 0004 | Beobachtete Datei-Statusübergänge statt `statusUpdatedAt` | akzeptiert |
| 0005 | Zentrale im Plugin, Deploy per Kopie, SVG-Data-URL | akzeptiert, teilweise ersetzt durch 0007 |
| 0006 | Remote-Sessions über die Session-Liste des Kontos, `HostKind` `remote` | akzeptiert, teilweise ersetzt durch 0007 |
| 0007 | Ersatzports und Port-Datei der Zentrale, keine Handler-Prüfung beim Start | akzeptiert |
| 0008 | Angepinnte Sessions aus dem internen Zustand von Claude Desktop | akzeptiert, ergänzt durch 0009 |
| 0009 | „Gesehen“ aus den Session-Dateien von Claude Desktop | akzeptiert |
| 0010 | Drift-Prüfungen und ein Live-Test auf Haiku | akzeptiert |
| 0011 | Einrichtung aus dem Plugin, Node-Kopie als Hook-Laufzeit, WSL per Klick | akzeptiert |
