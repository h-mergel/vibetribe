# VibeTribe – Faktenblatt für die README

Stand: main `deb4529`. Quelle der Wahrheit ist der Code; Abweichungen der Doku stehen unter „Widersprüche“. Kachel-Texte sind englisch (Claude-Design-Handoff), Doku deutsch.

## 1. Was es ist

- VibeTribe ist ein Stream-Deck-Plugin (Elgato MK.2, 15 Tasten), das alle Claude-Code-Sessions eines Entwicklers auf einem Deck zeigt: lokal unter Windows, in WSL, im Code-Tab von Claude Desktop und Remote-Control-Sessions auf anderen Rechnern. Dazu 5h-Limit, Wochenlimit und Extra Usage.
- Kernwert: **Wer braucht mich, seit wann, ein Druck springt hin.** Jede Kachel zeigt Zustand, Wartezeit und Herkunft; ein Tastendruck öffnet die Session in Claude Desktop.
- Das Plugin ist selbst die Zentrale (Hub im Plugin-Prozess, `127.0.0.1`, Port 43710 oder ein Ersatzport); kein separater Dienst nötig.
- Status: in Entwicklung, läuft auf dem Gerät des Autors; Autor/Namespace `h2k.dev`, Plugin-UUID `dev.h2k.vibetribe`, Version `1.0.0.0` (erste Marketplace-Fassung, kostenlos).

## 2. Funktionen für Nutzer

**Quellen**
- Windows: Session-Dateien unter `%USERPROFILE%\.claude\sessions` plus Hooks. Abzeichen `WIN`.
- WSL: Session-Dateien über `\\wsl.localhost\<Distro>` (die Standard-Distribution aus `wsl.exe -l -v`, sonst `VIBETRIBE_WSL_DISTRO`; ohne WSL keine WSL-Quelle) plus Hooks aus WSL. Abzeichen `WSL`.
- Claude Desktop: Sessions aus dem Code-Tab erscheinen je nach Host als `WIN` oder `WSL` (das Abzeichen sagt, wo die Session läuft, nicht wie sie gestartet wurde).
- Remote Control auf anderen Rechnern: Abfrage der Session-Liste des Kontos alle 20 s (nur `environment_kind = bridge`), Abzeichen `REM`. Gröber als Hooks: kein Tool-Name, keine Unterscheidung Freigabe/Frage, keine Hintergrund-Jobs, bis 20 s Verzögerung.
- Remote-Session ohne Signal: nach 90 s `Offline`, nach 210 s entfernt.

**Zustände (Rangfolge, dringendster zuerst)**
- `Approve` (needs_permission), `Input` (needs_input), `Error`, `Done` (ungesehen), `Limited` (Rate Limit / Overloaded), `Working` (Tool-/Subagent-Detail, wandernder Punkt alle 2 s), `n jobs` (Hintergrund), `Idle`, `Offline`.
- Jede Slot-Kachel: Symbol und Wort des Zustands, Titel, Wartezeit (`42 s`, `3 min`, `1:05 h`, `12 h`), Abzeichen `WIN`/`WSL`/`REM` unten rechts. Gefülltes Symbol = ungesehen, Kontur = gesehen.
- Fehlerdetails kurz: `Server`, `Billing`, `Rate limit`, `Overloaded`.

