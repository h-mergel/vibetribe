# VibeTribe – Leitfaden für KI-Agenten

## Projekt

- VibeTribe ist ein Stream-Deck-Plugin (MK.2), das alle Claude-Code-Sessions eines Entwicklers zeigt: Windows, WSL, Claude Desktop, Mac. Wer braucht mich, seit wann, ein Druck springt hin; dazu 5h-/Wochenlimit und Extra Usage.
- Spezifikation (bindend): `docs/superpowers/specs/2026-10-10-vibetribe-design.md`. Entscheidungen: `docs/adr/`.
- Stand: `packages/core`, `packages/render`, `packages/protocol`, `packages/reporter`, `packages/hub` und `packages/plugin` sind fertig (Anzeige, Quittieren, Limit neu laden; Plugin auf dem Stream Deck des Nutzers installiert). Plan 3d: Sprung zur Session (Desktop- und Remote-Link über `rundll32`) und Remote-Sessions (REM) aus der Session-Liste des Kontos (ADR 0006). Plan 6: Kacheln im Claude-Design (Handoff `docs/design/handoff-2026-10-13/`, Variante comfortable, compact per `VIBETRIBE_VARIANT`), Eskalation „neueste zuerst“, Budget-Wächter, Status tippen/halten. Plan 7: Abzeichen nach Host (WIN/WSL/REM), Sessions, die Aufmerksamkeit brauchen (Alarme und ungesehenes Done), verdrängen Ruhige aus den Slots, `+N` nur für sie ohne Slot (Done counts as attention, user decision 2026-10-14), Hintergrund-Jobs über Neustarts (`background.json`), Extra-Taste öffnet die Usage-Einstellungen. Plan 8: Remote-`review_ready` als Done, „Open…“ 2,5 s, Handler-Ursache im Log, `background.json` mit 30-s-Abstand und nur mit Listener. Plan 10: Ersatzport und Port-Datei für die Reporter, neuer Bind-Versuch alle 5 s, keine Handler-Prüfung beim Start. Plan 11: In Claude Desktop angepinnte Sessions behalten ihre Slots (laufend schlägt angepinnt, Gleichstand für die angepinnte, Alarme verdrängen zuerst Sessions ohne Pin), Property Inspector „Prefer pinned sessions“ an der Slot-Aktion (Standard an). Plan 12: Eine Session, die der Nutzer in Claude Desktop öffnet, gilt als gesehen wie nach einem Sprung (`lastFocusedAt` der Desktop-Session-Datei nach Beginn der Episode; war sie schon offen, bleibt Done bewusst stehen). Plan 13: `pnpm drift` prüft die undokumentierten Schnittstellen nur lesend (eine Zeile je Annahme, Exit 1 bei Drift), die Zentrale prüft ihren Teil stündlich und loggt nur Wechsel; `pnpm e2e:live` macht auf Wunsch einen echten Haiku-Durchgang gegen die laufende Zentrale. Plan 14: Marketplace-Fassung 1.0.0.0 – der Property Inspector jeder Aktion richtet die Hooks auf Klick ein (unter Windows mit einer Kopie von Stream Decks Node, in WSL über `wsl.exe` mit dem Linux-`node`), die Status-Taste zeigt bis dahin „Setup“, die WSL-Quelle folgt der Standard-Distribution, `pnpm plugin:pack` baut das Paket (ADR 0011). Mac-Agent (Plan 5) optional und später.
- Sprache der Doku: Deutsch; Kachel-Texte folgen dem Claude-Design-Handoff, daher sind Schlüsseltexte wie „Open…“ und „No link“ englisch. Code, Bezeichner und Code-Kommentare: Englisch.

## Umgebung (wichtig)

- Das Repo liegt in WSL: `/home/<user>/dev/projects/vibetribe`, unter Windows `\\wsl.localhost\Ubuntu\home\<user>\dev\projects\vibetribe`.
- Jeden Befehl (pnpm, node, git) **in WSL** ausführen, z. B. aus PowerShell: `wsl.exe -d Ubuntu --cd /home/<user>/dev/projects/vibetribe -- bash -lc '<befehl>'`. Nie pnpm/node unter Windows im Repo ausführen.
- Mehrzeilige Shell-Logik nicht in verschachtelte Anführungszeichen packen (wsl.exe verschluckt Quotes): als Skript-Datei schreiben und ausführen.
- Test-Filter immer vollständig quoten (`pnpm vitest run -t "…"`). Ein ungequotetes `>` legt leere Dateien im Repo an.

## Befehle

