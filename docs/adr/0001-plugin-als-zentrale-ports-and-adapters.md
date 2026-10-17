# 0001 – Plugin als Zentrale, Ports & Adapters

- Status: akzeptiert (2026-10-10)

## Kontext
Session-Zustände kommen aus mehreren Quellen (Hooks von Windows/WSL/Mac, Session-Dateien, Usage-Endpunkt) und gehen auf ein Stream Deck. Die Stream-Deck-App startet das Plugin ohnehin; ein zusätzlicher Windows-Dienst bräuchte Autostart und Betrieb.

## Entscheidung
Das Stream-Deck-Plugin ist die Zentrale. Intern Ports & Adapters:
- `@vibetribe/core` ist die Domäne: reine Funktionen und Klassen ohne I/O, Zeit als Parameter.
- `@vibetribe/render` bildet Domänen-Sichten auf SVG ab.
- Das Plugin enthält Adapter für HTTP-Eingang, Session-Datei-Leser, Usage-Client, Sprung-Ziele und Deck-Ausgabe hinter schmalen Interfaces, die der Nutzer (das Plugin) definiert. Eine einzige Composition Root verdrahtet sie.
- Abhängigkeiten zeigen nur nach innen: plugin → render → core.

Zielbild: Die Plugin-Adapter und die Composition Root entstehen ab Plan 3; `render` enthält zusätzlich einen PNG-Export (Subpath `@vibetribe/render/png`) für Tests und Galerie.

## Alternativen
- Eigener Hintergrunddienst + dünnes Plugin: mehr Betriebsaufwand ohne Nutzen in v1. Bleibt möglich, weil `core` keine Plugin-Abhängigkeit hat.
- Fork von Agent Vitals: gebündeltes SDK-v2-Skript, auf einen Rechner ausgelegt, kein klarer Schnitt zwischen Logik und I/O.

## Konsequenzen
- Domänenlogik ist vollständig ohne Stream Deck testbar.
- Neue Quellen oder Sprungziele sind neue Adapter, `core` bleibt unverändert.
- Fällt das Plugin aus, fehlt die Zentrale; Reporter sind darauf ausgelegt (fail-open).
