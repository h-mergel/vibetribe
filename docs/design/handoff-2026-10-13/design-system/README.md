VibeTribe zeigt laufende Claude-Code-Sessions, Limits und Extra Usage auf den 72-px-Tasten eines Stream Deck MK.2. Die Kacheln werden nebenbei gelesen, in einem halben Blick, neben fremden Icons. Dieses System ist von Grund auf neu entworfen; der Platzhalter-Renderer war keine Vorlage.

## Haltung

- **Ruhig, bis du gebraucht wirst.** Im Normalfall ist eine Kachel dunkel, linksbündig, ohne Rahmen. Lauter wird sie nur über Rahmen, Tönung, gefülltes Symbol und Atmen, und nur bei Approve, Input, Error und Done (Done ohne Atmen).
- **Eine Leserichtung.** Jede Kachel liest sich von oben links nach unten rechts: Zustand → Titel → Zeit/Detail → Herkunft. Priorität im Zweifel: Zustand vor Titel, Titel vor Details.
- **Dreifach codiert.** Jeder Zustand hat Farbe, eine eigene Symbol-Silhouette und ein Wort. Dringlichkeit hat zusätzlich Rahmenstärke und Füllung.
- **Text bleibt Text.** Alle Werte sind echte `<text>`-Elemente in `DejaVu Sans`; Symbole sind Pfade.
- **Kein Dekor.** Keine Verläufe, Schatten, Glows, Illustrationen, Emojis. Farbe ist immer Information.

## Sprache auf den Tasten

- Alle Kacheltexte sind **Englisch**, knapp, ein Wort wo möglich. Zustände: `Approve`, `Input`, `Error`, `Done`, `Limited`, `Working`, `3 jobs`, `Idle`, `Offline`. Gesundheit: `ok`, `stale`, `down`, `off`.
- Hinweise: `Sign in`, `No data`, `Disabled`, `New window`, `As of 14:32`, `No limit`, `All clear`, `Sources ok`, `Others ok`, `Open…`. Alerts: `Port in use`, `No token`. Labels: `5h`, `Week`, `Extra`.
- Zeit: Uhr `42 s`, ab 1 min `3 min`, ab 60 min `1:05 h`, ab 10 h `12 h` (Zahl fett in `ink`, Einheit in `meta`/`ink-muted`). Reset `42m`, `2h 15m`, `3d 4h`.
- Beträge kommen fertig formatiert aus dem Modell (z. B. `€12.40`); das Währungszeichen steht dort, wo das Modell es liefert, in `unit`/`ink-muted`. Passt ein Betrag selbst in 18 px nicht, wird er kompakt: `€1.2M`.
- Alte deutsche Notizen aus dem Modell (`Anmelden`, `Stand 14:32`, `keine Daten`, …) übersetzt der Renderer; das Modell darf umgestellt werden, muss aber nicht.
- Leere Werte sind ein Gedankenstrich `–`, nie `0`, `null` oder ein leerer Raum. Keine Ausrufezeichen; Dringlichkeit trägt die Form.
- Diese Dokumentation bleibt Deutsch.

## Belegung (Seite 1, MK.2)

```
Zeile 1:  Apps     | 5h      | Week   | Inbox   | Status
Zeile 2:  Extra    | Slot 1  | Slot 2  | Slot 3  | Slot 4
Zeile 3:  Page 2   | Slot 5  | Slot 6  | Slot 7  | Slot 8
```

- Acht Slots als 4×2-Block rechts unten; die linke Spalte trägt Navigation und Geld, die obere Zeile den Überblick. Musik, Medien und Mikro liegen auf Seite 2 (`Page 2`).
- **Tastenbelegung:** Slot tippen = zur Session springen. Inbox (`Next`) tippen = zur dringendsten Session, erneut tippen innerhalb 5 s = nächste; halten = alle `Done` quittieren. Status tippen = alle Quellen 5 s lang (`expanded`); halten = Einrichtung/Diagnose.
- Slots füllen sich in Leserichtung (Zeile 2 links → Zeile 3 rechts). Eine Session behält ihren Slot, solange sie lebt; neue Sessions nehmen den ersten freien Slot. Inbox `+N` zählt Sessions über die acht hinaus.