- `pnpm install` – Abhängigkeiten (pnpm 10, Node 24)
- `pnpm check` – Lint (Biome) + Typecheck (tsc strict) + Tests (vitest). Muss vor jedem Commit grün sein.
- `pnpm exec biome check --write .` – formatiert und sortiert Importe/Exporte; vor `pnpm check` ausführen.
- `CI= pnpm test …` – vitest schreibt neue Datei-Snapshots (`__snapshots__/*.svg`) nur, wenn `CI` leer ist. In CI fehlen Snapshots absichtlich → Snapshots immer committen. Geänderte Snapshots: `-u`, danach den Snapshot-Diff prüfen.
- `CI=true pnpm check` – exakt wie GitHub Actions.
- `pnpm gallery` – PNG-Galerie aller Kacheln in beiden Varianten nach `out/gallery/<comfortable|compact>/` (144 px und 72 px), Übersicht `out/gallery/index.html`.
- `pnpm --filter @vibetribe/reporter build` – bündelt den Reporter nach `packages/reporter/dist/reporter.mjs` (eine Datei, nur `node:`-Importe).
- `node packages/reporter/dist/reporter.mjs setup [--uninstall]` – trägt Hooks und Statusline-Weiche in `~/.claude/settings.json` ein bzw. entfernt sie (Backup, atomar). Reihenfolge: zuerst unter Windows (über den `\\wsl.localhost`-Pfad, legt den Token an), dann in WSL. **Nie ohne Zustimmung des Nutzers auf seinem echten Profil ausführen.**
- `pnpm hub:build` – bündelt die Zentrale nach `packages/hub/dist/hub.mjs`. Start unter Windows: `node \\wsl.localhost\Ubuntu\home\<user>\dev\projects\vibetribe\packages\hub\dist\hub.mjs` (liest echte Session-Dateien und Anmeldedaten – **nur mit Zustimmung des Nutzers**).
- `pnpm hub:simulate <scenario.jsonl> [--url …] [--token-file …]` – spielt ein Szenario (`packages/hub/fixtures/scenarios/`, Host `sim`) gegen eine laufende Zentrale; findet den Windows-Token aus WSL selbst. Läuft das Plugin auf einem Ersatzport, `--url http://127.0.0.1:<port>` angeben (Port in `%USERPROFILE%\.vibetribe\port`).
- Debug der Zentrale: `http://127.0.0.1:<port>/debug` und `/debug/state.json` (Port in `%USERPROFILE%\.vibetribe\port` bzw. in der Logzeile `hub listening on …`, meist 43710); Logs in `%APPDATA%\vibetribe\logs\hub.log`.
- `pnpm plugin:build` – bündelt das Plugin nach `packages/plugin/dev.h2k.vibetribe.sdPlugin/bin/plugin.js`.
- `pnpm plugin:pack` – baut das Plugin, prüft es mit `streamdeck validate` und packt es nach `dist/dev.h2k.vibetribe.streamDeckPlugin` (`packages/plugin/scripts/pack.sh`, auf einer Kopie unter `dist/stage`: `streamdeck pack` schreibt das Manifest des gepackten Ordners um); schreibt die Bilder für den Maker Console nach `dist/marketplace/` (Thumbnail und Galerie 1920×960, Icon 288×288, aus `imgs/plugin/marketplace.svg`). Schreibt nichts außerhalb des Repos. Hochladen macht der Nutzer.
- `pnpm plugin:deploy` – kopiert das Plugin nach `%APPDATA%\Elgato\StreamDeck\Plugins\dev.h2k.vibetribe.sdPlugin`. Danach die Stream-Deck-App **vollständig beenden und neu starten**: `streamdeck://plugins/restart/dev.h2k.vibetribe` wirkt ohne Entwicklermodus nicht (Probe Q3); erste Installation braucht ebenfalls einen Neustart. **Nie ohne Zustimmung des Nutzers auf seinem Stream Deck deployen.**
- `pnpm plugin:headless` – Zentrale + Deck ohne Stream Deck, Port 43799 (**nie 43710 oder ein Ersatzport**, beide verweigert es), Spiegel unter `/debug/keys`. Remote-Sessions ohne echte Schnittstelle: `VIBETRIBE_REMOTE_FIXTURE=packages/hub/fixtures/remote/sessions.json pnpm plugin:headless`. Tasten drücken über stdin: `press mk2:1:0` bzw. `long mk2:1:0` + Enter; Sprünge werden nur geloggt und erscheinen unter „Sprünge“ auf `/debug/keys`.
- `pnpm deck:render <scenario> --after <ms> [--tz <zone>] [--variant comfortable|compact]` – rendert den Deck-Zustand eines Szenarios nach `<ms>` (HTML nach `out/deck/<name>.html`); zeigt auch die Atem-Phasen.
- Debug des Plugins: `/debug/keys` (HTML) und `/debug/keys.json` (Spiegel der zuletzt angenommenen Bilder). Die Seite lädt jede Sekunde neu und kann das Atmen mit 4 Bildern/s nicht zeigen – dafür `deck:render --after`. Log: `%APPDATA%\vibetribe\logs\plugin.log`.
- Plugin und `hub.mjs` nie gleichzeitig (`hub.mjs` versucht nur den ersten Port, 43710, und beendet sich mit Exit 2, wenn er belegt ist). Umgebungsvariablen (`VIBETRIBE_MAX_FRAMES`, 1–100, Standard 10; `VIBETRIBE_VARIANT`, `comfortable` Standard oder `compact`; anderes fällt auf `comfortable`) erreichen das Plugin nur nach vollständigem Neustart der App (unter Windows z. B. `setx VIBETRIBE_VARIANT compact`).
- `pnpm profile:layout show <ProfilesV3>` bzw. `apply <ProfilesV3> <layout.json> [--write]` – ordnet Seite 1 des MK.2-Profils um und zieht fremde Tasten samt Bildern auf Seite 2 (Seiten findet es selbst; fremde Tasten bleiben Byte für Byte; Abbruch statt Verlust; ohne `--write` nur Vorschau; `--write` verweigert, solange `StreamDeck.exe` läuft, sichert beide Manifeste als `manifest.json.vibetribe-<time>.bak`, `--i-checked-streamdeck-is-closed` überstimmt nur „kann nicht prüfen“, nie eine laufende Stream-Deck-App, schreibt atomar Seite 2 vor Seite 1, liest zurück und stellt bei Fehlern wieder her). **Nur bei beendeter Stream-Deck-App, nach Sicherung von `%APPDATA%\Elgato\StreamDeck\ProfilesV3` und mit Zustimmung des Nutzers.**
- `pnpm tiles:measure` – misst jeden Kachel-Text und jedes Symbol beider Varianten mit resvg; schlägt fehl, wenn etwas den sicheren Bereich [10, 134] px verlässt, ein Text unter 18 px liegt oder sich zwei Elemente überlappen. Pflicht nach jeder Änderung an Kacheln, Wörtern oder Schriftgrößen (Skill `tile-check`).
- `pnpm drift` – prüft in WSL nur lesend und ohne Modellaufruf, ob die undokumentierten Schnittstellen noch so aussehen, wie der Code sie liest: Desktop-Ordner, Pins, Desktop-Session-Dateien, Session-Dateien unter Windows und WSL, Anmeldedaten, Session-Liste, Usage, Ports, Port-Datei, Zustand der laufenden Zentrale, Plugin-Ordner. Eine Zeile je Annahme (`ok`, `changed: …`, `skipped: …`), Exit 1 bei Drift; nie Titel, Ids, Inhalte oder Tokens. **Nach jedem Update von Claude Desktop, Claude Code, Windows oder WSL ausführen** und wann immer Pins, „gesehen“ oder Sprünge still nicht mehr wirken; ohne Rückfrage erlaubt.
- `pnpm e2e:live --spend-tokens` – echter End-to-End-Test, **kostet Tokens** (Haiku, ein Durchgang „ok“, höchstens 0,05 $ je Host): `claude -p` im Wegwerf-Ordner mit den installierten Hooks gegen die laufende Zentrale (Stream Deck muss laufen); prüft Haiku ohne API-Schlüssel (`init`-Nachricht), Hooks, Done auf dem Deck, Session-Datei und das Verschwinden am Ende über `/debug/state.json` und druckt die Kosten. **Nur nach ausdrücklicher Zustimmung des Nutzers**, nie in `pnpm check` oder CI (ohne `--spend-tokens` und mit gesetztem `CI` verweigert es mit Exit 2). Wird ein Lauf abgebrochen, bevor `claude` endet, bleibt seine Session auf dem Deck, bis die Zentrale sie als beendet entfernt. Unter Windows über `claude.exe`, in WSL nur, wenn dort ein `claude` im `PATH` liegt.