**Aufmerksamkeit**
- Sessions, die Aufmerksamkeit brauchen (ungesehen: Approve, Input, Error, Done), bekommen dicken Rahmen mit Tönung und verdrängen ruhige Sessions aus den Slots (Haltezeit 30 s gegen Flattern).
- Atmen (nur Approve/Input, ungesehen): Periode 1,2 s, 4 Bilder/s, Stufen 35/68/100/68 %. Maximal 2 atmende Tasten; neueste Anfragen (erste 30 s) zuerst, danach Erinnerungs-Puls der ältesten (alle 60 s, 3 Perioden). Done atmet nie.
- Inbox-Taste: Zahl der wartenden Sessions plus Symbol/Wort/Wartezeit der dringendsten; `+N` = Sessions mit Aufmerksamkeit, die keinen sichtbaren Slot haben.
- Inbox kurz drücken: springt zur dringendsten, jeder weitere Druck innerhalb 5 s zur nächsten (Anzeige `index/total`). Inbox lang (≥ 600 ms): alle ungesehenen `Done` quittieren.
- Slot lang drücken: Session als gesehen quittieren, ohne Sprung.
- Session direkt in Claude Desktop öffnen (anklicken, ohne Deck): gilt nach höchstens 5 s ebenfalls als gesehen, für jede wartende Session mit Desktop-Id (Windows und WSL). War sie schon offen, als ihr Durchgang endete, bleibt Done stehen, bis du über das Deck springst, eine andere Session und zurück anklickst, in der Session schreibst oder ihren Slot lang drückst. Durchblättern mit der Inbox zählt dabei nicht: Gesehen ist nur die Session, auf der du landest.
- Slots sind stabil: Session behält ihren Slot, solange sie lebt; neue nehmen den ersten freien.
- In Claude Desktop angepinnte Sessions (Windows und WSL) behalten ihre Slots: Alarme verdrängen zuerst Sessions ohne Pin; eine angepinnte Session ohne Slot nimmt den Slot einer Session ohne Pin, außer sie ruht und die andere läuft. Abschaltbar im Property Inspector der Aktion „Session slot“ („Prefer pinned sessions“, Standard an, gilt für alle Slots, wirkt sofort). Angepinnte Remote-Sessions zählen nicht.

**Sprung**
- Slot kurz drücken: öffnet die Session in Claude Desktop (`claude://claude.ai/epitaxy/local_…` bzw. `claude://claude.ai/code/session_…`), Taste zeigt 1 s `Open…`. Sessions ohne Link (z. B. CLI im Terminal): 2 s `No link`. Wartende Session gilt danach als gesehen.
- Start über `rundll32` mit streng geprüftem Link; Plugin sieht nicht, ob Desktop wirklich nach vorne kommt.

**Limits**
- 5h- und Wochen-Kachel: Verbrauch in %, Balken, Tempo-Markierung („amber ahead“), Reset-Zeit (`3d 4h`), Notizen `Sign in`, `No data`, `New window`, `As of HH:MM` (Daten > 15 min alt). Kurz drücken lädt neu (höchstens alle 120 s). Abfrage alle 5 min, Backoff bis 30 min.
- Extra-Usage-Kachel: verbrauchter Betrag und Anteil am Monatslimit; ohne Limit `No limit`. Inaktiv mit Grund: `No credit` (out_of_credits), `Limit hit` (Ausgabenlimit erreicht), `Disabled` (vom Nutzer abgeschaltet), `Inactive` (sonst); Vorrang in dieser Reihenfolge: Disabled > Limit hit > No credit. Daten > 10 min alt: `As of HH:MM`.
- Extra-Taste (kurz): öffnet `https://claude.ai/settings/usage` im Browser; lang: nichts.

**Status-Kachel**
- Ruhig `Sources ok`, sonst nur Störungen. Quellen: `WIN`, `WSL`, `REM`, `LIM`; Zustände ok/stale/down/off. Alarme: `Port in use`, `Setup` (Hooks fehlen oder sind veraltet), `No token` (Token-Datei fehlt), `Error`.
- Tippen: alle vier Quellen 5 s lang. Halten: öffnet die Debug-Seite `http://127.0.0.1:<port>/debug` im Browser.

**Hintergrund-Jobs**
- Laufende Hintergrund-Jobs (Shell, Subagent) einer Session zeigt `n jobs` bzw. ein `◑n`-Abzeichen. Sie überleben einen Plugin-Neustart (`%APPDATA%\vibetribe\background.json`, nur Ids und Arten, Wiederherstellung bis 6 h; danach `?` nach 30 min ohne Bestätigung).

**Varianten**
- `comfortable` (Standard): größere, kräftigere Schrift (Zustandswort 20 px, Titel 22→20→18 px), Wartezeit der nächsten Session auf der Inbox. `compact`: kompakter. Umschalten per `VIBETRIBE_VARIANT`.
- Alle Texte mindestens 18 px, Sicherheitsrand [10, 134] px; Palette Okabe-Ito, auf LCD angepasst.

## 3. Tastenbelegung

