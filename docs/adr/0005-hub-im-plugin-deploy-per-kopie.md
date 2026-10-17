# 0005 – Zentrale im Plugin, Deploy per Kopie, SVG-Data-URL

- Status: akzeptiert (2026-10-13), teilweise ersetzt durch 0007 (fester Port 43710)

## Kontext
Das Repo liegt in WSL, das Stream-Deck-Plugin läuft unter Windows. Ein NTFS-Junction kann nicht auf `\\wsl.localhost` zeigen, die Windows-CLI `streamdeck` ist nicht installiert. `streamdeck://plugins/restart/<uuid>` lädt das Plugin ohne Entwicklermodus nicht neu (Probe Q3, Plan 3c Task 9). Die Stream-Deck-App rastert SVG-Data-URLs selbst; Spiegel und Hardware zeigen dieselben Bilder (Probe I).

## Entscheidung
- Die Zentrale (Hub) läuft im Plugin-Prozess (Port 43710), wie in ADR 0001; das Plugin ist die einzige Composition Root. `hub.mjs` bleibt für den Standalone-Betrieb und beendet sich mit Exit 2, wenn der Port belegt ist.
- Build in WSL (`pnpm plugin:build`), Deploy per Kopie (`pnpm plugin:deploy`: `manifest.json`, `bin/`, `imgs/` nach `%APPDATA%\Elgato\StreamDeck\Plugins\dev.h2k.vibetribe.sdPlugin`, gestaffelt mit Austausch). Danach muss die Stream-Deck-App vollständig beendet und neu gestartet werden.
- Tasten-Bilder sind SVG-Data-URLs; kein resvg im Plugin, PNG nur für die Manifest-Icons (Build-Zeit).
- Eine Klasse `VibeTribeAction(role, deck)` mit `manifestId` statt `@action`-Decorator und sechs Unterklassen.

## Alternativen
- Junction/Symlink auf das WSL-Verzeichnis: unter Windows nicht auflösbar.
- Windows-CLI `streamdeck link`: nicht installiert, zusätzliche Abhängigkeit.
- PNG im Plugin: natives `.node` im Bundle und ~2–3 ms Rasterung pro Bild ohne Gewinn.
- Zentrale als eigener Prozess: zwei Prozesse, Port- und Lebenszyklus-Abstimmung, kein Vorteil für den Nutzer.

## Konsequenzen
- Nach jedem Build `pnpm plugin:deploy` und vollständiger Neustart der App; Deploy auf die Maschine des Nutzers nur mit dessen Zustimmung.
- Umgebungsvariablen (`VIBETRIBE_MAX_FRAMES`) erreichen das Plugin nur nach vollständigem App-Neustart.
- Marketplace-Packaging später über `streamdeck pack` auf dem kopierten Verzeichnis.