## Architektur (Spec §3.1 – nicht verhandelbar)

- **Ports & Adapters.** `packages/core` ist die Domäne: kein I/O, kein `Date.now()` (Zeit als Parameter), keine Laufzeit-Abhängigkeiten, keine Stream-Deck-/HTTP-/Dateisystem-Bezüge.
- Abhängigkeiten zeigen nur nach innen: `plugin → render → core`. Der Reporter ist eigenständig, nur `@vibetribe/reporter/setup` darf das Plugin einbinden (`plugin → reporter`, ADR 0011); das Event-Format (Spec §8.3) und die Port-Datei (§8.2) sind die einzigen gemeinsamen Verträge (`packages/protocol`).
- Externes (HTTP, Session-Dateien, Usage-Endpunkt, Sprungziele, Deck) ist ein Adapter hinter einem schmalen Interface, das der Nutzer definiert. Eine Composition Root verdrahtet per Konstruktor-Injektion. Keine Singletons, kein DI-Framework.
- Eine Verantwortung pro Datei (Richtwert < 300 Zeilen). Keine Vererbung zur Wiederverwendung.
- KISS/YAGNI: keine Frameworks, wo die Standardbibliothek reicht; keine spekulativen Erweiterungspunkte; neue Abhängigkeiten nur mit Begründung im Commit.
- Externe Eingaben am Adapter validieren und in Typen übersetzen; Adapter werfen nicht in `core` hinein, Fehler werden Gesundheitszustand + Log.
- TypeScript strict, `verbatimModuleSyntax` (`import type`), keine `enum`s, keine Parameter-Properties, private Felder als `#feld`.
- Verträge, die Konsumenten einhalten müssen, stehen als Doc-Kommentar am Code (z. B. `InboxCycler.settle`, `SessionStore.applySnapshot` nur mit vollständiger Liste, `FrameScheduler`-`send` wirft nie).

