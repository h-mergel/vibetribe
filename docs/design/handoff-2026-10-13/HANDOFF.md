# VibeTribe – Handoff: Design System für die Stream-Deck-Kacheln

Stand: 2026-10-14. Ergebnis einer Design-Session (Claude, Cowork) auf Basis von `docs/…/design-brief` (Spec §5, §6, §12). Zielgruppe: die Claude-Code-Session, die Plan 6 (Renderer-Übernahme in `packages/render`) umsetzt.

**Quelle der Wahrheit:** das Design-System-Artifact „VibeTribe“ in claude.ai (Owner: Heinrich). Dieses Paket ist ein Abzug davon; bei Abweichungen gilt das Artifact.

## 1. Was in diesem Paket liegt

| Pfad | Inhalt |
|---|---|
| `design-system/README.md` | Gestaltungsregeln komplett: Haltung, Belegung, Varianten, Raster, Farbe, Typo, Symbole, Eskalation, Bildbudget, Textregeln, Barrierefreiheit, Antworten auf die 13 offenen Fragen |
| `design-system/tokens.json` | Alle Tokens (Farben, Schriftstile, Abstände/Grundlinien, Radien, Strichstärken, Deckkräfte) |
| `design-system/components/bundle.js` | **Referenz-Renderer** (reines JS, keine Abhängigkeiten): `VibeTribe.render(model, { variant })` → SVG-String 144 × 144. Enthält DejaVu-Sans-Breitentabelle, Kürzung, Umbruch, Eskalation |
| `design-system/components/index.d.ts` | Typen aller Modelle und der API |
| `design-system/components/*.md` | Richtlinien je Kachel (Anatomie, Koordinaten, ids, Do/Don't) |
| `design-system/components/Deck-prototype.html` | Interaktiver Prototyp (im Browser öffnen, liegt neben `bundle.js`/`bundle.css`) |
| `reference/luftig/*.svg`, `reference/dicht/*.svg` | 52 Referenz-SVGs je Variante, Dateinamen wie im Brief (`slot-needs_permission.svg`, …) |
| `reference/png/` | Vorschauen bei 72 px (und luftig auch 144 px) |
| `tools/tiles.src.js`, `adv.json`, `build.mjs`, `review.mjs` | Quelle des Bundles (`__ADV__` wird durch `adv.json` ersetzt), Build mit resvg-Messung, Fuzz-Test |

## 2. Entscheidungen (Kurzfassung)

- **Variante „luftig“ ist Standard (empfohlen)**, „dicht“ bleibt als Einstellung (`variant: 'dicht'`). Unterschiede: README › Varianten.
- **Luftig mit größerer, kräftigerer Schrift:** Zustandswort 20 px, Titel 22 px (→20 → 18), reguläre Texte mit 0,7-px-Kontur in eigener Farbe (`stroke-text`) – liest sich am LCD wie Halbfett.
- **Done so sichtbar wie Approve/Input:** `done_unseen` bekommt in beiden Varianten dicken Rahmen + Tönung (wie Phase B), atmet aber nie. Nach dem Ansehen → `idle`.
- **Belegung Seite 1 (8 Slots):**
  ```
  Apps    | 5h     | Week   | Inbox(Next) | Status
  Extra   | Slot 1 | Slot 2 | Slot 3      | Slot 4
  Page 2  | Slot 5 | Slot 6 | Slot 7      | Slot 8
  ```
  Musik/Medien/Mikro auf Seite 2. Sessions behalten ihren Slot, solange sie leben; neue nehmen den ersten freien.
- **Alle Kacheltexte Englisch.** Zustände: `Approve`, `Input`, `Error`, `Done`, `Limited`, `Working`, `n jobs`, `Idle`, `Offline`. Health: `ok`, `stale`, `down`, `off`.
- **Palette:** Okabe-Ito, für LCD aufgehellt und in Helligkeit gestaffelt (alle Akzente ≥ 5,8:1, Text ≥ 8,8:1). `ink-faint` (5,0:1) nur für Leere/„off“ – Abweichung vom Brief, freigegeben.
- **Symbole als Pfade**, eigene Silhouette je Zustand. **Gefüllt = ungesehen**, Kontur = gesehen/ruhig.
- **Herkunft immer** unten rechts (`MAC` wird als `REM` = Remote-Sessions angezeigt, max. 3 Zeichen).
- **◑n-Abzeichen** (Hintergrund-Jobs einer Session in anderem Zustand): luftig unten links, oder oben rechts, wenn eine Uhr läuft.
- **Inbox = „Next“-Taste**: Zahl + Symbol/Wort/Wartezeit der nächsten Session, kein Titel.
- **Status-Kachel**: ruhig (`Sources ok`) bzw. nur Störungen; Tippen → `expanded` 5 s (alle vier Quellen); Halten → Einrichtung/Diagnose.

## 3. Abweichungen vom Brief / Änderungen am Datenmodell

Bitte in `packages/render/src/model.ts` abgleichen (konnte in der Design-Session nicht gelesen werden – Feldnamen stammen aus dem Brief):

| Was | Änderung |
|---|---|
| `slot.tick` | **neu**, 0–2: welcher Punkt des Arbeitszeichens leuchtet; wechselt alle 2 s |
| `inbox.cycle` | **neu**, `{ index, total }` während des 5-s-Durchschaltens |
| `inbox.top.wait` | **neu**, Sekunden; luftig zeigt die Wartezeit der nächsten Session |
| `status.expanded` | **neu**, boolean; 5 s nach Tippen |
| `render(model, { variant })` | **neu**, `'luftig' \| 'dicht'` (Nutzereinstellung, Default luftig empfohlen) |
| `slot.badge` | `MAC` → Anzeige `REM`; Werte auf 3 Zeichen gekürzt |
| `slot.wait` | Anzeige `42 s` → `3 min` → `1:05 h` → `12 h` (statt `m:ss`); Uhr tickt nur in der 1. Minute sekündlich |
| `limit.note`/`extra.note` | englisch: `Sign in`, `No data`, `Disabled`, `New window`, `As of 14:32`. Deutsche Altwerte werden vom Renderer übersetzt |
| `limit.label` | `Week` (alt `Woche` wird übersetzt); `resetIn` `3d 4h` (alt `3T` wird übersetzt) |
| `extra.used/limit` | fertig formatierte Strings, Währungszeichen vorn oder hinten (`€12.40`); kompakt `€1.2M`, wenn zu lang |
| `detail` | Kurzformen: `server_error`→`Server`, `billing_error`→`Billing`, `rate_limit`→`Rate limit`, `overloaded`→`Overloaded`, `Kompaktiert`→`Compacting`. Details werden nie gekürzt, nur ganz gezeigt oder weggelassen |
| `slot.frame` bei `done_unseen` | Default jetzt `thick` (ungesehen); gesehen wird die Session `idle` |
| SVG-Features | zusätzlich `text-anchor`, `data-*` und `stroke` auf `<text>` (luftig); **kein** `scale()` (Symbolgrößen über Koordinaten). Keine Filter/Masken/Clips/Verläufe/CSS/SMIL |

## 4. Verhalten, das im Plugin (nicht im Renderer) umgesetzt werden muss

1. **Eskalation** – `VibeTribe.escalation(episodes, nowSec)` liefert je Episode `A|B|C|D`:
   - A: erste 30 s, ungesehen → atmet; C: älteste ungesehene, alle 60 s für 3,6 s → atmet; B: statisch dick; D: gesehen (dünn).
   - **Max. 2 atmende Tasten, neueste A-Episoden zuerst**, danach C. (Fix gegenüber Brief: sonst atmet eine neue Anfrage nie, wenn zwei ältere warten.)
   - Atemstufen bei 4 fps: `[0.35, 0.675, 1, 0.675]` (`VibeTribe.breathLevel(i)`), nur Rahmen + Tönung.
2. **Bildbudget ≤ 10 fps:** Atmen 2 × 4 = 8; Rest für Uhren < 1 min (1/s) und Arbeitszeichen (0,5/s). Budget-Wächter: zuerst Arbeitszeichen anhalten, dann Sekundenuhren in 2-s-Schritte. Uhr einer atmenden Taste nur im Atembild aktualisieren. Unveränderte Bilder nicht senden.
3. **Tasten:** Slot tippen = Sprung (Wartezustand → gesehen, `jumping` zeigt `Open…`); Inbox tippen = nächste, innerhalb 5 s weiter; Inbox halten = alle `done_unseen` quittieren; Status tippen = `expanded` 5 s; Status halten = Setup/Diagnose.
4. **Slot-Stabilität:** feste Zuordnung Session → Slot; Inbox `+N` zählt Sessions über 8 hinaus.

## 5. Vorgeschlagenes Vorgehen (Plan 6)

1. `bundle.js` nach `packages/render` portieren (TypeScript), API und ids beibehalten. Breitentabelle aus `tools/adv.json` übernehmen.
2. **Snapshot-Tests:** für jedes Modell in `tools/build.mjs` (`SAMPLES`) das SVG gegen `reference/<variante>/<name>.svg` vergleichen (byte-identisch ist erreichbar, da derselbe Algorithmus).
3. `pnpm tiles:measure` über beide Varianten laufen lassen (Text in [10, 134], ≥ 18 px). `tools/review.mjs` als Fuzz-Test übernehmen (6.500 Kombinationen, prüft Überlappungen und Safe Area; aktuell 0 Befunde).
4. Eskalation + Bildbudget-Scheduler im Plugin, Tastenaktionen (Abschnitt 4).
5. `pnpm gallery` um Variante „luftig“ erweitern; mit Deck-Prototyp vergleichen.

## 6. Offene Punkte / Risiken

- `model.ts` wurde nicht eingesehen: Feldnamen und Zustände gegen Abschnitt 3 prüfen.
- Nicht-lateinische Titel (z. B. Japanisch) fehlen in DejaVu Sans → Ersatzkästchen und falsche Breitenmessung. Vorschlag: im Modell transliterieren/entfernen.
- Breiten werden aus Advance-Werten ohne Kerning berechnet; resvg-Messung zeigt ≤ 2 px Abweichung (eingeplant).
- Atem-Tal (level 0,35): Rahmen nur 1,7–2,3:1 – bewusst, Symbol/Wort tragen den Zustand.
- Prototyp-Fremdkacheln (Apps, Musik, Medien) sind neutrale Platzhalter, keine echten Icons.
