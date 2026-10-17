# VibeTribe: Design-Brief für die Stream-Deck-Kacheln

Stand: 2026-10-13. Grundlage: Spec §5, §6, §12 und der aktuelle Platzhalter-Renderer (`packages/render`, Plan 3c). Dieses Dokument ist die Eingabe für eine Claude-Design-Session.

## 1. Ziel und Ton

VibeTribe zeigt einem Entwickler auf einem Elgato Stream Deck MK.2 alle laufenden Claude-Code-Sessions (hauptsächlich über Claude Desktop) plus 5h-/Wochenlimit und Extra Usage. Der Blick aufs Deck passiert nebenbei, während er programmiert.

**Ton:** ruhig, klar, technisch-freundlich. Keine Dashboard-Schreierei. Die Kacheln stehen neben Elgato- und Spotify-Icons und müssen daneben ruhig und lesbar wirken. Bewegung gibt es nur bei "braucht dich".

**Belegung der ersten Seite (Nutzergerät):**

```
Zeile 1:  Apps (Ordner) | 5h-Limit | Wochenlimit | Inbox | Status
Zeile 2:  Spotify öffnen | Slot 1 | Slot 2 | Slot 3 | Slot 4
Zeile 3:  Spotify Media x3 (Zurück, Play, Weiter) | Mikro | nächste Seite
```

Die Extra-Usage-Kachel liegt nicht auf Seite 1, ist aber ein vollwertiger Kacheltyp.

**In 0,5 s pro Kachel muss lesbar sein:**

| Kachel | Muss auf einen Blick klar sein |
|---|---|
| Session-Slot | 1. Zustand (braucht mich / arbeitet / fertig / Fehler / ruhig), 2. welche Session (Titel), 3. wie lange ich schon warte (nur bei Wartezuständen) |
| Inbox | Wie viele Sessions warten, und welche ist die dringendste |
| 5h / Woche | Wie voll (Ring und Prozent), und ob ich über Plan bin |
| Extra | Verbrauchter Betrag und Anteil am Limit |
| Status | Ist irgendeine Quelle kaputt (WIN/WSL/MAC/LIM) |

Priorität im Zweifel: Zustand vor Titel, Titel vor Details.

## 2. Technischer Rahmen (verbindlich)

- **Hardware:** MK.2, 15 Tasten, je 72 x 72 px. Wir rendern **144 x 144** (HiDPI) und senden SVG als Data-URL. Die Stream-Deck-App skaliert auf 72 px herunter. **Immer auch bei 72 px prüfen** (`pnpm gallery` liefert beide Größen).
- **Canvas:** `viewBox="0 0 144 144"`, abgerundeter Grund (Platzhalter `rx=18`).
- **Sicherer Bereich:** Text und wichtige Elemente innerhalb **[10, 134] px** (auf beiden Achsen). `pnpm tiles:measure` misst jeden Text mit resvg und schlägt sonst fehl.
- **Mindestschrift: 18 px** (bei 144 px). Keine kleineren Zeichen, auch nicht für Abzeichen oder Einheiten.
- **Erlaubte SVG-Features:** `rect`, `circle`, `line`, `path`, `polygon`, `g`, `text`; `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `fill-opacity`/`stroke-opacity`, `transform` (rotate/translate). **Verboten:** Filter (Blur, Schatten, Glow), Masken, Clip-Paths, `<image>`, externe Ressourcen, `<style>`/CSS-Klassen, `<animate>`/SMIL. Verläufe bitte vermeiden.
- **Schrift:** keine Webfonts. Familie `DejaVu Sans, Segoe UI, Arial, sans-serif` (Renderer ist resvg). Gewichte nur 400 und 700. Text bleibt echter `<text>` (siehe §6).
- **Symbole:** Der Platzhalter nutzt Textzeichen (`! ? × ✓ ~ … ◑ ∅`). Bitte entscheiden, ob Symbole besser als kleine `path`-Formen gezeichnet werden (zuverlässiger als Zeichen, die in der Schrift fehlen könnten).
- **Farben:** nur als Tokens (§6). Keine losen Farbwerte in Kacheln.
- **Kontrast auf dem LCD:** Die Tasten-LCDs sind klein, spiegelnd und je nach Blickwinkel und Raumlicht blass. Dunkler Grund mit hellem Text (Platzhalter `#111418` / `#F2F2F2`) ist gesetzt. Erwartung: Text gegen Grund mindestens 7:1, Akzentfarben gegen Grund mindestens 4,5:1. **Bitte zusätzlich für helle Umgebung prüfen** (Tag, Fenster): Akzentflächen nicht zu dunkel, Rahmen nicht zu dünn. Eine echte Hell-Variante der Kachel ist nicht vorgesehen, die Kacheln müssen aber in einem hellen Raum und bei niedriger LCD-Helligkeit funktionieren.
- **Animation:**
  - **Bildbudget: höchstens 10 Bilder/s für das ganze Plugin** (nicht pro Taste).
  - Atmen mit etwa **4 Bildern/s**, höchstens **2 Tasten gleichzeitig**. Uhren (Wartezeit) aktualisieren höchstens 1x/s. Das Arbeitszeichen bei `working` höchstens 1 Bild/s.
  - **Jedes Animationsbild ist ein eigenes, vollständiges Bild** (kein GIF, kein SMIL, keine CSS-Animation). Der Renderer erzeugt pro Zeitpunkt ein SVG mit anderem Parameter.
  - Nie hartes Blinken: unter 3 Helligkeitswechsel/s (WCAG 2.3.1).
  - Ein unverändertes Bild wird nicht erneut gesendet. Das Design darf deshalb nichts enthalten, das sich ohne Zustandsänderung von selbst ändert (außer Uhr und Atmen).