## Arbeitsweise

- TDD für jede Verhaltensänderung: Test schreiben, **fehlschlagen sehen**, implementieren, grün sehen.
- Conventional Commits (`feat(core): …`, `fix(render): …`, `test: …`, `docs: …`, `ci: …`, `chore: …`).
- Neue Features: Brainstorming → Spec → Plan (`docs/superpowers/`), ausgeführt mit `superpowers:subagent-driven-development` oder `superpowers:executing-plans`. Specs und Pläne bekommen vor der Ausführung ein Review durch das stärkste Modell.
- Architekturentscheidungen als ADR in `docs/adr/` (MADR kurz, fortlaufend nummeriert, nie umschreiben).
- Externe Abhängigkeit: die `superpowers:*`-Skills kommen aus dem Plugin `superpowers@claude-plugins-official` (User-Scope, pro Maschine).

## Agents und Skills

| Aufgabe | Agent / Skill |
|---|---|
| Plan-Task oder Änderung umsetzen (TS in `packages/`) | Agent `vibetribe-dev` |
| Diff eines Tasks oder Branches reviewen | Agent `vibetribe-reviewer` |
| Kachel, Kachel-Text, Schriftgröße oder Wort geändert | Skill `tile-check` |
| Codebasis erkunden | eingebauter Agent `Explore` |

Skills liegen direkt in `.claude/skills/` (kein Symlink: das Windows-`claude` kann Linux-Symlinks über `\\wsl.localhost` nicht auflösen).

## Code-Review-Regeln

Ein Review prüft in dieser Reihenfolge und belegt jeden Befund mit `datei:zeile`:

1. **Spec-Treue:** Erfüllt der Diff die Anforderung, nichts fehlt, nichts Überflüssiges?
2. **Architektur:** §3.1 eingehalten (core ohne I/O, Richtung nach innen, eine Verantwortung, keine Spekulation)?
3. **Tests:** Prüfen sie echtes Verhalten? Würde der Test fehlschlagen, wenn die geprüfte Zeile fehlte? Grenzfälle (Uhrsprünge, Duplikate, Reihenfolge, leere/ungültige Eingaben) abgedeckt?
4. **Kacheln:** `pnpm tiles:measure` grün, Mindestschrift 18 px, keine Filter, keine Webfonts, alle Texte escaped.
5. **Fail-open:** Nichts, was Claude Code blockieren oder verlangsamen kann (Reporter immer Exit 0, keine stdout-Ausgabe in Hooks).

Schweregrade: Critical (falsch, Absturz, Datenverlust, Sicherheit) / Important (Anforderung verfehlt, fragiles Verhalten, Test beweist nichts, Wartbarkeitsschaden) / Minor (Polish, breitere Tests).

## Fallstricke (aus Plan 2 gelernt)

- Zeichenbasierte Kürzung garantiert keine Breite: nach jeder Text-Änderung `pnpm tiles:measure`.
- Steuerzeichen in Titeln brechen SVG/resvg – Texte nur über `text()`/`escapeXml` in die Kachel.
- `@vibetribe/render` lädt resvg nicht: PNG/Messung nur über den Subpath `@vibetribe/render/png`.
- Session-Ende ist kein Ende für späte Events: Store-Tombstones (60 s) nicht umgehen.

## Fallstricke (aus Plan 3c gelernt)

- Das esbuild-Bundle für das SDK braucht den `createRequire`-Banner (`ws` ist CommonJS).
- Die SDK-Datei `actions.ts` nie in Tests importieren.
- Slot-Nummern bleiben ihren Tasten reserviert, auch während sie verborgen sind. Eine Slot-Taste, die länger als 60 s verborgen ist (gelöscht, lange auf einer anderen Seite), gibt Nummer und Session frei; die nächste neue Slot-Taste übernimmt die kleinste freie Nummer.

## Fallstricke (aus Plan 3d gelernt)

