# 0004 – Beobachtete Datei-Statusübergänge statt `statusUpdatedAt`

- Status: akzeptiert (2026-10-10)

## Kontext
Spec §4.2 nennt `statusUpdatedAt > episode.since` als Ausstiegsbedingung einer Episode (z. B. Berechtigungsfrage beantwortet). Der Vergleich mischt Zeitstempel zweier Uhren (Session-Datei des Hosts, Episodenbeginn aus dem Ereignis) und setzt voraus, dass die Datei zeitnah gelesen wird.

## Entscheidung
`core` erkennt Ausstiege aus beobachteten Statusübergängen der Session-Datei zwischen aufeinanderfolgenden Snapshots bzw. Deltas, nicht durch Vergleich von Zeitstempeln. Es werden keine Uhren verschiedener Hosts verglichen; das Verfahren funktioniert auch mit Polling.

## Alternativen
- `statusUpdatedAt` vergleichen wie in der Spec: Uhrenabweichung zwischen Hosts (Mac, WSL, Windows) kann Ausstiege verschlucken oder vortäuschen.

## Konsequenzen
- `SessionFileInfo` enthält kein `statusUpdatedAt`.
- Liest ein Poll direkt nach `prompt_submit` noch einen veralteten Status `idle`, kann `idle` bis zu einem Poll-Intervall angezeigt werden.
