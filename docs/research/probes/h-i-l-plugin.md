# Proben H, I, L und Q3 – Plugin auf dem echten Stream Deck MK.2 (2026-10-13)

Durchgeführt mit dem Plugin aus Plan 3c auf dem Rechner des Nutzers (Zustimmung im Chat). Beobachtungen des Nutzers, keine Messreihe.

## H – `setImage`-Durchsatz

- **Frage:** Ab welchem Tempo entstehen Verzögerungen oder Fehler in der Reihenfolge?
- **Methode:** Das Gerät wurde im Betrieb beobachtet; der Nutzer meldet, dass der MK.2 30 Bilder/s verarbeitet.
- **Ergebnis:** 30 fps laufen sauber. Das Budget bleibt bei 10/s (Elgato-Richtwert, eine Konstante). Anheben auf 20 würde nur bewirken, dass die Uhren wartender Sessions jenseits der zwei atmenden Tasten jede Sekunde statt langsamer ticken.
- **Folge für die Spec:** keine; 10/s bleibt (§5, §14).

## I – Darstellung auf dem Gerät

- **Frage:** resvg-PNG vs. echtes Deck (Schriften, Strichstärken, Verkleinerung auf 72 px).
- **Methode:** Das Plugin sendet SVG-Data-URLs; Spiegel (`/debug/keys`) und Hardware wurden verglichen.
- **Ergebnis:** SVG-Data-URLs funktionieren. Spiegel und Hardware stimmen Bild für Bild überein (Nutzer bestätigt).
- **Folge für die Spec:** keine; §12 (SVG, Data-URL) bestätigt.

## L – Profil-/Seitenwechsel

- **Frage:** (Brief: Loopback-Absicherung aus dem Browser; der Browser-CSRF-Test wurde in diesem Lauf nicht durchgeführt.) Auf dem Gerät geprüft wurde, ob nach einem Seitenwechsel dieselben Sessions auf denselben Tasten erscheinen.
- **Methode:** Seite wechseln und zurück, während Sessions laufen.
- **Ergebnis:** Dieselben Sessions kommen auf denselben Tasten zurück (Nutzer bestätigt).
- **Folge für die Spec:** §6.3 um die Slot-Rulings ergänzt (monotone Indizes, neue Sessions nur auf sichtbare Tasten, Neuverteilung nach 60 s unsichtbar).

## Q3 – Neustart-URL

- **Frage:** Lädt `streamdeck://plugins/restart/dev.h2k.vibetribe` das Plugin neu?
- **Ergebnis:** Nein, nicht ohne Entwicklermodus. Nach jedem Deploy muss die Stream-Deck-App vollständig beendet und neu gestartet werden.
- **Folge:** `pnpm plugin:deploy` meldet das; AGENTS.md und ADR 0005 halten es fest.