- Sprung-Links gehen nur über `jumpUrlFor` und den Port `JumpOpener` an das System; `createRundll32Opener` in Tests nur mit Fake-`spawn` (sonst öffnet sich Claude Desktop). `rundll32.exe` startet über den absoluten Pfad unter `%SystemRoot%\System32`, nie über den Suchpfad; im Headless-Modus und in Tests wird es nie gestartet.
- `/v1/code/sessions` ist undokumentiert: Der Parser ist tolerant; eine Schema-Änderung zeigt sich als Fehler „unexpected response“ der Quelle `sessions:remote` (Status-Taste REM fehlt), nicht als leere Liste.
- Die API liefert Ids als `cse_<X>`, lokale Dateien tragen `session_<X>`: Der Remote-Client normalisiert auf `session_<X>`; Abgleich, Sprunglink und Fixture-Tests beruhen darauf (Probe J2c).
- Neuer Durchgang (Done) einer Remote-Session nur nach beobachteter Nicht-Untätigkeit oder `unread` `false` → `true`; ein bloßes Weiterrücken von `last_event_at` zählt nicht.
- `HostKind` ist `windows | wsl | remote`; `mac` gibt es nur noch als `OsKind` im Protokoll (`hostKindOf`).
- Token-Erneuerung nur über `claude -p /cost` (`REFRESH_ARGS` in `packages/hub/src/usage/refresh.ts`), nie über einen Modellaufruf; jeder Versuch loggt `token refresh: ok` oder `token refresh: no change`.
- Cloud-Sessions: `REMOTE_ENVIRONMENT_KINDS` in `packages/hub/src/remote/api.ts` (Standard `["bridge"]`, `"all"` zeigt alle Arten).
- Ein Sprung `opened` beweist nicht, dass Desktop vorne ist (Vordergrund-Sperre). Eine Handler-Prüfung beim Start gibt es seit Plan 10 nicht mehr (siehe Fallstricke Plan 10).

## Fallstricke (aus Plan 6 gelernt)

- `packages/render` ist ein Port des Referenz-Renderers aus `docs/design/handoff-2026-10-13/`; `reference.test.ts` vergleicht byte-genau mit `reference/<luftig|dicht>/` (Handoff v2), einzige Ausnahme die Rahmen-Geometrie (R12, siehe unten). Der Handoff ist externes Material und behält seine Namen: Handoff `luftig` = Variante `comfortable`, `dicht` = `compact` (Tabelle `HANDOFF_FOLDER` in `reference.test.ts`). Eine gewollte Design-Änderung kommt als neuer Handoff aus Claude Design, nie durch Anpassen der Referenz-SVGs.
- `textWidth` rechnet mit Advance-Breiten (`adv.json`) je UTF-16-Codeeinheit, ohne Kerning, unbekannte Zeichen 0,62 em. Titel laufen im Modell durch `tileTitle` (Schriften ohne DejaVu-Glyphen fallen weg, Ordnername als Ersatz).
- Die Uhr einer atmenden Taste nur über `breathStepStart` lesen, sonst kostet jede neue Sekunde ein Extrabild.
- Status-Taste: tippen klappt 5 s auf, halten öffnet `/debug`. Inbox halten quittiert alle `done_unseen`.
- **Sandbox der Claude-App:** Claudes PowerShell-Werkzeug läuft im Windows-Paket-Container; neue Dateien unter `%APPDATA%` landen in `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\…`, nicht im echten Ordner. Dateien am echten Profil oder unter `%APPDATA%` (Sicherungen, Rückweg, Vergleiche) deshalb nur aus WSL über `/mnt/c/Users/<user>/AppData/Roaming/…` schreiben; PowerShell nur für Prozesse (`Get-Process`, `Stop-Process`, `Start-Process`), Logs und HTTP.

## Fallstricke (aus Plan 7 gelernt)

- Das Abzeichen folgt nur `hostKind` (`badgeOf`). `entrypoint` und `hostSessionId` wählen allein den Sprunglink (`jumpUrlFor`). `APP` und `?` kommen in `core` nicht mehr vor, nur in den festen Handoff-Beispielen (`OriginBadge` in `render`).
- „Braucht Aufmerksamkeit“ ist genau `needsAttention`: `needs_permission`, `needs_input`, `error` oder `done_unseen`, jeweils ungesehen. Done counts as attention (user decision 2026-10-14; ersetzt die frühere Regel „ohne `done_unseen`“).
  - Dieselbe Regel steuert das Verdrängen (`SlotTable.promote`, Haltezeit `ATTENTION_HOLD_MS`, 30 s) und das `+N` der Inbox; beides nie getrennt ändern.
  - Die Inbox-Zahl selbst bleibt `isWaiting`.
  - Ein ungesehenes `done_unseen` bekommt einen dicken, ruhigen Rahmen mit Tönung in der Done-Farbe (`frameWeight`, wie Handoff v2), atmet aber nie (R11: `animatedIds` nennt es nicht).