- Das Plugin legt keine feste Belegung fest: Slots sind alle platzierten Slot-Tasten (Reihenfolge = Position). Der Nutzer zieht die Aktionen selbst oder per `pnpm profile:layout`.
- Beispiel MK.2 Seite 1 (Design-Handoff, 8 Slots):

```
Apps    | 5h     | Week   | Inbox  | Status
Extra   | Slot 1 | Slot 2 | Slot 3 | Slot 4
Page 2  | Slot 5 | Slot 6 | Slot 7 | Slot 8
```
- Fremdtasten (Apps, Seite wechseln, Medien, Mikro) sind Elgato-/Fremdaktionen, nicht Teil von VibeTribe.
- Aktionen im Manifest (Kategorie „VibeTribe“, alle Keypad, nicht in Multi-Actions): `dev.h2k.vibetribe.slot` (Session-Slot), `.inbox`, `.limit-5h`, `.limit-week`, `.extra`, `.status`.
- Tasten: Slot kurz = Sprung, lang = quittieren. Inbox kurz = nächste Session, lang = Done quittieren. 5h/Week kurz = Limit neu laden. Extra kurz = Usage-Einstellungen. Status kurz = Quellen, lang = Debug-Seite.
- Lange Taste = ≥ 600 ms.

## 4. Voraussetzungen

- Windows 10 oder neuer laut Manifest (getestet unter Windows 11); optional WSL2 (beliebige Distribution, Node.js ≥ 20 im Login-PATH) für WSL-Sessions. Linux/macOS: nicht unterstützt (`setup` bricht außerhalb Windows/WSL ab).
- Stream-Deck-App mindestens 7.1 (Manifest, SDK v3, `@elgato/streamdeck` 3.0.2); getestet mit 7.6. Gerät: MK.2 (Profil-Werkzeug erkennt nur Modell `20GBL9901`).
- Node.js ≥ 24 (`engines`, Plugin-Runtime `Nodejs.Version 24`); Reporter wird für `node20` gebaut.
- Claude Code und/oder Claude Desktop mit Anmeldung (OAuth-Anmeldedatei für Limits und Remote-Liste); `claude.exe` im PATH (`where.exe claude`) für den Token-Refresh.
- pnpm 10.33.0 (`packageManager`).
- Für die Installation aus WSL: Windows-Interop (`cmd.exe`, `wslpath`, `/mnt/c`).

## 5. Installation aus dem Marketplace

1. In der Stream-Deck-App im Marketplace „VibeTribe“ installieren (kostenlos).
2. Aktionen der Kategorie „VibeTribe“ auf Tasten ziehen.
3. Eine VibeTribe-Taste in der App anklicken, unter „Claude Code hooks“ **Set up hooks** wählen. Bis dahin zeigt die Status-Taste `Setup`. Vorher ändert das Plugin nichts an `~/.claude/settings.json`.
4. Sessions in WSL: **Set up in WSL** an derselben Stelle (braucht Node.js 20 oder neuer im Login-`PATH` von WSL).

Die Einrichtung schreibt Hooks und Statusline-Weiche in `~/.claude/settings.json` (Backup, atomar, idempotent) sowie `reporter.mjs` und eine Kopie von Stream Decks Node.js (`node-<version>.exe`, etwa 90 MB) nach `%USERPROFILE%\.vibetribe`. „Remove hooks“ lässt beide liegen. Nach einem Plugin-Update mit neuem Reporter zeigt die Status-Taste wieder `Setup`: **Update hooks**.

## 5b. Installation aus dem Quellcode

Alle Befehle in WSL im Repo (Repo liegt in WSL; kein pnpm/node unter Windows im Repo). Jeder Schritt verändert den echten Rechner: nur bewusst ausführen.

