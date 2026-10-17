# 0002 – Hooks über `settings.json` statt Claude-Code-Plugin

- Status: akzeptiert (2026-10-10)

## Kontext
Ein Claude-Code-Plugin könnte Hooks mit einem Befehl installieren. Claude Desktop lädt Plugins in WSL-Sessions jedoch nicht, und Plugins können keine Statusline setzen.

## Entscheidung
`vibetribe setup` trägt Hooks und Statusline-Weiche je Host in `~/.claude/settings.json` ein: mit Backup, atomar, idempotent, fremde Einträge bleiben erhalten, `--uninstall` entfernt nur eigene.

## Alternativen
- Claude-Code-Plugin: deckt Desktop-WSL-Sessions nicht ab.
- Manuelle Anleitung: fehleranfällig.

## Konsequenzen
Setup muss pro Host laufen (Windows, WSL, Mac) und mit fremden Hook-Einträgen umgehen; das ist testpflichtig.