- Rahmen-Einzug (R12, bewusste Abweichung vom Handoff): Die Gehäusekante verdeckt die äußeren Pixel, daher liegt die Außenkante jedes `vt-frame` bei 2 px (`frame` in `render/src/shared.ts`); compact zeichnet den dicken Rahmen 7 statt 8 px breit, damit seine Innenkante bei 9 px bleibt. `reference.test.ts` blendet nur die Geometrie von `vt-frame` aus, alles andere bleibt byte-genau; `frameInset.test.ts` prüft den Einzug.
- Comfortable: reguläre Texte (400) bekommen `stroke-text` (0,7 px Kontur in eigener Farbe); dafür gehen alle Texte der Variante durch das lokale `text` in `comfortable.ts`, die geteilte Limit-Kachel über `limit(m, STROKE.text)`.
- `SlotTable.sync` füllt nur freie Slots; `promote` verdrängt. Das Deck ruft `promote` nur in `update`/`tick`, nie in `keyAppeared`.
- Ein Slot-Druck nimmt die Session aus `#sent[…].session` (zuletzt angenommenes Bild), nie `idAt()`. Tests, die einen Slot drücken, müssen vorher einmal `tick` laufen lassen.
- Hintergrund-Jobs stehen in `%APPDATA%\vibetribe\background.json` (nur Ids und Arten; noch nicht wiederhergestellte Einträge behalten ihren ursprünglichen `savedAt` und verfallen nach 6 h). Tests und Headless-Modus schreiben die Datei nie; nur `windowsHubConfig` verdrahtet sie.
- `hub.mjs` liest und schreibt `background.json` ebenfalls. Nur aus einer Shell außerhalb der Claude-Sandbox starten, sonst landen seine Schreibzugriffe im Paket-Container und die beiden Kopien laufen auseinander.
- Web-Seiten öffnet das Plugin nur über `openWebPage` (`packages/plugin/src/web.ts`) mit exakt erlaubten URLs (`isAllowedWebUrl`); `isJumpUrl` bleibt für `claude://`-Links.

## Fallstricke (aus Plan 8 gelernt)

- Remote-Durchgänge: `review_ready` (Bucket oder Kategorie) ist fertig wie `completed` (`DONE_VALUES` in `remote/api.ts`). `need_input` gewinnt davor: Eine Frage am Ende eines Durchgangs ist Input, aber nur bis der Durchgang gelesen ist (`unread = false` bei ruhendem Worker → `idle`, danach gesehen; Nutzerregel 2026-10-16).
- `FLASH_MS.jumping` (2,5 s) folgt der Zeit, die Claude Desktop zum Anzeigen braucht. Die Dauer kostet keine Bilder; der Flash bleibt an die gedrückte Session gebunden (`PressFeedback`).
- `createRegQuery` und `regFailure` sind mit der Handler-Prüfung entfallen (Plan 10).
- Nach jedem Plugin-Neustart meldet sich jeder ungelesene fertige REM-Durchgang (`completed`, `review_ready`) einmal als Done (R9); das ist kein Fehler.
- `keepBackgrounds`: nach einem Fehlschlag höchstens alle `BACKGROUND_RETRY_MS` (30 s) ein neuer Versuch; `canSave` sperrt das Schreiben. `startHub` gibt nur „Listener läuft und nicht gestoppt“ frei.
- Lokal vor remote: Die Bridge-Ids lokaler Sessions führt `LocalBridges` (`remote/local-bridges.ts`), nicht mehr `hub.ts`.

## Fallstricke (aus Plan 10 gelernt)

- WSL (Mirrored-Netzwerk) reserviert mit jedem Start einen wandernden Block von 4096 Ports auch unter Windows, unsichtbar für `netstat`. 43710 kann darin liegen. Dann bindet das Plugin den ersten freien Ersatzport aus `FALLBACK_PORTS` (`hub/src/compose.ts`) und versucht es sonst alle `BIND_RETRY_MS` (5 s) erneut (`hub/src/http/listener.ts`).
- Tests binden nie feste Ports: Port 0 oder ein Port, den der Test selbst hält (`block()` in `listener.test.ts`, `freePort()` in `plugin/test/helpers.ts`). Ein fester Port kann im WSL-Block liegen.
- Die Wache `test/real-ports-guard.mjs` (vitest `setupFiles`) lässt keinen Test und keinen gestarteten Node-Prozess 43710 oder einen Ersatzport erreichen oder binden; landet ein `listen` auf Port 0 zufällig auf einem davon, bindet sie neu. Sie reist über `NODE_OPTIONS` mit. Wer `NODE_OPTIONS` für einen Kindprozess setzt, hängt an, statt zu ersetzen. Ändert sich `FALLBACK_PORTS`, muss `GUARDED_PORTS` mit (ein Test vergleicht beide).
- `RunningHub.port` ist `null`, solange kein Port gebunden ist (auch nach `close()`; ein geschlossener `Listener` versucht keine Ports mehr); `open_debug` öffnet nur mit Port. Die Gesundheit `ingress` (Port-Fehler, fehlender Token) setzt nur der `Listener`, nie die Composition des Plugins: Sonst löschte ein späteres Binden den Token-Hinweis.
- Der Reporter liest die Port-Datei bei jedem Aufruf neben dem Token (`hubUrlOf`). Ein `hubUrl` in `config.json` gewinnt; `http://127.0.0.1:43710` aus früheren Setups zählt nicht.
- Die Hooks starten die Kopie `~/.vibetribe/reporter.mjs` (je Host), nicht `dist/`. Eine Änderung am Reporter wirkt erst, wenn diese Kopie ersetzt ist (Setup oder atomares Kopieren, nur mit Zustimmung).
- Claude Desktop ist ein MSIX-Paket: `reg.exe` fand `HKCR\claude` nur, wenn Stream Deck aus WSL heraus (über Claudes Werkzeug) startete, nie beim Start durch den Nutzer. Registry-Prüfungen beim Start sagen deshalb nichts über den echten Start.