## Varianten: luftig (Standard) und dicht

Der Renderer kennt zwei Dichten: `VibeTribe.render(model, { variant: 'luftig' | 'dicht' })`. **Luftig ist die Empfehlung** für den Alltag. Die Herkunft steht in beiden Varianten immer unten rechts, damit jede Session-Kachel gleich aufgebaut ist; dicht zeigt alle Pflichtinhalte des Briefs und bleibt für Nutzer, die mehr auf einmal sehen wollen.

| | dicht | luftig |
|---|---|---|
| Rand | 10 px, dicker Rahmen innen bis x 9 | 14 px, dicker Rahmen 6 px ganz außen (0–6) |
| Kopf | Symbol 28, Wort 20 (→18) | Symbol 22, Wort 20 (→18, wenn ◑ daneben steht oder es nicht passt) |
| Titel | 2 Zeilen 20 px, Grundlinien 64/88 | 2 Zeilen **22 px** (→20 → 18), Grundlinien 72/99 |
| Strichstärke Text | normal | reguläre Texte (Titel, Einheiten, Hinweise) mit 0,7 px Kontur in ihrer eigenen Farbe (`stroke-text`): liest sich auf dem LCD wie Halbfett, ohne breiter zu laufen als Bold |
| Fuß | Uhr oder Detail · Herkunft immer | Uhr (22 px, wenn Platz) oder ◑-Abzeichen · Herkunft immer |
| ◑-Abzeichen | rechts im Kopf | im Fuß links, wenn keine Uhr läuft; sonst rechts im Kopf (entfällt nur bei `Approve`) |
| Detail | Tool, Fehlerart, Job-Aufteilung | nur Fehlerart, nur bei einzeiligem Titel |
| Inbox | dringendste Session mit Titel | „Next“-Taste: Zustandssymbol, Wort und Wartezeit der nächsten Session, kein Titel |
| Status | vier Zeilen | nur Störungen; sonst großer Haken + `Sources ok`; Tippen zeigt 5 s alle vier Quellen |
| Extra | `of €50.00` + Balken | nur Balken (Anteil steht oben rechts) |
| Limit | gleich | gleich |

Beide Varianten teilen Tokens, Symbole, Zustände, ids und Eskalation.

## Raster und Anatomie

Alle Kacheln: `viewBox 0 0 144 144`, Grund `ground` vollflächig und **ohne Eckenradius** (`radius-tile`). Text und Bedeutungsträger liegen in `[safe-min, safe-max]` = [10, 134]; nur Rahmen und Tönung reichen bis an den Rand. Text ist linksbündig an x = 10, Gegenstücke rechtsbündig an x = 134.

```
Slot                                   y
┌──────────────────────────────────┐
│ [◆!] Approve               ◑2    │  31  baseline-head   (Symbol 28px @10,10 · Wort @42)
│                                  │
│ Mobile Entw…                     │  64  baseline-title-1
│ Northwind                         │  88  baseline-title-2 (oder Detail)
│                                  │
│ 42 s                       APP   │ 127  baseline-foot
└──────────────────────────────────┘
  x=10                       x=134
```

| Kachel | Aufbau |
|---|---|
| Slot | Kopf (Symbol + Zustandswort + optional Hintergrund-Abzeichen) · Titel 2 Zeilen · Fuß (Uhr oder Detail links, Herkunft rechts) |
| Inbox | Kopf (Ablage-Symbol + Zahl, Überlauf-Pille rechts) · Trennlinie bzw. Positionssegmente · dringendste Session als Mini-Slot |
| Limit | 250°-Ring, nach unten offen · Label im Ring oben · Prozent mittig · Reset/Notiz in der Ringöffnung |
| Extra | Label + Anteil · Betrag groß · „of limit“/Notiz · Balken |
| Status | vier Quellenzeilen (Symbol · Kürzel · Wort) · Alert ersetzt den Fuß |