1. Abhängigkeiten: `pnpm install`
2. Hooks und Statusline-Weiche installieren (je Host, **zuerst Windows**, dann WSL):
   - `pnpm reporter:build` (erzeugt `packages/reporter/dist/reporter.mjs`, eine Datei ohne Abhängigkeiten)
   - Windows: `node <UNC-Pfad>\packages\reporter\dist\reporter.mjs setup` (Pfad `\\wsl.localhost\Ubuntu\home\<user>\…\vibetribe\…`) – legt `%USERPROFILE%\.vibetribe\{reporter.mjs,config.json,token}` an (Token 32 Byte hex, nur Besitzer).
   - WSL: `node packages/reporter/dist/reporter.mjs setup [--windows-home /mnt/c/Users/<name>]` – nutzt den Windows-Token (muss existieren).
   - `setup` ändert `~/.claude/settings.json`: 15 Hook-Ereignisse (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, Elicitation, ElicitationResult, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, SessionEnd) plus Statusline-Weiche, die eine vorhandene Statusline weiterreicht. Backup, atomar, idempotent, fremde Einträge bleiben, ungültiges JSON wird nie überschrieben.
3. Plugin bauen und ausrollen: `pnpm plugin:deploy` (baut, kopiert `manifest.json`, `bin/`, `imgs/` nach `%APPDATA%\Elgato\StreamDeck\Plugins\dev.h2k.vibetribe.sdPlugin`; gestaffelt mit Austausch und Rückfall, `logs/` bleibt unberührt).
4. **Stream-Deck-App vollständig beenden und neu starten.** Die URL `streamdeck://plugins/restart/dev.h2k.vibetribe` wirkt ohne Entwicklermodus nicht; erste Installation braucht ebenfalls den Neustart.
5. Tasten platzieren: in der Stream-Deck-App die sechs VibeTribe-Aktionen (Kategorie „VibeTribe“) auf Tasten ziehen, **oder** `pnpm profile:layout`:
   - `pnpm profile:layout show <ProfilesV3>` zeigt Seiten und Tasten; `apply <ProfilesV3> <layout.json> [--write]` ordnet Seite 1 des MK.2-Profils um und schiebt fremde Tasten samt Bildern auf Seite 2.
   - Sicherheit: ohne `--write` nur Vorschau; fremde Tasten bleiben Byte für Byte; Abbruch statt Datenverlust; `--write` verweigert, solange `StreamDeck.exe` läuft; sichert beide Manifeste als `manifest.json.vibetribe-<zeit>.bak`; schreibt atomar (Seite 2 vor Seite 1), liest zurück und stellt bei Fehler wieder her. `--i-checked-streamdeck-is-closed` überstimmt nur „kann nicht prüfen“. Vorher `%APPDATA%\Elgato\StreamDeck\ProfilesV3` sichern. Profilordner heißt `ProfilesV3`.

**Deinstallieren / Rückgängig**
- Hooks: **Remove hooks** bzw. **Remove from WSL** in den Einstellungen einer VibeTribe-Taste, oder `node …\reporter.mjs setup --uninstall` (je Host; ohne Plugin in PowerShell `& (Get-Item "$env:USERPROFILE\.vibetribe\node-*.exe")[0] "$env:USERPROFILE\.vibetribe\reporter.mjs" setup --uninstall`) entfernt nur eigene Einträge und stellt die vorherige Statusline wieder her; Backup der `settings.json` wird angelegt.
- Plugin: kein Uninstall-Skript. Ordner `%APPDATA%\Elgato\StreamDeck\Plugins\dev.h2k.vibetribe.sdPlugin` bei beendeter App von Hand löschen; optional `%USERPROFILE%\.vibetribe` und `%APPDATA%\vibetribe`.
- Rollback: `deploy.sh` stellt bei Fehler im Austausch die vorige Version wieder her (bei Erstinstallation wird der Ordner entfernt); ein Versionsrücksprung nach erfolgreichem Deploy ist nicht vorgesehen (neu bauen und deployen).
- Profil-Layout: aus den `.bak`-Dateien bzw. der eigenen Sicherung.

## 6. Einstellungen (Umgebungsvariablen)