## 3. Kacheltypen, Zustände und Beispieldaten

Alle Texte sind Deutsch. Die Datenfelder stammen direkt aus dem Render-Modell (`packages/render/src/model.ts`). Beispielwerte sind realistisch und sollen in den Entwürfen verwendet werden.

### 3.1 Session-Slot (`kind: "slot"`)

| Feld | Bedeutung |
|---|---|
| `title` | Desktop-Name der Session, sonst Projektordner. Max. 2 Zeilen |
| `state` | einer von 9 Zuständen (unten) |
| `badge` | Herkunft: `APP` (Claude Desktop), `WIN`, `WSL`, `MAC`, `?` (Herkunft noch unbekannt). `MAC` wird im nächsten Plan zu `REM` (generische Remote-Sessions). Beide Varianten mitdenken |
| `wait` | Wartezeit-Uhr `m:ss` (ab 60 min `h:mm h`), nur bei `needs_permission`, `needs_input`, `error`, `done_unseen` |
| `detail` | Detailzeile: bei `working` das letzte Tool oder "Subagent" oder "Kompaktiert", bei `error` und `throttled` die Fehlerart, bei `background` die Aufteilung der Jobs |
| `bgCount`, `bgStale` | Hintergrund-Jobs. Abzeichen "◑3" bzw. "◑?" (Zähler seit 30 min unverändert) |
| `frame` | `thick` (ungesehen, braucht mich oder Fehler), `thin` (gesehen), `normal` |
| `level` | Akzenthelligkeit 0,35 bis 1 (1 = statisch), nur beim Atmen unter 1 |
| `jumping` | Sprung zur Session läuft: Fußzeile zeigt "…" |

**Pflichtinhalte pro Slot:** Titel, Zustandssymbol, Zustandswort, Herkunfts-Abzeichen; Wartezeit-Uhr bei Episoden; Hintergrund-Abzeichen, wenn Jobs laufen. Optional: Detailzeile.

**Zustände (Priorität absteigend) mit Beispielwerten:**