## Farbe

Eine einzige Theme-Stufe `lcd`: dunkler Grund, heller Text. Keine Hell-Variante. Die Akzente sind Okabe-Ito-Farbtöne, **für das LCD aufgehellt und in der Helligkeit gestaffelt**, damit sie bei Tageslicht und niedriger Displayhelligkeit nicht absaufen (alle Akzente L\* ≥ 59).

| Token | Wert | Kontrast auf `ground` | Rolle |
|---|---|---|---|
| `ink` | #F3F5F8 | 17,3:1 | Titel, Uhr, Kennzahlen |
| `ink-muted` | #A9B2BF | 8,8:1 | Herkunft, Detail, Labels |
| `ink-faint` | #7A8494 | 5,0:1 | nur Leere/Abwesenheit |
| `state-permission` | #FFB524 | 10,7:1 | Approve |
| `state-input` | #E879C4 | 7,2:1 | Input |
| `state-error` | #FF5C33 | 6,2:1 | Error |
| `state-done` | #30D6A4 | 10,2:1 | Done |
| `state-throttled` | #B4C8E8 | 11,1:1 | Limited |
| `state-working` | #3D8EF5 | 5,8:1 | Working, jobs |
| `state-idle` | #8D97A6 | 6,4:1 | Idle |
| `state-offline` | #7A8494 | 5,0:1 | Offline |
| `level-neutral` | #C3CDDA | 11,8:1 | Ring/Balken < 60 % |

Regeln:

- Text immer `ink` oder `ink-muted` (≥ 7:1). `ink-faint` (5,0:1) nur, wo „hier ist nichts“ die Botschaft ist (`off`, `Disabled`, leere Inbox). Diese Abweichung von der 7:1-Vorgabe des Briefs ist freigegeben.
- Akzentfarben nur auf Symbol, Zustandswort, Rahmen, Tönung, Ring, Balken. Nie Akzent als Flächenfarbe hinter Text, außer der Tönung mit 12 %.
- `track` und `line` liegen unter 3:1 und dürfen deshalb nie allein Bedeutung tragen.

### Palettenvergleich

ΔE = CIELAB-Abstand zweier Zustandsfarben nach Simulation (Machado 2009, volle Ausprägung). Unter ~20 sind Farben praktisch nicht mehr zu unterscheiden.

| Paar | 1 Okabe-Ito roh | **2 gestaffelt (gewählt)** | 3 reduziert |
|---|---|---|---|
| Approve / Error | prot 25 · deut 18 · trit 30 | prot 40 · deut 22 · trit 49 | wie 2 |
| Done / Working | prot 58 · deut 55 · trit 16 | prot 78 · deut 74 · trit 26 | 0 (gleiche Farbe) |
| Input / Error | prot 72 · deut 70 · trit 37 | prot 74 · deut 74 · trit 38 | 22 (Input = Approve) |
| Approve / Input | prot 88 · deut 81 · trit 18 | prot 107 · deut 91 · trit 21 | 0 |
| schwächster Akzent | Blau #0072B2: **3,7:1, fällt durch** | Blau 5,8:1 | Blau 5,8:1 |

Entscheidung **Option 2**: Sie hält alle Akzente über 4,5:1, trennt die kritischen Paare zusätzlich über Helligkeit (Approve L\* 79 gegen Error L\* 61; Done 77 gegen Working 59) und lässt Option 3 als Rückfallebene offen: Weil jeder Zustand Symbol und Wort trägt, funktioniert das System auch, wenn Farbe ganz ausfällt. Die schwächsten Stellen (Approve/Error bei Deuteranopie, Approve/Input bei Tritanopie) tragen Raute gegen Achteck, gefüllte Raute mit „!“ gegen Sprechblase mit „?“, und unterschiedliche Wörter.

## Typografie