Wirken nur nach vollständigem Neustart der Stream-Deck-App (unter Windows z. B. `setx VIBETRIBE_VARIANT compact`).
- `VIBETRIBE_VARIANT`: `comfortable` (Standard) oder `compact`; anderes fällt auf `comfortable`.
- `VIBETRIBE_MAX_FRAMES`: Bilder pro Sekunde für das ganze Plugin, ganze Zahl 1–100, Standard 10.
- `VIBETRIBE_PORT`: erster Port der Zentrale, 1–65535, Standard 43710 (ungültig: Standard plus Warnung im Log). Ist er belegt, nimmt das Plugin den ersten freien aus 37710, 31710, 25710 und schreibt ihn nach `%USERPROFILE%\.vibetribe\port`. Der Reporter liest diese Datei (in WSL über `/mnt/c`); ein `hubUrl` in `~/.vibetribe/config.json` hat Vorrang (`http://127.0.0.1:43710` gilt nicht als Vorgabe).
- `VIBETRIBE_WSL_DISTRO`: WSL-Distribution, Standard: die Standard-Distribution von WSL; `none` schaltet WSL ab. `VIBETRIBE_WSL_USER`: WSL-Benutzer, sonst automatisch ermittelt.
- Nur Entwicklung/Headless: `VIBETRIBE_TOKEN` (Standard zufällig), `VIBETRIBE_REMOTE_FIXTURE` (JSON mit Remote-Sessions, z. B. `packages/hub/fixtures/remote/sessions.json`). Headless-Port Standard 43799; 43710 und die Ersatzports 37710/31710/25710 werden verweigert.
- Nur Deploy-Skript (Tests): `VIBETRIBE_DEPLOY_APPDATA_WIN`, `VIBETRIBE_DEPLOY_SRC`.
- Dateien: Token `%USERPROFILE%\.vibetribe\token`; Logs `%APPDATA%\vibetribe\logs\{plugin,hub}.log` (rotierend, 1 MB × 5, nie Tokens); Port-Datei `%USERPROFILE%\.vibetribe\port` (nur die Zahl, bleibt beim Beenden liegen); Zustand `%APPDATA%\vibetribe\{background.json,usage-cache.json}`.

## 7. Datenschutz und Sicherheit

**Was gelesen wird**
- Hook-Ereignisse von Claude Code (Reporter): Ereignisname, Zeitstempel, Tool-Name, Session-Id, Arbeitsverzeichnis, Prozess-Id, Host/Entrypoint, Fehlercode, Hintergrund-Job-Kennungen. Prompt-Texte werden nie gesendet; nur ein Flag `auto` (automatischer Durchgang, erkannt am Prompt-Anfang).
- Statusline-JSON: nur die Limit-Werte (5h/7d: Prozent, Reset).
- Session-Dateien (`~/.claude/sessions/<pid>.json`): Status, Wartegrund, Titel, Remote-Control-Id; nur Dateien lebender Prozesse.
- `claude_desktop_config.json` von Claude Desktop: nur die Liste der angepinnten Code-Sessions, alle 5 s, nur lesend.
- Session-Dateien von Claude Desktop (`claude-code-sessions\…\local_<uuid>.json`): liest die Dateien wartender Sessions und verwendet daraus nur `lastFocusedAt`; alle 5 s, nur lesend. Die Suche nach diesen Dateien sieht die Dateinamen aller Code-Sessions.
- Stündliche Selbstprüfung der Zentrale: liest beim Start und dann einmal je Stunde Ordner, Konfiguration und alle Session-Dateien von Claude Desktop (nur ihre Form und `lastFocusedAt`) und die eigene Port-Datei; eine Logzeile nur, wenn sich etwas ändert (`drift: …`).
- OAuth-Token aus der Claude-Anmeldedatei: nur lesend, ausschließlich für zwei Abfragen an `api.anthropic.com`: Usage (`/api/oauth/usage`, alle 5 min) und Session-Liste (`/v1/code/sessions`, alle 20 s). VibeTribe erneuert Tokens nie selbst; bei Ablauf bittet es das installierte `claude`-CLI (höchstens einmal pro Stunde), die Anmeldedatei zu erneuern: nur `claude -p /cost`, kein Modellaufruf; das Log zeigt je Versuch `token refresh: ok` bzw. `token refresh: no change`.

**Was die Maschine nie verlässt**
- Hook-Ereignisse, Session-Titel, Arbeitsverzeichnisse, Session-Zustand, Tastenbilder, Logs. Einzige ausgehende Verbindungen: die zwei Anthropic-Abfragen oben (HTTPS, keine Weiterleitungen, Timeout 10 s) und das Öffnen von `claude.ai/settings/usage` im Browser. Keine Telemetrie, keine Prompts oder Inhalte irgendwohin gesendet.

