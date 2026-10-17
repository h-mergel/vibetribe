# Proben E, F – Sprung zu Desktop- und Remote-Control-Sessions

## Frage

- **E:** Öffnet der Deep-Link in der installierten Version von Claude Desktop die richtige Session, auch für Sessions in WSL?
- **F:** Wie wird aus `bridgeSessionId` die claude.ai/code-URL, und öffnet Claude Desktop sie?

## Methode

- `Start-Process <link>` unter Windows, während in Claude Desktop eine andere Session sichtbar war.
- Ziel für E: Desktop-Test-Session auf `/tmp/vt-probe` (WSL).
- Ziel für F: die Session „Partner-Akquise Handoff fortführen“ mit aktiver Remote Control.
- Der Nutzer hat jeweils bestätigt, was Desktop anzeigte.

## Ergebnis

- **E:** Beide Varianten wechseln zur richtigen Desktop-Session (WSL-Session getestet):
  - `claude://claude.ai/epitaxy/<hostSessionId>`: Das ist das Format, das die App selbst für Session-Links verwendet (`list_sessions.link`).
  - `claude://code/continue?session=<hostSessionId>`: das Format, das Agent Vitals nutzt.
- **F:**
  - Session-Dateien von Remote-Control-Sessions tragen `bridgeSessionId` im Format `session_01…`.
  - `https://claude.ai/code/<bridgeSessionId>` öffnet die Session im Browser. Beim ersten Mal ist eine Anmeldung nötig.
  - **`claude://claude.ai/code/<bridgeSessionId>` öffnet sie direkt in Claude Desktop**, ohne Anmeldung.
- **Nicht geprüft:** Verhalten bei minimiertem Desktop-Fenster. Das wird in Plan 4 geprüft.

## Folge für die Spec

- **§9, Zeile `APP`:** primär `claude://claude.ai/epitaxy/<hostSessionId>`. Der Rückfall `claude://code/continue?session=<hostSessionId>` funktioniert ebenfalls.
- **§9, Zeile `MAC`:** `claude://claude.ai/code/<bridgeSessionId>` (öffnet in Desktop), Rückfall `https://claude.ai/code/<bridgeSessionId>`.
- **§14 E, F:** gelöst.