`DejaVu Sans`, Gewichte 400 und 700, keine Webfonts; Familie im SVG: `DejaVu Sans, Segoe UI, Arial, sans-serif`. Mindestgröße 18 px (9 px am Gerät).

| Stil | Größe/Gewicht | Einsatz |
|---|---|---|
| `count` | 34/700 | Inbox-Zahl |
| `amount` | 34→18/700 | Extra-Betrag, stufenweise |
| `pct` | 32/700 | Limit-Prozent |
| `state-word` | 20/700 (→18) | Zustandswort |
| `title` | 20/400 (→18) | Session-Titel |
| `clock` | 20/700 | Wartezeit |
| `unit` | 20/700 | %, €, „/3“ |
| `meta` | 18/400 | Detail, Reset, Notiz |
| `meta-strong` | 18/700 | Herkunft, Labels, Quellen, Alert |

Der Titel steht bewusst in 400: DejaVu Sans Book ist für Bildschirme gezeichnet, bei 20 px gut lesbar und passt 30 % mehr Zeichen in die Zeile als Bold („Entwicklung“: 117 px gegen 134 px). Hierarchie entsteht über Farbe: Zustand farbig und fett, Titel weiß und regulär.

## Symbole

Alle Symbole sind Pfade in einer 28-px-Box (Inbox 20, Status 20), Strich `stroke-glyph` 3,4 px. Jede Silhouette ist einmalig:

| Zustand | Silhouette | Zeichen |
|---|---|---|
| Approve | Raute | ! |
| Input | Sprechblase | ? |
| Error | Achteck | × |
| Done | Kreis | ✓ |
| Limited | Sanduhr | – |
| Working | drei Punkte, einer hell | – |
| jobs | Kreis, halb gefüllt | – |
| Idle | liegender Balken | – |
| Offline | Kreis, durchgestrichen | – |

**Füllung = ungesehen.** Bei dickem Rahmen (Approve, Input, Error, Done ungesehen) ist die Silhouette in der Zustandsfarbe gefüllt, das Zeichen in `on-accent` ausgespart. Gesehen wird sie zur Kontur. So bleibt „ungesehen“ auch in Graustufen erkennbar.

Herkunft (`APP`, `WIN`, `WSL`, `REM`, `?`) bleibt **Text** in `meta-strong`/`ink-muted`, rechtsbündig im Fuß: Piktogramme für Windows/WSL/Remote wären bei 72 px raten.

## Rahmen, Eskalation, Atmen

| Phase | Rahmen | Tönung | Symbol | Bewegung |
|---|---|---|---|---|
| A Atmen (0–30 s) | `stroke-frame-thick`, Deckkraft = level | `tint` × level | gefüllt, konstant | 4 Bilder/s |
| B ruhig, dringend | dick, 1,0 | 0,12 | gefüllt | keine |
| C Erinnerung | wie A, 3 Perioden | wie A | gefüllt | 12 Bilder, dann B |
| D gesehen | `stroke-frame-thin`, 1,0 | keine | Kontur | keine |
| Error ungesehen | dick, 1,0 | 0,12 | gefüllt | nie |
| Done ungesehen | dick, 1,0 | 0,12 | gefüllt | nie |
| Offline | 2 px gestrichelt, `ink-faint` | keine | Kontur | nie |