| # | Zustand | Wort (Platzhalter) | Beispiel-Titel | Badge | Uhr / Detail | Animation |
|---|---|---|---|---|---|---|
| 1 | `needs_permission` | Freigabe | "Mobile Entwicklung Northwind" | APP | Uhr `0:42` | Atmen 0-30 s, danach ruhig + dicker Rahmen, Uhr läuft |
| 2 | `needs_input` | Frage | "Spec-Review VibeTribe" | APP | Uhr `1:05` | wie 1 |
| 3 | `error` | Fehler | "acme" | WSL | Detail `server_error` oder `billing_error`, Uhr `12:30` | nie animiert, dicker Rahmen bis gesehen, dann dünn |
| 4 | `done_unseen` | Fertig | "Refactor hub" | WIN | Uhr `3:10`, optional Hintergrund-Abzeichen ◑3 | nie animiert |
| 5 | `throttled` | Limit | "Datenmigration" | APP | Detail `rate_limit` oder `overloaded` | nie animiert, Info-Farbe |
| 6 | `working` | Arbeitet | "Mobile Entwicklung Northwind" | APP | Detail `Edit`, `Subagent`, `Kompaktiert`; Hintergrund-Abzeichen ◑2 möglich | nur kleines lokales Arbeitszeichen (z. B. 3 Punkte, 1 Bild/s), nie die ganze Kachel |
| 7 | `background` | "3 laufen" (oder "Hintergrund?" bei Stale) | "Build Pipeline" | WSL | Detail `2 Shell · 1 Agent` (Kurzform bei zwei Arten: `2 Sh · 1 Ag`) | nie animiert, ruhig in Farbe von `working`, eigenes Symbol |
| 8 | `idle` | Bereit | "Notizen" | APP | keine | keine |
| 9 | `no_signal` | Offline | "MacBook Sandbox" | MAC (REM) | keine | keine |

Zusätzlich:
- **Slot leer** (`kind: "empty"`): dunkel, kein Text, höchstens ein dezenter Platzhalter. Er darf neben Elgato-Tasten nicht wie ein Defekt wirken.
- **Sprung läuft** (`jumping`): Fußzeile "…" statt Uhr/Detail, sonst unverändert.
- **Lange Titel testen**, z. B.: "Mobile Entwicklung Northwind Backend Refactoring" (viele Wörter), "vibetribe-streamdeck-plugin" (ein langes Wort ohne Leerzeichen), "Überprüfung Änderungsprotokoll" (Umlaute), "A" (sehr kurz), ein Titel mit Emoji.
- **Farbe, Symbol und Wort sind dreifach codiert.** Kein Zustand darf nur über Farbe unterscheidbar sein.

### 3.2 Inbox (`kind: "inbox"`)

| Feld | Bedeutung |
|---|---|
| `top` | dringendste Session `{ title, state }` oder `null` |
| `waiting` | Zahl wartender Sessions |
| `overflow` | `+N`: so viele laufende Sessions mehr, als Slots vorhanden sind |

Zustände:
- **Mit Inhalt:** waiting `2`, top "Mobile Entwicklung Northwind", Zustand Freigabe.
- **Durchschalten (cycling):** Kurzer Druck springt zur dringendsten Session, weitere Drücke innerhalb von 5 s gehen die wartenden der Reihe nach durch. Die Kachel zeigt dann die jeweils aktuelle Session (top wechselt, waiting bleibt). Der Wechsel soll auf einen Blick lesbar sein (offene Frage 5).
- **Überlauf:** waiting `1`, `+3` rechts oben.
- **Leer:** waiting `0`, top `null`: ruhig, bestätigend, nicht defekt wirkend.
- Lang gedrückt quittiert alle `done_unseen`.

### 3.3 5h- und Wochenlimit (`kind: "limit"`)

| Feld | Bedeutung |
|---|---|
| `label` | `"5h"` oder `"Woche"` |
| `usedPct` | 0 bis 100 oder `null` |
| `pacePct` | Soll-Stand nach Zeit (Tempo-Markierung auf dem Ring) oder `null` |
| `resetIn` | Zeit bis Reset: `42m`, `2h 15m`, `3T 4h` |
| `level` | `neutral` (unter 60 %), `amber` (60-85 %), `red` (ab 85 %) |
| `ahead` | mehr als 10 Prozentpunkte über Plan: Pfeil "vor Plan" |
| `stale` | Daten älter als 15 min: gedämpft |
| `note` | ersetzt die Reset-Zeile: `Stand 14:32`, `Anmelden`, `keine Daten`, `neues Fenster` |

Zustände mit Beispielen:
- **Normal:** 5h, 34 %, Pace 40 %, Reset `2h 15m`, neutral.
- **Amber mit Vor-Plan-Pfeil:** Woche, 72 %, Pace 55 %, Reset `3T 4h`, amber, ahead.
- **Rot:** 5h, 91 %, Pace 80 %, Reset `38m`, red.
- **Veraltet:** 5h, 48 %, Note `Stand 14:32`, gedämpft (Ring und Zahl entsättigt).
- **Anmelden:** Anmeldung abgelaufen. Note `Anmelden`, Werte gedämpft (zuletzt bekannter Wert) oder `–`.
- **Keine Daten:** Ring leer, `–`, Note `keine Daten`.
- **Neues Fenster:** 0 %, Note `neues Fenster`.