## Fallstricke (aus Plan 11 gelernt)

- Die Pins sind interner Zustand von Claude Desktop: `claude_desktop_config.json`, `preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder`, Einträge `code:local_<uuid>`; unter `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\` (seit Oktober 2026, davor im MSIX-Paket unter `LocalCache\Roaming\Claude\`). Desktop kann den Ort mit einem Update wechseln: dann zeigt `/debug` keine Pins mehr. Nur lesen (ADR 0008). Tests nur mit temporären Pfaden (`desktopConfigFiles(desktopDirs(env, home))`, `readDesktopPins` mit Fake-`read`), nie das echte Profil; der Smoke-Test des Bundles setzt `LOCALAPPDATA` auf sein Scratch-Verzeichnis.
- Pins wirken nur über `hostSessionId` aus der Session-Datei. Angepinnte Remote-Sessions (`session_…`) liegen im IndexedDB der claude.ai-Seite (LevelDB) und werden nicht gelesen.
- `SlotTable.promote(views, now, canAssign, pins)` ist ohne Pins genau die Verdrängung durch Aufmerksamkeit; `sync` kennt keine Pins. Die Regeln (laufend = alles außer `idle`/`no_signal`) stehen in Spec §6.3; nie getrennt von dort ändern.
- „Prefer pinned sessions“ aus oder noch nicht gelesen: Die Composition des Plugins gibt dem Deck einen Zustand ohne Pins (`setPreferPinned`; bis zum ersten Aufruf `null`). `HubState.pins` und die Spalte „Pin“ auf `/debug` zeigen sie trotzdem. `readDesktopPins` liefert `null` für „gerade unlesbar“ (die letzten Pins bleiben) und `[]` für „keine Datei oder andere Form“; beides nie verwechseln.
- Der Property Inspector ist eine Datei, `ui/slot.html`, ohne Bibliothek; Biome prüft auch sein Skript (deshalb `window.connectElgatoStreamDeckSocket = …`). Der Standard „an“ steht zweimal: `PREFER_PINNED_DEFAULT` und `settings[KEY] !== false` in der Seite (`manifest.test.ts` prüft die Seite, `settings.test.ts` die Konstante).
- `deploy.sh` kopiert nur, was in `FILES` steht (`bin imgs ui manifest.json`); ein neuer Ordner im `.sdPlugin` gehört dort hinein.

## Fallstricke (aus Plan 12 gelernt)

- „Gesehen in Desktop“ liest `lastFocusedAt` aus `claude-code-sessions\<ws>\<acct>\local_<uuid>.json` (ADR 0009), nur lesend, nur die Dateien wartender Desktop-Sessions (`DesktopFocus`, Pfade aus einem Scan, neu nur bei unbekannter Id). Nie alle Dateien je Takt lesen: zusammen 7,9 MB, einzelne bis 249 KB.
- Eine Schleife für Desktops Zustand: `pollDesktop` in `hub/src/desktop-poll.ts` (Pins und Fokus, `DESKTOP_POLL_MS`, früher `PINS_POLL_MS` in `runtime.ts`). Keine zweite Schleife für Desktop anlegen.
- Die Regel ist `episodeSince < lastFocusedAt ≤ now`, verglichen nach dem Lesen, gesehen über `Hub.markSeen`. Eine schon offene Session bekommt kein neues `lastFocusedAt`: Ihr Done bleibt (Nutzerentscheidung 2026-10-16); keine Heuristik „Desktop ist vorne“ ergänzen.
- Öffnen per Link setzt `lastFocusedAt` etwa 2 s später. Die eigenen Inbox-Sprünge filtert das Plugin heraus (`InboxOpens` in `plugin/src/jump/inbox-opens.ts`, Fenster `CYCLE_WINDOW_MS`), sonst gälten beim Durchblättern alle übersprungenen Sessions als gesehen. Wer `jump()` oder die Inbox ändert, prüft `compose-jump.test.ts` „cycling the inbox through Claude Desktop …“.
- Tests nur mit Fake-`DirPort` bzw. temporären Pfaden (`windowsHubConfig` mit `home`/`env`), nie das echte Profil. `scan` in `hub/test/background-fixtures.ts` nimmt jede Session-Liste (z. B. mit `hostSessionId`).

## Fallstricke (aus Plan 13 gelernt)

- Formatwissen steht nur einmal: Die Prüfungen in `hub/src/doctor/` rufen die Parser und Mapper der Produktion (`pinnedOrderOf`/`pinnedIds`, `firstDesktopConfig`, `scanDesktopSessions`, `parseLastFocusedAt`, `parseSessionFile`, `isSameProcess`, `remoteValuesOf`, `isShownRemote`, `mapUsageResponse`, `fetchRemoteSessions`, `fetchUsage`, `desktopDirs`). Wer ein Format anpasst, ändert den Parser; neue Werte der Remote-Liste gehören nach `KNOWN_REMOTE_VALUES` (`remote/api.ts`), sonst meldet `pnpm drift` sie als `changed`.
- Die Zentrale prüft stündlich nur `desktop folder`, `desktop pins`, `desktop session files` und `port file` (`HubConfig.drift`) und loggt nur Wechsel (`drift: …`, `drift resolved: …`); `skipped` ändert nichts. Neue Prüfungen dort brauchen weder Tokens noch WSL.
- Die Usage-Abfrage von `pnpm drift` zählt beim Endpunkt mit: Kurz nach einer Abfrage der Zentrale kann sie deren nächste Abfrage in den 429-Backoff schieben (die Limit-Kacheln zeigen dann bis zu 30 min `As of …`). `pnpm drift` nicht in einer Schleife laufen lassen.
- Modellaufrufe gibt es nur in `pnpm e2e:live --spend-tokens` (ADR 0010), mit Haiku und nur auf Wunsch des Nutzers; nie in Tests, CI, Zentrale oder Plugin. `--bare` würde die Hooks abschalten und den Test wertlos machen.
- Die Session-Prüfung zählt nur Dateien laufender pids und Felder nur an lebenden Prozessen: In WSL liegen hunderte alte `<pid>.json` (2026-10-17: 652, davon 3 lebend), alte Desktop-Sessions darunter ohne `hostSessionId`. Eine nicht lesbare Prozessliste von Windows macht nur `session files (Windows)` zu `skipped`.
- Die Prüfung der Remote-Liste meldet auch `no usable id` und `no string connection_status/status/environment_kind`, mit derselben Auswahl (`isShownRemote`) wie der Mapper.
- Was Seiteneffekte braucht (Link öffnen → `lastFocusedAt`, `claude://`-Handler, Property Inspector, Kacheln am Gerät, Token-Erneuerung), bleibt eine Prüfung von Hand; Liste in Spec §11.3.