- **Atemstufen:** 4 Bilder pro Periode 1,2 s: `breath-1…4` = 0,35 · 0,675 · 1,0 · 0,675. Das ist exakt die Code-Kurve `0.35 + 0.65·(0.5 − 0.5·cos 2πφ)` bei φ = 0, ¼, ½, ¾. Eine Helligkeitswelle pro 1,2 s = 0,83 Wechselpaare/s, weit unter WCAG 2.3.1 (3/s); die Stufen sind weich, kein Hart-an/aus.
- **Was dimmt:** nur `vt-frame` (stroke-opacity) und `vt-tint` (fill-opacity = 0,12 × level). Symbol, Zustandswort, Titel, Uhr, Herkunft bleiben bei 1. Bei 0,35 ist der dicke Rahmen noch sichtbar, das gefüllte Symbol trägt „braucht mich“ allein.
- **B gegen D ohne Farbe:** 8 px gegen 3 px Rahmen, Tönung gegen keine, gefülltes gegen Kontur-Symbol. Drei unabhängige Merkmale.
- `done_unseen` ist so sichtbar wie Approve/Input im ruhigen Zustand B: dicker Rahmen, Tönung, gefülltes Symbol in `state-done`. Es atmet nie (Bewegung bleibt für „braucht dich“). Nach dem Ansehen wird die Session `idle`.
- **Wer atmet** (`VibeTribe.escalation(episodes, now)` liefert je Episode A/B/C/D): höchstens 2 Tasten. Zuerst die **neuesten** Episoden in ihren ersten 30 s, danach, falls noch Platz ist, die Erinnerung (C) der ältesten ungesehenen. So atmet eine frische Anfrage immer an, auch wenn ältere schon warten.
- **Atem-Tal bei Tageslicht:** bei level 0,35 hat der Rahmen nur 1,7–2,3:1 gegen den Grund und verschwindet im Tal fast. Gewollt: Das gefüllte Symbol und das Wort bleiben konstant und tragen den Zustand allein.

## Bewegung und Bildbudget

- Erlaubt: Atmen (Phase A/C, max. 2 Tasten, 4 Bilder/s), Uhr, Arbeitszeichen bei Working (heller Punkt wandert alle 2 s, Parameter `tick` 0–2). Sonst ändert sich nichts von selbst.
- Die Uhr tickt nur in der ersten Minute sekündlich (`42 s`), danach minütlich (`3 min`, `1:05 h`). Bei einer atmenden Taste wird sie **mit dem Atembild** aktualisiert, nicht zusätzlich.
- Rechnung für 8 Slots: 2 × 4 (Atmen) = 8 Bilder/s; bleiben 2 Bilder/s für sekündliche Uhren und Arbeitszeichen (0,5/s je Taste).
- **Budget-Wächter**, wenn mehr verlangt wird als 10 Bilder/s: zuerst bleiben die Arbeitszeichen stehen, dann springen sekündliche Uhren in 2-s-Schritten. Atmen hat Vorrang, weil es „braucht dich“ trägt.

## Textregeln

| Feld | Zeilen | Breite | Ausrichtung | Kürzung | Leer |
|---|---|---|---|---|---|
| Zustandswort | 1 | 92 px (mit ◑: minus Abzeichen) | start @42 | 20→18 px, dann `…` | – |
| Titel (Slot, Inbox) | 2 | 124 px | start @10 | siehe unten | `–` |
| Uhr | 1 | ≤ 73 px (Zahl + Einheit) | start @10 | nie | entfällt |
| Detail | 1 | 124 px (Titelzeile 2) oder 124 − Herkunft − 8 (Fuß) | start @10 | **nie gekürzt**: passt ganz oder entfällt | entfällt |
| Herkunft | 1 | ≤ 43 px | end @134 | nie | `?` |
| Hintergrund | 1 | 15 px Symbol + Zahl | end @134 | – | entfällt |
| Inbox-Wort | 1 | 96 px | start @38 | `…` | – |
| Limit-Reset/Notiz | 1 | 124 px | middle @72 | `…` | – |
| Extra-„von“ | 1 | 124 px | start | `of €2,000.00` → `of €2,000` → `€2,000.00` | `No limit` |
| Alert | 1 | 116 px | middle @72 | `…` | – |

**Titel:** Erst an Leerzeichen umbrechen, dann nach `- _ / .`. Reicht das nicht, bleiben Anfang und Ende erhalten: Zeile 2 nimmt so viele Schlusswörter wie passen, Zeile 1 die Anfangswörter mit `…` („Mobile En…“ / „Northwind“), weil sich Sessions meist am Ende unterscheiden. Ein einzelnes zu langes Wort wird mit Trennstrich gebrochen, nie mit weniger als 3 Buchstaben in Zeile 2 („Datenmigr-“ / „ation“). 18 px nur, wenn das eine Kürzung oder einen harten Bruch einspart. Emoji und Variationszeichen werden entfernt.