**Zentrale**
- Lauscht nur auf `127.0.0.1` (Standard Port 43710); prüft Peer (Loopback), `Host`-Header und lehnt Browser-Anfragen (`Origin`) ab.
- Schreibende Endpunkte (`POST /v1/event`, `/v1/statusline`) verlangen `Authorization: Bearer <Token>` (konstante Zeit verglichen), nur JSON, max. 64 KB. Token: 32 Zufallsbytes, Datei nur für den Besitzer.
- Lesende Debug-Seiten (`/health`, `/debug`, `/debug/state.json`, `/debug/keys`, `/debug/keys.json`) sind ohne Token erreichbar, aber nur auf Loopback; sie zeigen lokale Session-Titel. Cross-Site-Abrufe werden abgewiesen.
- Reporter sind fail-open: Hooks scheitern nie in Claude Code (Timeout 300 ms, kein Output).
- Web-Seiten und `claude://`-Links öffnet das Plugin nur nach exakter Positivliste; `rundll32.exe` über absoluten Pfad in `%SystemRoot%\System32`.

## 8. Grenzen und bekannte Punkte

- Sprung geht über Windows und Claude Desktop und braucht etwa 2 s (Angabe des Auftraggebers; im Repo nicht belegt). `opened` heißt nur „Windows hat den Link angenommen“; die Vordergrund-Sperre kann Desktop nur in der Taskleiste blinken lassen; ein Sprung, der nicht startet, steht als `(failed)` im Log.
- Nur Windows (mit optionalem WSL). Mac-Agent und Tailscale sind nicht implementiert; Remote-Sessions kommen über die Konto-Liste.
- Zwei undokumentierte Schnittstellen (`/api/oauth/usage`, `/v1/code/sessions`): Ausfälle zeigen `As of HH:MM`, `Sign in` bzw. `Offline`, nie als Fehler; können jederzeit brechen.
- Paket für den Marketplace über `pnpm plugin:pack` (`dist/dev.h2k.vibetribe.streamDeckPlugin`, dazu die Bilder in `dist/marketplace/`); aus dem Quellcode weiter per Kopie (`pnpm plugin:deploy`). Der Marketplace-Eintrag erscheint erst nach der Prüfung durch Elgato.
- Hooks lassen Ablehnen/Stoppen in Claude Desktop nicht erkennen; das Ende dieser Zustände kommt über Session-Datei (Polling alle 1–2 s bei wartenden/laufenden Sessions, sonst 5 s).
- `Done` geht bei einem Plugin-Neustart verloren; Hintergrund-Jobs bleiben erhalten.
- Remote: kein Tool-Name, keine Freigabe-/Frage-Unterscheidung, bis 20 s Verzögerung.
- Nicht-lateinische Titel (z. B. Japanisch) fehlen in der Schrift (DejaVu Sans) und werden nicht korrekt gemessen.
- Lesbarkeit am MK.2 (72 px) ist knapp; Atem-Tal (35 %) bewusst niedrig, Zustand trägt Symbol/Wort.
- Plugin und `hub.mjs` nicht gleichzeitig (Port 43710; `hub.mjs` endet mit Exit 2).

## 9. Entwicklung