Limit-Kacheln animieren nie. Die Tempo-Markierung muss **auch ohne Farbe** erkennbar sein (Form, nicht nur Farbe).

### 3.4 Extra Usage (`kind: "extra"`)

| Feld | Bedeutung |
|---|---|
| `used` | verbrauchter Betrag, `de-DE` formatiert, z. B. `12,40 €` |
| `limit` | Monatslimit, z. B. `50,00 €`, oder `null` (kein Limit) |
| `ratio` | 0 bis 1 oder `null` |
| `level` | wie bei Limits (`neutral`/`amber`/`red`) |
| `stale` | älter als 10 min |
| `note` | `Stand 14:32`, `Anmelden`, `keine Daten`, `nicht aktiv` |

Zustände: normal (`12,40 €` von `50,00 €`, 25 %), amber (`38,00 €`, 76 %), rot (`47,50 €`, 95 %), ohne Limit (nur Betrag, kein Anteil), veraltet (`Stand 14:32`), `Anmelden`, `keine Daten`, deaktiviert (`aus`, Note "nicht aktiv"). Der Betrag kann bis etwa `1.234,56 €` lang werden: die Schriftgröße muss stufenweise schrumpfen können, nie unter 18 px.

### 3.5 Status (`kind: "status"`)

Eine Kachel mit vier Quellenzeilen:

| Zeile | Bedeutung |
|---|---|
| `WIN` | Windows-Reporter (Hooks, Session-Dateien) |
| `WSL` | WSL-Reporter |
| `MAC` | Mac-Agent; wird im nächsten Plan zu `REM` (generische Remote-Sessions) |
| `LIM` | Usage-Abfrage (Limits) |

Gesundheit pro Zeile: `ok`, `stale` (veraltet), `missing` (konfiguriert, aber nicht erreichbar), `off` (nicht konfiguriert; im Platzhalter "aus"). `off` ist **kein Fehler** und darf nicht wie einer aussehen. `missing` dagegen schon, aber ruhig.

**Alerts** (ersetzen die Fußzeile, roter Rahmen): `Port belegt` (die Zentrale konnte ihren Port nicht binden), `Kein Token` (Setup lief nie). Max. 11 Zeichen. Beispielsätze für den Entwurf:
- alles ok: WIN ok, WSL ok, MAC aus, LIM ok, kein Alert
- WSL veraltet, LIM fehlt
- Alert `Port belegt` bei sonst grünen Zeilen
- Alert `Kein Token`, Zeilen `missing`/`off`

Im Normalfall (alles ok) soll die Kachel ruhig bleiben und nicht dominieren.

## 4. Eskalation und Atmen

Phasen für `needs_permission` und `needs_input` (Spec §5, Zahlen einstellbar):

| Phase | Zeitpunkt | Was sich ändert |
|---|---|---|
| A: Atmen | 0 bis 30 s nach Episodenbeginn, ungesehen | Kachel "atmet": Akzent-Helligkeit schwankt zwischen 35 % und 100 %, Periode 1,2 s, ca. 4 Bilder/s. Rahmen dick. Uhr `m:ss` läuft |
| B: Ruhig, dringend | ab 30 s, ungesehen | **Statisch.** Dicker Akzentrahmen (Platzhalter 10 px) und leichte Akzent-Tönung, Uhr läuft weiter |
| C: Erinnerung | nur die **älteste** ungesehene `needs_*`-Episode, alle 60 s | Puls aus 3 Atemzyklen (3,6 s), danach wieder B |
| D: Gesehen | nach Sprung, Prompt oder langem Druck | ruhig, **dünner** Rahmen (Platzhalter 2 px), Uhr läuft weiter, keine Animation |

Regeln: Höchstens 2 Tasten atmen gleichzeitig (die beiden ältesten ungesehenen), alle anderen zeigen B. `error`, `done_unseen`, `throttled`, `background` animieren nie. Eine neue Episode startet die Eskalation neu.