**Detail-Kurzformen:** `server_error` → `Server`, `billing_error` → `Billing`, `rate_limit` → `Rate limit`, `overloaded` → `Overloaded`, `Subagent` → `Subagent`, `Kompaktiert` → `Compacting`; Tool-Namen unverändert.

**Platzvergabe im Slot** (fest, in dieser Reihenfolge):

1. Zustandssymbol und Zustandswort: immer.
2. Titel: 2 Zeilen.
3. Fuß links: Uhr (Wartezustände) bzw. `Open…` beim Sprung, sonst Detail.
4. Detail: in Titelzeile 2, wenn der Titel einzeilig ist; sonst im Fuß, wenn dort Platz ist; sonst entfällt es.
5. Hintergrund-Abzeichen ◑n: rechts im Kopf, wenn das Zustandswort (notfalls in 18 px) daneben passt; sonst entfällt es. Bei `Approve` entfällt es immer.
6. Fällt zuerst weg: Detail, dann Hintergrund-Abzeichen. Uhr und Zustandswort fallen nie weg.

**Grenzfälle** (alle mit einem Fuzz-Test über 6.404 Kombinationen je Variante geprüft, keine Überlappung, nichts außerhalb [10, 134]):

- Zahlen über 99 werden `99+`. Die Inbox-Zahl schrumpft 34 → 28 → 24 → 20, wenn sie mit `/total` oder der Überlauf-Pille nicht passt; die Pille entfällt beim Durchschalten und wenn die Zahl den Platz braucht.
- Herkunft wird auf 3 Zeichen gekürzt (`MAC` → `REM`). `bgCount` 0 zeigt kein Abzeichen, `background` ohne Zahl heißt `Jobs`.
- Nicht-lateinische Titel (z. B. Japanisch) fehlen in DejaVu Sans: resvg zeigt Ersatzkästchen, und die Breitenmessung stimmt nicht. Solche Zeichen sollte das Modell vorher transliterieren oder entfernen.

## Barrierefreiheit

- Kein Zustand unterscheidet sich nur über Farbe: Silhouette + Wort + (für Dringlichkeit) Rahmenstärke und Füllung.
- Tempo-Marke im Limit-Ring ist eine Form: ein heller Querstrich, der den Ring mit einer `ground`-Aussparung durchschneidet. „Vor Plan“ ist ein Pfeil-Symbol neben der Zahl.
- Rot/Grün entscheiden nie allein: Error (Vermillion, Achteck) und ok/Done (Blaugrün, Kreis/Haken) unterscheiden sich in Form, Wort und Helligkeit.
- Keine Bewegung außer bei „braucht dich“; kein Blinken.

## Antworten auf die offenen Fragen