- `pnpm check` = Biome + `tsc` (strict) + vitest; muss vor jedem Commit grün sein; `CI=true pnpm check` wie GitHub Actions. Vorher `pnpm exec biome check --write .`.
- `pnpm gallery`: PNG-Galerie aller Kacheln in beiden Varianten nach `out/gallery/<comfortable|compact>/` (144 und 72 px), Übersicht `out/gallery/index.html`. `pnpm tiles:measure` misst Texte/Symbole (Pflicht nach Kachel-Änderungen).
- Headless: `pnpm plugin:headless` (Zentrale + Deck ohne Stream Deck, Port 43799; Tasten über stdin `press mk2:1:0` / `long mk2:1:0`; Spiegel unter `/debug/keys`). `pnpm hub:simulate <szenario.jsonl>` spielt Szenarien aus `packages/hub/fixtures/scenarios/` ein. `pnpm deck:render <szenario> --after <ms> [--variant …]` rendert einen Zustand (HTML nach `out/deck/`).
- Debug-Seiten: `http://127.0.0.1:<port>/debug`, `/debug/state.json`, `/debug/keys`, `/debug/keys.json`.
- Drift: `pnpm drift` prüft nur lesend, ob die undokumentierten Schnittstellen (Desktop-Dateien, Session-Dateien, Session-Liste, Usage, Ports, Port-Datei) noch passen, eine Zeile je Annahme, Exit 1 bei Drift. `pnpm e2e:live` macht auf Wunsch einen echten Haiku-Durchgang gegen die laufende Zentrale (kostet Tokens).
- Architektur: Ports & Adapters mit reiner Domäne (`packages/core`: kein I/O, Zeit als Parameter); Abhängigkeiten zeigen nur nach innen `plugin → render → core` (dazu `plugin → reporter`, nur `@vibetribe/reporter/setup`), Reporter sonst eigenständig, Event-Hülle und Port-Datei (`packages/protocol`) sind die einzigen gemeinsamen Verträge; Adapter in `hub`/`plugin`, eine Composition Root.
- Pakete: `core`, `render`, `protocol`, `reporter`, `hub`, `plugin`. Entscheidungen: `docs/adr/0001`–`0011`; Spec `docs/superpowers/specs/2026-10-10-vibetribe-design.md`; TDD, Conventional Commits.

## 10. Bildmaterial

- `pnpm gallery` (erzeugt `out/gallery/comfortable/*.png`, `out/gallery/compact/*.png`, `out/gallery/index.html`; `out/` ist git-ignoriert, ein vorhandener Stand dort kann veraltet sein).
- Handoff-Referenzen (versioniert, Pfad relativ zu `docs/design/handoff-2026-10-13/reference/`):
  - Der Handoff behält seine Namen: `luftig` = comfortable, `dicht` = compact. Luftig 144 px und 72 px: `png/luftig/<name>@144.png`, `@72.png`; dicht 72 px: `png/<name>@72.png`; SVGs: `luftig/*.svg`, `dicht/*.svg`.
  - Gute Motive: `slot-needs_permission`, `slot-needs_permission-breath-068`, `slot-needs_input`, `slot-done_unseen`, `slot-working`, `slot-error`, `slot-background`, `inbox`, `inbox-cycling`, `inbox-overflow`, `limit-normal`, `limit-amber-ahead`, `extra-normal`, `extra-amber`, `status-ok`, `status-expanded`.
- Interaktiver Prototyp: `docs/design/handoff-2026-10-13/design-system/components/Deck-prototype.html`.

## Widersprüche (Doku vs. Code)

- Spec/AGENTS/README nennen „Mac“ als Quelle; im Code heißt es `REM` (Konto-Liste, ADR 0006).
- HANDOFF nennt für die Status-Taste „Setup/Diagnose“; Code öffnet nur `/debug`.
- HANDOFF-Belegung (8 Slots, Extra auf Zeile 2, „Page 2“) ist Designvorschlag; Code-Standard `defaultMk2Layout` (Headless) hat Inbox/5h/Week/Extra/Status oben und 10 Slots; echte Geräte-Belegung hat Apps|5h|Week|Inbox|Status, 11 VibeTribe-Tasten. Plugin passt sich den platzierten Tasten an.
- Manifest erlaubt Windows 10, Spec nennt Windows 11; Stream Deck mindestens 7.1 laut Manifest, Spec nennt 7.6.
- „~2 s Sprungverzögerung“ steht in keiner Doku; belegt sind nur 1 s `Open…` und 2 s `No link`.
- Spec 4.2 nennt `statusUpdatedAt`-Vergleich; ADR 0004 und Code nutzen beobachtete Dateiübergänge.
- `out/gallery/` im Arbeitsverzeichnis hat noch flache (alte) Struktur ohne `comfortable`/`compact`-Ordner; `pnpm gallery` erzeugt die neue.
- `reporter:build` existiert als Root-Skript; AGENTS.md nennt nur die `--filter`-Form (gleichwertig).