**Aufgabe an das Design: die Atemstufen definieren.**
- Der Renderer bekommt pro Bild einen Parameter `level` (0,35 bis 1; Kurve im Code: `0.35 + 0.65 * (0.5 - 0.5 * cos(2π · phase))`) und setzt damit die Deckkraft des **Akzents**. Text, Titel und Uhr bleiben bei voller Helligkeit.
- Vorschlag zur Prüfung: **4 diskrete Stufen** pro Periode (1,2 s bei 4 Bildern/s ergibt 4 bis 5 Bilder), z. B. 0,35 / 0,68 / 1,00 / 0,68. Bitte bestätigen oder eine bessere Kurve vorschlagen und ausdrücklich definieren, **welche Elemente** mit `level` dimmen (nur Rahmen? Rahmen + Tönung? das Zustandssymbol?).
- Der Verlauf muss die **WCAG-2.3.1-Grenze** (unter 3 Wechsel/s) halten und darf kein hartes Blinken sein.
- Bei Level 0,35 muss die Kachel noch lesbar und als "braucht mich" erkennbar bleiben (Symbol und Wort konstant hell).
- Phase B (statisch dick) und Phase D (statisch dünn) müssen sich im Standbild auch ohne Farbe klar unterscheiden.

## 5. Barrierefreiheit

- **Farbe nie allein:** Jeder Zustand trägt Farbe, **Symbol und Wort**. Zusätzlich sollen sich die Zustände über die **Rahmenstärke** (dick/normal/dünn) und eine eigene **Silhouette des Symbols** unterscheiden.
- **Rot/Grün entscheiden nie allein.** Platzhalterpalette ist Okabe-Ito (farbenblind-sicher): Blau `#0072B2`, Hellblau `#56B4E9`, Orange `#E69F00`, Vermillion `#D55E00`, Blaugrün `#009E73`, Rosa/Purpur `#CC79A7`.
- **Palettenoptionen bitte vergleichen** (Protanopie, Deuteranopie, Tritanopie simulieren):
  1. Okabe-Ito wie im Platzhalter,
  2. Okabe-Ito mit stärkerer Helligkeitsstaffelung (Zustände auch über Helligkeit trennbar),
  3. reduzierte Palette mit nur 4 bis 5 Farben, Unterscheidung vor allem über Form und Wort.
- Kritische Paare: `needs_permission` (Orange) und `error` (Vermillion); `done_unseen` (Blaugrün) und `working` (Blau); `needs_input` (Rosa) und `error`. Hier müssen Symbol und Wort sauber tragen.
- Bewegung: kein hartes Blinken, kein Flackern; Bewegung nur bei "braucht dich".
- Kontrast: siehe §2. Kleine Schrift (18 px entspricht 9 px auf dem Gerät) verlangt fette Gewichte und ausreichend Abstand.

## 6. Lieferformat (für Plan 6)

Damit der Renderer das ohne Raten übernehmen kann, bitte liefern:

1. **Pro Kacheltyp und Zustand ein SVG, 144 x 144**, nur Basiselemente (§2). Dateinamen in Anlehnung an den Snapshot-Satz: `slot-needs_permission.svg`, `slot-needs_input.svg`, `slot-error.svg`, `slot-done_unseen.svg`, `slot-throttled.svg`, `slot-working.svg`, `slot-background.svg`, `slot-idle.svg`, `slot-no_signal.svg`, `slot-empty.svg`, `slot-jumping.svg`, `inbox.svg`, `inbox-overflow.svg`, `inbox-empty.svg`, `limit-normal.svg`, `limit-amber-ahead.svg`, `limit-red.svg`, `limit-stale.svg`, `limit-login.svg`, `limit-empty.svg`, `extra-*.svg`, `status-ok.svg`, `status-alert.svg`.
   - Für Wartezustände zusätzlich die **Atemstufen** (mindestens 0,35 und 1,00) sowie Phase B und D als Standbild.