## Fallstricke (aus Plan 14 gelernt)

- Nur ein Klick im Property Inspector ändert `~/.claude/settings.json` (`SetupController.handle`). Start, `refresh` und das Öffnen der Seite lesen nur (`setupState`). Token und Port-Datei in `%USERPROFILE%\.vibetribe` schreibt das Plugin beim Start selbst.
- Die Windows-Hooks laufen mit `%USERPROFILE%\.vibetribe\node-<version>.exe`, einer Kopie von Stream Decks Node (dessen Ordner `%APPDATA%\Elgato\StreamDeck\NodeJS\<version>` wechselt mit App-Updates). Eine vorhandene Kopie wird nie überschrieben: Windows sperrt sie, solange Claude Code einen Hook ausführt. Andere Kopien löscht die Einrichtung erst nach dem Schreiben von `settings.json` (die Kopie der bisherigen Einstellungen bleibt, laufende Sessions nutzen sie noch; nach einem Update gibt es bis zum nächsten Update also bis zu zwei), Fehler beim Löschen zählen nicht.
- Das Plugin liest nie seinen eigenen Ordner und nie `manifest.json` (DRM; Test „DRM“ in `manifest.test.ts`, auch über das Bundle). Der Reporter steckt als Text in `bin/plugin.js` (`__REPORTER_SOURCE__`, im Speicher gebaut mit `reporterBuild` aus `packages/reporter/build.mjs`, nie über `reporter/dist`, das die Tests des Reporters gleichzeitig schreiben); eine Änderung am Reporter zeigt bei Nutzern „Setup“, bis sie „Update hooks“ klicken. Den Logger des SDK nach `<Plugin>/logs` lässt der Code, wie er ist (ADR 0011).
- `wsl.exe` verschluckt Backslashes in Argumenten: Windows-Pfade gehen mit Schrägstrichen hinein (`wslSetupArgs`). Es antwortet in UTF-16 (mit `WSL_UTF8=1` in UTF-8, `decodeWslOutput`) und schreibt eigene Fehler nach stdout. Die Standard-Distribution kommt aus `wsl.exe -l -v` (Zeile `*`, `docker-desktop…` zählt nicht); gesucht wird nie vor `streamDeck.connect()`, sondern im Hintergrund (`SetupController`), und die WSL-Quelle kommt über `RunningHub.addSource` dazu. `VIBETRIBE_WSL_DISTRO=none` schaltet WSL ohne `wsl.exe` ab (Smoke-Test). Tests rufen `wsl.exe` nie.
- Die Einrichtung in WSL braucht Node.js 20 oder neuer im Login-`PATH` (`sh -lc` liest `~/.profile`, nicht `~/.bashrc`). Exit 127 = kein `node`, Exit 4 = zu alt. Der Reporter wird für Node 20 gebaut (`target` in `packages/reporter/build.mjs`); wer das Ziel hebt, hebt `WSL_MIN_NODE` mit.
- `pnpm plugin:pack` schreibt nur nach `dist/` (git-ignoriert) und packt eine Kopie unter `dist/stage`, weil `streamdeck pack` das Manifest des gepackten Ordners umschreibt; hochladen macht der Nutzer im Maker Console. Jede neue Fassung braucht eine höhere `Version` im Manifest.