1. **Symbolik:** gezeichnete Pfade mit eigener Silhouette je Zustand (Tabelle oben). Textzeichen wie `◑ ∅` fehlen in manchen Fallback-Schriften und haben keine kontrollierbare Strichstärke.
2. **Palette:** Option 2, aufgehellt für das LCD; Begründung und Zahlen im Palettenvergleich.
3. **Atmen:** Rahmen + Tönung, 4 Stufen, Symbol und Text konstant. Bei 0,35 wirkt die Taste wie ein gedämpftes Glühen neben ruhigen Nachbarn, nicht wie ein Aussetzer.
4. **B gegen D:** Rahmenstärke reicht nicht allein; zusätzlich Tönung und gefülltes/Kontur-Symbol.
5. **Inbox-Durchschalten:** Zahl wird zur Position (`2/3`, „/3“ in ink-muted), die Trennlinie zerfällt in 3 Segmente, das aktuelle hell. Die Inbox unterscheidet sich vom Slot durch das Ablage-Symbol und die große Zahl oben statt eines Zustandsworts.
6. **Hintergrund-Abzeichen:** rechts im Kopf, 15-px-Halbkreis + Zahl in `meta-strong`. Fällt vor der Uhr weg, nach dem Detail.
7. **Herkunft:** Text, farbneutral, rechts im Fuß. Bei 72 px getestet lesbar (≤ 43 px). `REM` steht für alle Remote-Sessions; das heutige `MAC` im Modell wird als `REM` angezeigt.
8. **Titel:** Umbruch auf 2 Zeilen mit Kopf-Ende-Kürzung (s. Textregeln); bessere Ausnutzung als feste 10 Zeichen, weil die Breite in Pixeln gemessen wird.
9. **Leere:** Leerer Slot = gestricheltes 44er-Quadrat in `line`, sonst nichts: liest sich als „frei“, nicht als Defekt. Leere Inbox = `0` und Ablage in `ink-faint`, darunter Kontur-Haken in `state-done` und „All clear“.
10. **Limit:** Tempo-Marke als Querschnitt durch den Ring (formbasiert, farbunabhängig). „Vor Plan“ als Pfeil neben der Prozentzahl in Stufenfarbe; im Ring wäre er neben der Tempo-Marke zu klein.
11. **Status `off` gegen `missing`:** `off` = Strich, ganze Zeile `ink-faint`, Wort „off“; `missing` = × in `state-error`, Kürzel `ink`, Wort „down“ fett. Alles ok: Kürzel `ink-muted`, kleine Haken: die Kachel tritt zurück.
12. **Nachbarn:** bewusst eigenständig, aber leise: dunkler Grund, linksbündiges Schriftbild, Farbe nur als Signal. Die Kacheln bilden eine erkennbare Familie, ohne neben Spotify/Elgato zu schreien.
13. **Ecken:** Grund eckig und randlos (`radius-tile` 0); die physische Taste rundet. Nur die Rahmen sind gerundet (14/16 px), damit sie der Tastenkante folgen.

## Übernahme in den Renderer

- `components/bundle.js` ist der Referenz-Renderer: `VibeTribe.render(model)` liefert das SVG als String, für jede Kachel und jeden Zustand. Er enthält die Maßtabelle von DejaVu Sans, die Kürzungsregeln und alle Tokens; Typen in `components/index.d.ts`.
- Alle Referenz-SVGs liegen in den Asset-Gruppen **Tiles** (dicht) und **TilesLuftig** (Dateinamen wie im Brief), erzeugt mit genau diesem Renderer und mit resvg gemessen: alle Texte in [10, 134], keiner unter 18 px.
- Dynamische Elemente tragen feste `id`s: `vt-frame`, `vt-tint`, `vt-glyph` (`data-glyph`), `vt-state-word`, `vt-title-1/2`, `vt-clock`, `vt-clock-unit`, `vt-detail`, `vt-jump`, `vt-badge`, `vt-bg-glyph`, `vt-bg-count`, `vt-work-tick` (`data-tick`), `vt-count`, `vt-count-of`, `vt-cycle`, `vt-overflow`, `vt-top-*`, `vt-ring` (`stroke-dasharray`), `vt-pace` (`data-angle`), `vt-ahead`, `vt-pct`, `vt-pct-unit`, `vt-label`, `vt-reset`/`vt-note`, `vt-amount`, `vt-amount-unit`, `vt-limit`, `vt-bar` (`width`), `vt-status-<SRC>` (`data-health`), `vt-alert`.
- Verwendete SVG-Features: `rect`, `circle`, `line`, `path`, `polygon`, `g`, `text`; `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `fill-opacity`, `stroke-opacity`, `transform` (nur translate; Symbolgrößen werden über die Koordinaten umgerechnet), dazu `text-anchor` und `data-*`-Attribute (Hinweise für den Renderer, resvg ignoriert sie). Keine Filter, Masken, Clips, Verläufe, Bilder, CSS, SMIL.