2. **Token-Liste** (Tabelle oder JSON): Farben (Grund, Text, gedämpft, Spur, je Zustandsfarbe, Limit-Stufen `neutral`/`amber`/`red`, Health-Farben `ok`/`stale`/`missing`/`off`), Schriftgrößen (alle verwendeten Stufen, nie unter 18), Gewichte, Strichstärken (Rahmen `thick`/`normal`/`thin`, Ring, Tempo-Markierung, Balken), Eckenradien, Abstände/Raster, Baselines der festen Zeilen.
3. **Textregeln:**
   - Zeilenzahl und Maximalbreite pro Textfeld, Ausrichtung (start/middle/end).
   - Kürzung: Zeichenzahl (Platzhalter: Titel 10 Zeichen pro Zeile, 2 Zeilen, Fußzeile 12, Inbox-Titel 10, Alert 11) **und** geforderte Pixelbreite. Auslassung mit `…`. Wörter länger als die Zeile werden hart gebrochen.
   - Reihenfolge der Kürzung bei Platznot (zuerst Detailzeile, dann Wartezeit, nie das Zustandswort).
   - Fallback bei leerem Titel (Platzhalter `–`).
4. **Dynamische Elemente** pro Kachel markieren, z. B. per `id`-Attribut oder Kommentar: Titelzeilen, Zustandswort, Symbol, Badge, Uhr, Detail, Hintergrund-Abzeichen, Rahmenstärke, Akzent-Deckkraft (`level`), Ringfüllung (`stroke-dasharray`), Tempo-Marke (Winkel), Balkenbreite, Prozentzahl, Reset-Text, Status-Zeilen.
5. **Text als echte `<text>`-Elemente**, **nicht** in Pfade umgewandelt, damit der Renderer Werte einsetzen kann. Symbole dürfen Pfade sein, wenn sie keinen variablen Text enthalten.
6. **Messbarkeit:** Alle Texte müssen mit `pnpm tiles:measure` in [10, 134] px bleiben. Bitte bei jedem Textfeld die erwartete Maximalbreite angeben.
7. **Vorschau:** Übersicht aller Kacheln bei 144 px und 72 px, idealerweise in der echten 5x3-Anordnung neben einem Spotify- und einem Elgato-Icon.

## 7. Offene Designfragen

1. **Symbolik:** Textzeichen (`! ? × ✓ ~ … ◑ ∅`) oder gezeichnete Pfad-Symbole? Eigene Silhouetten pro Zustand?
2. **Zustandsfarben:** Welche Palette (§5)? Reichen Okabe-Ito-Farben auf dem LCD, oder braucht es hellere Akzente für Tageslicht?
3. **Atmen:** Welche Elemente dimmen (nur Rahmen, Rahmen + Tönung)? Reichen 4 Stufen? Wie wirkt Level 0,35 neben ruhigen Nachbarkacheln?
4. **Phase B vs. D** (dick/dünn): Reicht die Rahmenstärke, oder braucht es ein weiteres Merkmal (Eckmarke, Symbolgröße)?
5. **Inbox-Durchschalten:** Wie zeigt die Kachel "Eintrag 2 von 3"? Wie unterscheidet sie sich optisch vom Slot?
6. **Hintergrund-Abzeichen** (`◑3`): Position und Größe, wenn `working` oder `done_unseen` zugleich Uhr und Detail zeigen. Was fällt bei Platznot zuerst weg?
7. **Herkunfts-Abzeichen** `APP`, `WIN`, `WSL`, `MAC`/`REM`, `?`: farbneutral. Eigenes Piktogramm oder Text? Lesbar bei 72 px?
8. **Titel:** 2 Zeilen mit ca. 10 Zeichen ist knapp. Besser Zeilenumbruch, Mittelkürzung ("Mobile…Northwind") oder andere Aufteilung (nie unter 18 px)?
9. **Leerer Slot** und "alles ruhig" in der Inbox: wie dezent, ohne wie ein Defekt auszusehen?
10. **Limit-Ring:** Ist die Tempo-Markierung auch ohne Farbe lesbar? Passt der "vor Plan"-Pfeil neben die Prozentzahl, oder ist er besser als Ringmerkmal?
11. **Status:** Wie wird `off` ("aus") klar von `missing` unterschieden? Reichen Wort und gedämpfte Farbe?
12. **Verhältnis zu den Nachbarn:** Gemeinsamer VibeTribe-Stil, der sich von Spotify/Elgato abhebt, oder bewusst unauffällig?
13. **Abgerundete Ecken** (`rx=18`): Passen sie zum Rand der Taste, oder besser eckig und randlos?
