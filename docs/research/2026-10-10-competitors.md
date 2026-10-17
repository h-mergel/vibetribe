# Wettbewerbsanalyse: Stream-Deck- und Status-Tools für Claude Code

Stand: 2026-10-10. Recherche: Web (Produktseiten, GitHub-READMEs, Quellcode der Open-Source-Plugins) sowie ein lesender Blick auf die lokalen Session-Dateien von Claude Code auf diesem Rechner (WSL und Windows).

**Legende**
- **[V] verifiziert**: steht so in der Primärquelle (Produktseite, README, Quellcode, offizielle Doku) oder wurde lokal gemessen.
- **[I] abgeleitet**: eigene Schlussfolgerung oder Sekundärquelle, nicht direkt bestätigt.
- **[?] unbekannt**: nicht auffindbar.

---

## 0. TL;DR

1. **VibeDeck** ist am breitesten aufgestellt: 12 Agents, 28 Actions, Swarm-Key, Diktat, Approvals, Sounds. Das Produkt ist aber geschlossen und kostet 19 USD einmalig, ist macOS-first und beim Fokus auf Windows Terminal x64 beschränkt. WSL wird nirgends erwähnt. Exakte Navigation in Claude-Desktop-Sessions gibt es nur auf macOS. Remote-Hosts sind nicht vorgesehen.
2. **Agent Vitals** (tapparello, **MIT, kostenlos**) ist der stärkste Open-Source-Konkurrent für unseren Funktionsumfang: 5h-, Weekly-, Modell- und Burn-Gauges, Session-Status, Waiting-Key, Allow/Always/Deny per HTTP-Hook. Das Design ist gründlich durchdacht und farbenblind-sicher. Schwächen: Fokus unter Windows nur über einen Teilstring im Fenstertitel, kein WSL, kein Remote, Polling alle 5 s.
3. **JulienCr/streamdeck-claude** (MIT) hat die beste Zustandsmaschine (11 Zustände, reiner Reducer über Hook-Event-Logs) und als einziges Projekt echten **WSL- und Windows-Mischbetrieb**. Der Fokus funktioniert aber nur mit Warp, es gibt keine Usage-Gauges und keine Approvals.
4. **Kein Produkt** fasst WSL-, Windows- und **entfernte Mac-Sessions** auf einem Deck zusammen. Kein Produkt springt unter Windows zuverlässig in eine bestimmte **Claude-Desktop-Code-Tab-Session**. Genau dort liegt unsere Chance.
5. Wichtiger Plattform-Fund **[V, lokal]**: Claude Code schreibt `~/.claude/sessions/<pid>.json` mit `status` (`busy|idle|waiting`), `waitingFor`, `name`, `cwd` und `hostSessionId`. Das gilt **auch für Desktop-App-Sessions** (`entrypoint: "claude-desktop"`). Diese Datei ist die günstigste Zustandsquelle ohne eigene Hooks. Das Verzeichnis enthält allerdings Hunderte veralteter Dateien, deshalb ist ein Liveness-Check über pid und procStart Pflicht.
6. Die 5h- und Weekly-Limits gibt es **offiziell** im Statusline-JSON (`rate_limits.five_hour/seven_day.used_percentage, resets_at`). Alle Konkurrenten nutzen stattdessen den **undokumentierten** Endpoint `api.anthropic.com/api/oauth/usage`.

---

## 1. Produkte im Detail

### 1.1 VibeDeck (getvibedeck.com), kommerziell, Closed Source

**Features [V]**
- 12 Agents: Claude Code, Codex, Cursor, Copilot CLI, Antigravity, OpenCode, Pi, Grok Build, DeepSeek Harness, Gemini CLI, Kilo, Qwen Code. Gemini, Kilo und Qwen liefern nur Status. Claude Code und „managed Codex“ haben die tiefste Steuerung.
- 28 Actions in vier Gruppen:
  - **Attention**: All Sessions, ein Key pro Agent, Swarm.
  - **Control**: Approve/Deny, Reasoning Effort, Model, Agent Config (Presets), Custom Command, Dictation Settings, Dictate Anywhere.
  - **Limits**: Claude Code Usage, Codex Usage, Burn Rate (read-only), Custom Signal (Skripte oder CI lassen einen Key leuchten), Sounds.
  - **Maschine**: Setup, Minimize Window, Keep Awake.
- **Swarm-Key**: zeigt die Summen für waiting, done und working. Jeder Tap springt zur nächsten Session in Prioritätsreihenfolge. Optional gibt es „Previous session“ mit einer Historie von 20 Besuchen.
- **Diktat**: Session-Key halten, sprechen, loslassen. Das Transkript landet in der Session, wird aber nicht automatisch abgeschickt. Lokal (Modell ca. 156 MB), mit eigenem OpenAI-Key oder über einen Whisper-kompatiblen Endpoint.
- Hold-to-interrupt in unterstützten Terminals. Sounds für Approvals, Fragen und Fehler.
- Product Hunt nennt außerdem „Stuck-turn alerts with configurable threshold“ und das automatische Entfernen veralteter Karten.

**Attention-UX**
- [V] Prioritätsreihenfolge: „needs your action, then done, then working“ (All-Sessions-Key und Swarm).
- [V] **Gesehen-Modell**: Zurückkehren zur Session markiert die „alert episode“ als gesehen, beantwortet den Agent aber nicht. Ein neuer Permission-Request startet eine neue Episode.
- [V] Das Video beschreibt nur einen amber leuchtenden Key für wartende Sessions. Die Website-Texte sagen nichts über Blinken oder Pulsieren.
- [V, aus den Key-SVGs der Website] Aufbau eines Tiles:
  - Kopfzeile mit Glyph und Zustandswort: „✦ CLAUDE“, „! WAITS“, „✓ DONE“, „✕ ERROR“, „REVIEW / needs you“.
  - Darunter Projektname (`api`, `web`), Git-Branch (`⎇ main`), angefragtes Tool (`Bash?`) und eine **Verweildauer** (`0:22`, `1:15`).
  - Akzentfarben: Amber `#FFB020` bzw. `#E88F0C`, Rot `#D9333F`, Blau `#7ABBFF`, Grau `#8A8F98` auf dunklem Grund.
  - Der Usage-Key zeigt „WEEK 67% resets Fri“.
  - Die Website-SVGs sind statisch. Ob auf dem Gerät animiert wird, ist **[?]**.

**Zustandserkennung**
- [V] Das Setup installiert Hooks in die Agent-Konfiguration: Vorschau, Bestätigung, Backup, vorhandene Hook-Arrays bleiben erhalten. Danach müssen Sessions neu gestartet werden.
- [V] „Silence is not proof that a session died“: Karten können „stale“ werden.
- [I] Für Approvals wird Claude Code mit dem Flag `--vibedeck-approvals` gestartet, also über einen eigenen Wrapper oder Launch-Pfad. Das Flag ist für Claude Code, Codex, OpenCode und Pi dokumentiert.

**Jump-to-Session**
- [V] macOS: exakter Tab- oder Pane-Fokus in iTerm2 (Automation- und Accessibility-Rechte), Ghostty 1.3+ (AppleScript, nur bei eindeutigem cwd), Terminal.app, WezTerm (Pane-ID plus CLI), kitty (Remote Control), tmux (zuverlässigster Weg) und herdr. Warp und Alacritty bekommen nur App-Fokus. VS Code und Cursor brauchen eine Bridge-Extension, die derzeit nicht herunterladbar ist.
- [V] **Windows: nur Windows Terminal x64** mit „captured session identity“. Elevated Tabs, ARM64 und andere Terminals werden nicht unterstützt.
- [V] **WSL wird nirgends erwähnt.** Zu tmux unter Windows gibt es keine Aussage.
- [V] **Claude Desktop**: exakte Konversations-Navigation nur auf macOS, laut Sessions-Seite noch „pending verification“. Sonst wird nur die App nach vorne geholt.
- [V] Ein Navigationsversuch bricht ab, wenn das Ziel fehlt oder mehrdeutig ist. Ein „receipt“ bestätigt nur die Anfrage, nicht den UI-Wechsel.

**Preis und Lizenz [V]**
- 19 USD einmalig, unbefristete Lizenz für 2 Rechner, 14 Tage Testphase ohne Kreditkarte, 14 Tage Rückgaberecht.
- Version 1.0.4.0, Vertrieb über die eigene Website, nicht über den Elgato Marketplace. Laut Product Hunt hinter der Firma inventivehill.com (Maker: Daniel Polak).
- Preisgeschichte: Zum Start gab es 7 Tage Test mit Kartenpflicht und danach 5 USD im Monat. Nach Nutzerfeedback wurde auf 19 USD einmalig umgestellt [V, Product Hunt].
- Anforderungen: Apple Silicon mit macOS 13+ oder Windows 10+, Stream Deck 6.9+.

**Gut**
- Die Breite des Angebots.
- Das Prioritäts- und Gesehen-Modell.
- Der Swarm-Key als „Inbox“.
- Ehrliche Fähigkeitsmatrix pro Terminal.
- Hook-Installation mit Vorschau und Backup.
- Die Verweildauer auf dem Tile.
- Einmalkauf statt Abo.

**Schlecht und Beschwerden**
- [V] Windows ist zweitklassig: nur Windows Terminal x64, Desktop-Navigation nur auf macOS.
- [V] Kein WSL, keine Remote- oder SSH-Hosts.
- [V] Zur Resonanz: Product Hunt zeigt ca. 9 Follower, 1 Punkt und nur einen (positiven) Kommentar.
- [I] Aus dem Changelog abgeleitete Probleme:
  - Karten blieben nach Session-Ende hängen (Fix in 1.0.4.0 und 1.0.1.7).
  - „Attention fail-open hardening“ deutet auf falsche Waiting-Zustände hin.
  - Unter Windows landete der Fokus im falschen Pane, und PowerShell hing (1.0.1.7).
  - Config-Dateien mit UTF-8-BOM machten Probleme.
  - Codex wurde hinter nvm, Volta oder Aliasen nicht gefunden.
  - Der Uninstall hinterließ Hooks.
  - Es gab falsche Lizenz-Prompts.
- Insgesamt komplex: viele Companions und Bridges, viele „pending verification“-Hinweise.

**Quellen**: https://getvibedeck.com, /terminals, /sessions, /compatibility, /changelog, /assets/vibedeck-showcase-v7-1.0.4.0.txt, Key-SVGs unter /assets/*.svg, https://www.producthunt.com/products/vibedeck-stream-deck-control-for-agents

---

### 1.2 Agent Vitals (`dev.tapparello.agent-vitals`), MIT, kostenlos

**Repo und Lizenz [V]**
- https://github.com/tapparello/agent-vitals, **MIT-Lizenz**, ca. 7 Stars, 155 Commits.
- Entstanden als Fork von `technicallybrantley/agent-vitals`, inzwischen stark umgeschrieben.
- Version 1.8.1. Installation als `.streamDeckPlugin` aus den GitHub-Releases, kein Eintrag im Elgato Marketplace gefunden.
- Es gibt eine GitHub-Pages-Seite im Ordner `docs/` sowie PRIVACY.md und SECURITY.md.
- Der Autor hat damit sein älteres macOS-only-Plugin „Claude Deck“ (Cut/daily) abgelöst.

**20 Actions [V]**
- **Usage**: Session 5h, Weekly, Model Usage (weekly), Burn Rate, Usage (lokale Tokens und Kosten), Today.
- **Sessions**: Active Sessions, Claude Status, Claude Waiting, Focus Session.
- **Approvals**: Allow, Always Allow, Deny.
- **Launcher**: Claude Desktop, Quick Chat, claude.ai, Claude Code Terminal, Project Terminal, Quick Prompt, Claude Custom.

**Datenquellen [V, README und Code]**
- **Limits**: `GET https://api.anthropic.com/api/oauth/usage` mit dem OAuth-Token von Claude Code. Unter Windows kommt der Token aus `~/.claude/.credentials.json`, unter macOS aus dem Keychain. Der Endpoint ist undokumentiert. Die README warnt, dass er sich ändern kann, und HANDOFF.md nennt 429-Antworten.
- Today, Burn und Usage werden aus `~/.claude/projects/**/*.jsonl` geparst (nur Tokens, Modelle und Zeitstempel).
- **Session-Status**: aus `~/.claude/sessions/<pid>.json`, mit `status: busy|shell|idle|waiting` und `waitingFor: permission prompt|input needed|dialog open|sandbox request|worker request`. Nur Prozesse, die noch leben, werden berücksichtigt.
  - Laut HANDOFF.md schreiben nur `entrypoint:"cli"`-Sessions diese Felder, für die VS-Code-Extension greift ein Fallback auf die mtime des Transkripts.
  - Unsere lokale Messung widerspricht teilweise: Desktop-Sessions schreiben `status` ebenfalls (siehe Abschnitt 2).
- Polling-Intervalle aus `plugin.js`: Sessions 5 s, Burn und Usage 60 s, Today 300 s, Animations-Ticker 600 ms.

**Approvals [V]**
- Ein `PermissionRequest`-Hook vom Typ HTTP schickt einen POST an einen Loopback-Listener `127.0.0.1:45623`. Ein 32 Zeichen langes Secret steht im URL-Pfad.
- Der Nutzer fügt den Snippet selbst in `settings.json` ein. Das Plugin verändert die Datei nie.
- Allow, Always und Deny beantworten den Prompt. Always übernimmt die von Claude vorgeschlagene Regel (`sanitizeSuggestions` ist dabei eine Sicherheitsgrenze) und schreibt sie in `.claude/settings.local.json` oder nur in den Speicher der aktuellen Session.
- Ein Request bleibt maximal **20 s** auf dem Deck („hold“). Nach einem Deny ist Always für dieselbe Regel 30 s gesperrt. Die Warteschlange fasst höchstens 8 Einträge.
- Statusmeldungen „port busy“ und „auth?“ bei falschem Pfad.

**Jump-to-Session [V, Code]**
- macOS: Terminal.app per tty-Match (Automation-Recht), VS Code per Fenstertitel über System Events (der Autor nennt das selbst „fragile“), andere Apps werden nur aktiviert. Sessions in tmux oder screen lassen sich nicht auflösen.
- **Windows**: PowerShell mit `EnumWindows`, Suche nach einem **Teilstring des Session-Namens oder cwd-Basenamens im Fenstertitel**, dann `SetForegroundWindow`. Das ist sehr grob: kein bestimmter Tab, keine WSL-Logik.

**Visual Design [V, `src/keyart.js`]**: Hier wurde am sorgfältigsten von allen Projekten gearbeitet.
- **Regel 1: „Colour is meaning, never decoration“.** Daten werden knochenweiß dargestellt (`#f5f1ea` auf `#16151c`). Farbe ist für fünf Zustände (ok, warn, bad, info, ask) und die drei Approve-Entscheidungen reserviert. Laut Kommentar ließ das frühere Claude-Orange vier Dollarbeträge wie einen Alarm aussehen.
- **Regel 2**: Ein Key, dessen Druck „das Deck verlässt“ (App starten, Fenster fokussieren, Prompt beantworten), bekommt ein Band und ein Glyph. Das Band trägt eine feste Identitätsfarbe mit niedriger Chroma (ca. 20). Zustandsfarben haben eine Chroma von 49 bis 92, der Rahmen zeigt nur den Zustand.
- **Regel 3**: Ein einheitliches Gerüst auf jedem Key: Header 0–34, Wert, Unterzeile bei y=127. Der Canvas ist 144×144. Texte werden vermessen (Faktor 0,6 × Schriftgröße) und notfalls mit „…“ gekürzt. Ein Test prüft auf Überlauf.
- **Farbenblindheit**: ALLOW, ALWAYS und DENY unterscheiden sich durch einfache Linie, Doppellinie und gefüllte Kappe sowie die Glyphen ✓, ✓✓ und ✗. Begründung im Code: Grün und Rot liegen bei Deuteranopie nur 1,34:1 auseinander und werden beide oliv.
- **Gauges**: grün unter 60 %, amber von 60 bis 85 %, rot ab 85 %. Ab **90 % pulsiert** ein roter Rahmen.
- **Statusfarben**: Needs approval = warn (amber, „strong“), Input needed = ask (lila `#a855f7`, strong), Working = info (blau), Finished = ok (grün), Idle = dim.
- **Animation**: „Breathing“-Rahmen über 3 Frames à 600 ms, also eine Periode von 1,8 s (ca. 0,55 Hz). Glow entsteht durch konzentrische Strokes statt `feGaussianBlur`, weil man sich auf Filter im Stream-Deck-Renderer nicht verlassen kann. Working wird durch rotierende Punkte dargestellt.

**Gut**
- Kostenlos und MIT-lizenziert.
- Kein Setup für die Gauges.
- Saubere Trennung in reine Module mit 259 Tests.
- Ausgereifte Farbsemantik und Farbenblind-Sicherheit.
- Approval-Sicherheit: Secret, Hold-Timeout, Deny-Sperre.
- Fallback auf lokale Spend-Schätzung für Enterprise-Backends (Bedrock, Vertex, Foundry).

**Schlecht**
- Kein WSL und kein Remote.
- Grober Windows-Fokus.
- Undokumentierter Usage-Endpoint.
- 5-s-Polling erzeugt Latenz bei „needs you“.
- Headless- und verschachtelte Sessions sowie Desktop- und claude.ai-Chats sind unsichtbar.
- Hold von 20 s: Danach fällt die Entscheidung zurück ins Terminal.
- [V] Bekannte Probleme laut HANDOFF.md: Das Relaunch-Skript lässt Stream Deck geschlossen zurück, damit ist auch der Hook-Server weg. Today und Burn zählen nur diesen Rechner, die Gauges dagegen das ganze Konto. `status !== "idle"` wird fälschlich als „working“ gewertet.

**Quellen**: https://github.com/tapparello/agent-vitals (README, HANDOFF.md, src/keyart.js, src/plugin.js, src/approve.js), https://notes.nicolasdeville.com/helpers/agent-vitals/ (von KI verfasste Notiz, nur sekundär)

---

### 1.3 JulienCr/streamdeck-claude, MIT (Maskottchen-Assets AGPL-3.0)

**Lizenz [V]**: Der Code steht unter MIT. Das „Clawd“-Maskottchen (`assets/clawd/*.svg`, `clawdIdleLook`) stammt aus einem AGPL-3.0-Projekt. Wichtig für uns: diese Assets **nicht** übernehmen. Repo-Stand: ca. 4 Stars, 48 Commits, 10 offene Issues, alle davon Refactor- oder Test-Enhancements.

**Features [V]**
- Ein Key pro laufender CLI-Session. Die Slots werden nach Startzeit gefüllt, Sessions über der Slot-Anzahl fallen weg.
- **Druck**: Das cwd landet in der Zwischenablage, dazu Fokus auf den passenden **Warp**-Tab.
- **Langer Druck (≥ 500 ms)**: setzt das Event-Log zurück.
- **Setup-Key**: prüft die Hook-Registrierung und zeigt eine amber „HOOKS“-Warnung, wenn sie fehlt.
- **Badges**: `+N` für Hintergrund-Tasks, unterer Rand soft-rot für `bypassPermissions`, violett für `plan`, grau für bg-Sessions.

**Zustandserkennung [V, docs/architecture.md]**
- Hook-Skripte (`notification.sh` für Linux, macOS und WSL, `notification.ps1` für Windows) hängen pro Event eine JSON-Zeile an `~/.claude/sessions/<sessionId>.events.ndjson` an. `SessionStart` kürzt die Datei, `SessionEnd` löscht sie. PreToolUse und PostToolUse nutzen einen Catch-all-Matcher.
- Das Plugin **pollt** im Sekundentakt: Verzeichnisse scannen, Liveness prüfen, Log durch einen **reinen Reducer** abspielen, rendern. Der Animations-Tick läuft alle 120 ms.
- **Liveness-Check**:
  - WSL-PIDs: gebündelt über `wsl.exe -d <distro> -- kill -0 <pid>`.
  - Windows-PIDs: über einen `tasklist.exe /FO CSV`-Dump.
  - Ein 10-s-Cache verhindert Flackern.
  - Ein „finished“-Zustand bleibt 3 s sichtbar.
- **Zustandspriorität**: finished > error > throttled > awaiting_plan > awaiting_permission > awaiting_question > awaiting > compacting > subagent > working > idle. Alle awaiting-Zustände stehen über „busy“, weil Claude Code während des Wartens weiterhin „busy“ meldet.
- **Feinheiten**:
  - Permission-Locks pro `agentId`: Ein Subagent kann den Prompt eines anderen nicht löschen.
  - Subagents werden als ID-Set verwaltet statt mit einem Zähler.
  - `StopFailure[rate_limit|overloaded]` ergibt throttled, weil Claude Code automatisch neu versucht. Andere Fehler ergeben error.
  - `idle_prompt` nach `Stop` wird über einen `inTurn`-Guard ignoriert.
- **WSL-Brücke**:
  - Distro und Home-Verzeichnis werden zur Build-Zeit eingebacken, weil die Stream-Deck-App unter Windows weder `HOME` noch `WSL_DISTRO_NAME` setzt. Zugriff über `\\wsl.localhost\<distro>\…`.
  - Der Windows-Hook ruft die `.ps1` über den UNC-Pfad aus dem Repo auf.
  - Windows-Entwicklermodus ist nötig (für `mklink /D`).

**Jump [V, docs/warp-focus.md]**
- Nur Warp. Das Plugin liest Warps SQLite-DB (`%LOCALAPPDATA%\warp\Warp\data\warp.sqlite`), bewertet Panes nach cwd (exakt, Präfix, Token-Überlappung) und schickt Tasten: Tab 1–9 per `Ctrl+Numpad<n>` über SendInput, danach `Ctrl+PageDown`.
- Den Vordergrund-Lock holt es sich über `AttachThreadInput`.
- WSL-Pfade in Warp werden zurück in Linux-Pfade übersetzt. `sqlite3.exe` muss im PATH liegen.
- Bei gleichem cwd in mehreren Tabs gewinnt der linke. Bei mehreren Fenstern und Tab > 9 kann es den falschen treffen (Issue #7: HWND-Mapping).

**Visual [V, src/icons]**
- Dunkler Grund pro Zustand. Akzentfarben:
  - working: amber `#fbbf24` mit Spinner
  - idle: blau `#3b82f6` mit Clawd
  - awaiting: orange `#f97316`
  - permission: `#f59e0b` mit pulsierendem Schloss
  - question: cyan `#06b6d4`
  - plan: violett `#a78bfa`
  - error: rot `#ef4444` mit Blitz
  - throttled: dunkles Amber mit Uhr, **ohne** Puls
  - compacting: türkis
  - finished: grün mit Haken
- Bei „needs you“-Zuständen pulsiert die **gesamte Kachel** mit bis zu 75 % Akzent-Overlay. Die Motiv-Periode ist 12 × 120 ms = 1,44 s, der Hintergrund-Puls läuft doppelt so schnell (ca. 0,72 s, also ca. 1,4 Hz).
- Projektname oben (19 px), zwei Zeilen unten (17 px), optional ein Marquee-Lauftext.
- Kritik [I]: Working ist amber und liegt damit sehr nah an Permission (`#f59e0b`) und awaiting (`#f97316`). Die Unterscheidung hängt an Motiv und Puls, nicht an der Farbe. Für Farbenblinde ist das heikel.

**Gut**
- Die korrekteste Zustandsmaschine aller Projekte.
- WSL- und Windows-Sessions gleichzeitig.
- Billiger und robuster Liveness-Check.
- Durchdachte Setup- und Health-Anzeige.

**Schlecht**
- Build aus dem Quellcode mit pnpm, jq und perl, dazu Entwicklermodus. Kein fertiges Release.
- Nur Warp-Fokus.
- Keine Usage-Gauges, keine Approvals.
- Event-Logs wachsen pro Tool-Call.
- Die Distro wird zur Build-Zeit festgelegt.
- Eine Session-Liste mit fester Slot-Zuordnung, ohne Priorisierung bei Überlauf.

**Quellen**: https://github.com/JulienCr/streamdeck-claude (README, docs/architecture.md, docs/warp-focus.md, src/icons/*.ts, Issues)

---

### 1.4 etechlead/claude-deck („Claude Deck“), MIT

- [V] Eine einzige Action „Session Slot“, die man auf beliebig viele Keys legen kann. Hooks `UserPromptSubmit`, `Stop` und `Notification` rufen `claude-deck.js` auf, das an einen lokalen Dienst auf **Port 17880** meldet. Dazu gibt es eine REST-API.
- [V] Running wird als **pulsierendes Icon** mit Projektname dargestellt, Completed als statisches Claude-Icon. Tap löscht den Slot. Neue Tasks bekommen automatisch einen freien Slot.
- [V] Läuft auf Windows, macOS und Linux (gemeint sind die Hooks), ca. 9 Stars.
- [V] **Bekannter Mangel**: Nach einem Permission-Prompt zeigt der Slot „completed“, obwohl Claude nach der Freigabe weiterarbeitet. Der Autor begründet das mit einem fehlenden „resumed“-Hook.
  - [I] Mit `PermissionRequest`, `PostToolUse` und `PreToolUse` ist das heute lösbar, wie JulienCr zeigt.
- Kein Jump, keine Gauges.
- **Lehre für uns**: Ein Modell aus nur drei Hooks ist zu grob.
- Achtung Namensgleichheit: Es gibt ein zweites „Claude Deck“ von Jonny Elwyn (Cut/daily, siehe 1.9).

**Quelle**: https://github.com/etechlead/claude-deck

### 1.5 cskwork/streamdeck-agent-cockpit, MIT

- [V] Kein fertiges Plugin, sondern ein portables „Skill“ plus Referenz-Runtime.
  - `cockpitd`: Python-Daemon (nur Standardbibliothek), nur Loopback, Command-Allowlist, Token-Datei mit Modus 0600, Zustände mit TTL.
  - Zwei Wege zum Stream Deck: die eingebaute „Open“-Action mit generiertem Launcher oder ein selbst gebautes Plugin über das SDK.
- [V] Hook-Bridge für Claude Code: SessionStart und Stop ergeben IDLE, UserPromptSubmit ergibt RUN, Notification ergibt **CHECK**, SessionEnd ergibt OFF. Optional `--extended` mit BLOCKED und FAILED (läuft dann bei jedem Tool-Call).
- [V] **Datenschutz-Prinzip**: Labels zeigen nur den Verzeichnisnamen, nie Prompt-Text oder Modell-Output. Terminal-Titel werden bewusst nicht ausgelesen.
- [V] Jump: Bei tmux-Sessions wird das Pane fokussiert. Unter macOS iTerm2 und Terminal.app per tty. **Windows Terminal über den exakten Tab-Titel, den der Nutzer selbst setzt.**
- [V] Schwächen:
  - Die Zahl der Slots ist fix, neue Sessions werden ignoriert, wenn alles belegt ist.
  - Sessions, die schon vor der Installation liefen, bleiben unsichtbar.
  - Session-Discovery funktioniert nur auf macOS.
  - 1 Star.
- **Lehre**: TTL-basierte Zustände plus Fallback sind ein gutes Muster gegen hängende Karten.

**Quelle**: https://github.com/cskwork/streamdeck-agent-cockpit

### 1.6 appaquet/ccmon, MIT, laut Autor nicht mehr gepflegt

- [V] Web-Dashboard (HTTP und WebSocket, Port 8080) für Claude Code und OpenCode. Die Hooks UserPromptSubmit, PostToolUse, PermissionRequest, Stop, SessionEnd, Notification und SessionStart rufen `ccmon status` auf, das eine Statusdatei schreibt. Zusätzlich gibt es `ccmon dump --watch` (JSON-Stream).
- [V] Der Autor schreibt, dass Hooks Signale liefern, die man durch Beobachten der Session-Dateien nicht bekommt. Er ist inzwischen zu „herdr“ gewechselt.
- Kein Stream Deck, kein Jump. Für uns nur als Muster interessant: Hook schreibt Status, Server sendet per WebSocket.

**Quelle**: https://github.com/appaquet/ccmon

### 1.7 verygoodplugins/streamdeck-mcp, MIT, ca. 51 Stars

- [V] Ein **MCP-Server, mit dem ein Agent Stream-Deck-Profile entwerfen und bearbeiten kann**: Er schreibt ProfilesV3 und V2 der Elgato-App, erzeugt Icons aus Material Design Icons und findet installierte Plugins und Actions. Es gibt einen separaten USB-Modus für Linux.
- [V] Das Profil wird geschrieben, während die App beendet ist. Automatisches Beenden und Neustarten gibt es nur auf macOS.
- **Kein Status-Monitoring.** Relevant für uns nur als mögliche Ergänzung, etwa „Claude richtet dein Deck ein“ oder ein Onboarding, das ein Profil generiert.

**Quelle**: https://github.com/verygoodplugins/streamdeck-mcp

### 1.8 Claude Usage / „AI Coding Usage Meter“ (saeedkolivand) und „Claude Code Usage“ im Elgato Marketplace

- [V] saeedkolivand/claude-usage-streamdeck-plugin, MIT, ca. 19 Stars, im Marketplace als „AI Coding Usage Meter“ gelistet.
  - **Keys**: 5h und 7d (große Prozentzahl, **Ringgauge**, Reset-Countdown), **Carousel** (wechselt alle 10 s zwischen 5h, 7d, Modell und Badge, mit Page-Dots), Model weekly, **Burn rate** (%/h mit prognostizierter Zeit bis voll), Tokens und Kosten, 7-Tage-Sparkline.
  - Für Stream Deck+ eine Dial-Action, für Neo eine Infobar.
  - **Farben**: grün, amber ab 50 %, rot ab 80 % (konfigurierbar). **Beim Überschreiten der Rot-Schwelle blinkt der Key einmal.** Danach ist das Blinken scharfgeschaltet, bis das Fenster zurückgesetzt wird.
  - Refresh alle 60 s, ein gemeinsamer Cache für alle Keys, Tap erzwingt einen Refresh.
  - Schreibt `~/.claude-usage/stats.json` für OBS. Mehrere Konten werden als „Profile“ (Config-Ordner) unterstützt.
  - Gleicher undokumentierter Endpoint wie Agent Vitals. Der User-Agent muss mit `claude-code/` beginnen, sonst greift ein stark limitierter Bucket. Das Plugin erneuert den OAuth-Token selbst und schreibt ihn zurück. [I] Das ist riskant, weil es mit der Token-Rotation von Claude Code konkurrieren kann.
- [V] Elgatos eigener Explorer-Artikel listet ein Plugin „**Claude Code Usage**“ (nur Windows): Ausgaben, Planlimits, Session-Countdown, Sessions starten, Hintergrund-Agents beobachten. Daneben „Claude Peak Ticker“ (kostenlos, Peak- und Off-Peak-Countdown), „Claude AI Prompt Templates“ (Profil) und ein „Claude Code Shortcut Profile“ (57 Slash-Commands, 4 Dials).
- [?] Publisher, Preis und Lizenz von „Claude Code Usage“ ließen sich nicht ermitteln, die Marketplace-Seite war nicht abrufbar. Ob es mit saeedkolivand identisch ist, bleibt offen.

**Quellen**: https://github.com/saeedkolivand/claude-usage-streamdeck-plugin, https://www.elgato.com/us/en/explorer/products/stream-deck/control-claude-with-stream-deck-for-faster-workflows/

### 1.9 Claude Deck (Jonny Elwyn, Cut/daily), Vorgänger von Agent Vitals

- [V, Sekundärquelle] Nur macOS (Token aus dem Keychain). Keys für 5h, 7d und kombiniert, jeweils mit Prozent, Balken und Reset-Countdown. **Einziges Produkt mit „projected usage“**, also wie viel Prozent bei der aktuellen Rate am Ende des Fensters erreicht werden.
- Refresh alle 60 s, mindestens 30 s. Pay-what-you-want. Inzwischen durch Agent Vitals ersetzt.

**Quelle**: https://notes.nicolasdeville.com/helpers/claude-deck/, https://store.cut-daily.com/b/claude-deck

### 1.10 AgentDeck (puritysb), MIT, ca. 260 Stars

- [V] Ein lokaler Daemon plus viele Oberflächen:
  - Mac-, iOS- und Android-App mit einer „Aquarium“-Visualisierung (jede Session ist ein Tier)
  - Stream Deck (Marketplace) und Ulanzi D200H/D200X
  - ESP32- und TRMNL-E-Ink-Displays
  - Pixel-Displays (Divoom Pixoo64, Ulanzi TC001, iDotMatrix)
- [V] Liest native Events statt Terminal-Scraping: Claude Code über Hooks, Codex über Hooks und Rollout-Logs, OpenCode über ein Plugin. Hooks werden opt-in installiert. Usage-Gauges für Claude, Codex und GLM. Antworten und Unterbrechen nur dort, wo ein echter Kontrollpfad existiert.
- [V] Plattform: Node 22+ auf macOS 15+, Windows 11 oder Linux. Die Mac-App verlangt macOS 26+. Mobile Geräte koppeln sich mit dem Daemon im LAN. Es gibt einen „remote attach guide“ für managed Sessions. WSL wird nicht erwähnt.
- [V, japanischer Artikel] Ein virales Setup mit Stream Deck+ (3.900 Likes) nutzte die Dials für „GO ON“, „REVIEW“, „Usage“ und „Voice“ sowie Approvals per Dial. Die Reaktionen („wie viele kleine KIs halten“) zeigen, dass der emotionale und spielerische Aspekt zieht.
- **Lehre**: Der Multi-Surface-Daemon ist architektonisch das Muster, das wir für Multi-Host brauchen. AgentDeck ist aber ein breites Ökosystem, kein schlankes Deck-Plugin.

**Quellen**: https://github.com/puritysb/AgentDeck, https://hashout.jp/ai/2290/

### 1.11 Status-Lampen und Menüleisten-Apps (Auswahl)

| Projekt | Gerät | Zustandsmapping | Bemerkung |
|---|---|---|---|
| **artemy/semaphore** [V], MIT | USB-HID-Ampel | grün = idle/wartet auf dich, rot = busy, **gelb blinkend = braucht Eingabe**, aus = keine Session | Blinkrate konfigurierbar, Standard 500 ms Halbperiode (1 Hz). Hooks für Claude, Codex, Copilot, OpenCode, Antigravity |
| **cclight** [V, PyPI] | ESP32-LED | working, idle, input | als Claude-Code-Plugin installierbar |
| Claude Traffic Light [I, MakerWorld] | ESP8266-Ampel | **rot dauerhaft** = WAITING_USER | |
| WLED-DIY [I, Reddit] | WS2812-Streifen | **amber „breathing“** = Input oder Permission | |
| **Ampel** [V, Sekundärquelle], MIT | macOS-Menüleiste | rot = blockiert auf dich, gelb = arbeitet, grün = idle; ein **blockierter Zustand gewinnt** immer; leerer Prompt zählt nicht als Attention | optional 5h- und 7d-Usage |
| **Hive Light** (fr1j0) [I] | macOS-Menüleiste | „red always wins“ | |
| **Aignals** [I] | macOS-Menüleiste | ein Licht pro Session; **grau, wenn der Prozess tot ist** | Achtung: anderes Farbmapping (rot = working) |
| Claude Status Bar (m1ckc3s) [I] | macOS | Permission-Punkt, animiert solange etwas arbeitet | |
| Tray-Apps: claude-usage-tray (mattdotbuild, ksmaster03), Claudometer, ClaUse Bar, LimitBar, Claude Usage Tracker [I] | Windows-Tray und macOS-Menüleiste | 5h- und 7d-Prozent; ksmaster03 zeigt den **jeweils kritischsten** Wert | mattdotbuild hat einen umstrittenen „Heartbeat“, der Claude alle 5 h anpingt |
| **ccusage** [V] | CLI | historische Kosten und Token-Auswertung aus JSONL | kein Live-Limit |

**Beobachtung**: Die Farbsemantik ist **nicht einheitlich**. Bei manchen Projekten heißt rot „busy“, bei anderen „needs you“. Der Konsens bei den besseren Tools lautet: **die höchste Dringlichkeit gewinnt**, und **Blinken oder Atmen ist allein für „braucht dich“ reserviert**.

---

## 2. Plattform-Fakten, die unser Design bestimmen

### 2.1 Claude Code Session-Dateien `~/.claude/sessions/<pid>.json` [V, lokal gemessen]

- In WSL liegen **611 JSON-Dateien**, davon 610 mit `entrypoint:"claude-desktop"` und 1 mit `cli`. Unter Windows (`%USERPROFILE%\.claude\sessions`) liegen weitere Desktop-Sessions.
- **Felder**: `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`, `version`, `kind:"interactive"`, `entrypoint`, `name`, `nameSource` (`user|derived`), `formerNames`, `status` (`busy|idle|waiting`), `statusUpdatedAt`, `waitingFor` (gesehen: `input needed`), `hostSessionId` (`local_<uuid>`, die ID der Desktop-Session), `pidDomain` (z. B. `linux:<machine-id>:pid:[ns]`, `win32:<hostname>`), `messagingSocketPath` (Unix-Socket bzw. Named Pipe), `peerFeatures` (z. B. `notify_idle`) und `bridgeSessionId`.
- **Desktop-Sessions schreiben `status` und `waitingFor`**, in WSL ebenso wie in nativen Windows-Sessions. Die Aussage in Agent Vitals' HANDOFF („nur cli“) stimmt also bei aktuellen Versionen (2.1.29x) nicht mehr.
- Ältere Dateien (Version 2.1.222) haben **keine** `status`-Felder. Ab einer bestimmten Version wurde das Feld eingeführt [I].
- **Veraltete Dateien** werden nicht aufgeräumt. Liveness muss über `pid` und `procStart` geprüft werden (Schutz gegen PID-Recycling, vgl. `pidLooksRecycled` bei Agent Vitals).
- `.key`-Dateien liegen daneben. Wir haben sie nicht gelesen, und unser Produkt sollte sie auch nicht anfassen [I: vermutlich Secrets für das Peer-Messaging].
- Diese Dateien sind ein **undokumentiertes internes Format** und können sich jederzeit ändern [I].

### 2.2 Offizielle Hook-Schnittstelle [V, code.claude.com/docs/en/hooks]

- **HTTP-Hooks** (`"type":"http"`, POST mit JSON, Standard-Timeout 600 s, Header mit `allowedEnvVars`). Die Entscheidung kommt als 2xx-JSON zurück. Damit lässt sich ein Hook direkt an das Plugin schicken, ohne Shell-Skript.
- **33 Events**, darunter PermissionRequest, PermissionDenied, Notification, Stop, StopFailure, SubagentStart/Stop, PreCompact/PostCompact, Elicitation, SessionStart/End und TaskCreated/Completed.
- **Notification-Typen**: `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*` und weitere.
- **Hooks feuern auch in der Desktop-App**, ebenso in IDE- und Cloud-Sessions.
- Hook-Input enthält **keine** tty- oder pid-Information. Hooks haben kein `/dev/tty`. Es gibt aber ein Output-Feld `terminalSequence` [V, erwähnt]. [I] Darüber ließe sich eventuell ein OSC-Titel setzen, was den Fenster- oder Tab-Fokus per Titel erleichtern würde. Das ist zu verifizieren.

### 2.3 Limits und Kosten

- [V] **Statusline-JSON**: `rate_limits.five_hour.used_percentage` und `.resets_at`, dasselbe für `seven_day`, `spend_limit` (Gateway), `cost.total_cost_usd` pro Session (Schätzung zum Listenpreis) und `context_window.used_percentage`. `rate_limits` gibt es nur für Pro und Max und erst nach der ersten API-Antwort.
  - Das ist der **offizielle** Weg. Ein winziges Statusline-Skript kann die Werte an das Plugin weiterreichen. Ein bestehendes Statusline-Skript muss dabei verkettet werden.
- [V] Alternative (alle Konkurrenten): der undokumentierte `GET /api/oauth/usage` mit OAuth-Token. Er liefert Werte unabhängig davon, ob eine Session läuft, kann aber 429 zurückgeben, und der User-Agent ist relevant.

### 2.4 Deep Links und Jump [V]

- `claude://code/new?q=&folder=` öffnet eine **neue** Desktop-Code-Session. `claude://code/new?ssh_host=&ssh_port=&ssh_folder=` öffnet eine neue SSH-Session.
- `claude://claude.ai/chat/{id}` öffnet einen bestehenden **Chat**. Für eine **bestehende Code-Session ist kein Link dokumentiert**. [?] Ob `hostSessionId` (`local_…`) über einen undokumentierten Pfad adressierbar ist, ist offen. VibeDeck hat das offenbar nur auf macOS gelöst.
- `claude-cli://open?cwd=&q=&repo=` öffnet ein **neues** Terminal. Unter Windows wird Windows Terminal bevorzugt.
- Die Desktop-App kennt **SSH-Sessions** (Claude läuft auf einem Remote-Host) und **WSL-Sessions**. [I] Die Sessions auf dem MacBook könnten also auch als Desktop-SSH-Sessions vom Windows-Rechner aus laufen. Die Session-Datei liegt dann trotzdem auf dem Mac.
- Desktop sendet selbst OS-Benachrichtigungen, wenn eine Code-Session fertig ist und man sie gerade nicht ansieht. Für Projekte gibt es eine „see what needs you“-Übersicht [V].

### 2.5 Stream-Deck-SDK-Rahmen [V, docs.elgato.com]

- Keys sind 72×72 px, High-DPI 144×144. Bei `setImage` gibt man nur eine Größe an, empfohlen ist 144. SVG ist für dynamische Gauges empfohlen.
- **Maximal 10 Updates pro Sekunde** pro Plugin-Empfehlung. Animierte GIFs sind über `setImage` nicht möglich, man muss Frames selbst pushen.
- Der Stream-Deck+-Touchstrip hat ein Layout von 200×100 px, Bedienelemente mindestens 35×35 px.
- [V, Agent Vitals] Auf SVG-Filter wie Blur kann man sich im Renderer nicht verlassen.
- [V, JulienCr] Die Hardware hat eine Eckrundung von ca. 20 px. Inhalte sollten 5–10 px Abstand zum Rand halten.

---

## 3. Vergleichstabelle

| | VibeDeck | Agent Vitals | JulienCr streamdeck-claude | etechlead claude-deck | agent-cockpit | saeedkolivand Usage | AgentDeck |
|---|---|---|---|---|---|---|---|
| Lizenz / Preis | Closed, 19 USD einmalig (2 PCs) | **MIT, gratis** | MIT (Clawd-Assets AGPL) | MIT | MIT | MIT (Marketplace) | MIT |
| Reife / Stars | v1.0.4, kommerziell | v1.8.1, 7★, 259 Tests | 4★, nur Build aus Quellcode | 9★ | 1★ | 19★ | 260★ |
| Agents | 12 | Claude | Claude | Claude | Claude, Codex, Pi … | Claude | Claude, Codex, OpenCode … |
| Zustandsquelle | Hooks (Setup-Installer) | sessions/*.json + Transkript-mtime | Hook-Event-Logs + Reducer | 3 Hooks, HTTP :17880 | Hook-Bridge + TTL | – | Hooks/Observer + Daemon |
| Anzahl Zustände | working, waiting, done, error, stale | 5 (approval, input, working, finished, idle) | **11** + Badges | 2 | 4–6 | – | ? |
| Latenz | Push [I] | Poll 5 s | Poll 1 s | Push | Push | – | Push |
| 5h / Weekly | ja | ja (+Modell, Burn) | nein | nein | nein | ja (Ring, Carousel, Burn, Sparkline) | ja |
| Kosten | lokale Tokens | lokale Spend-Schätzung | nein | nein | nein | ja | ja |
| Approvals vom Deck | ja (Startflag) | **ja (HTTP-Hook, Secret, Always-Regel)** | nein | nein | nein | – | teilweise |
| Attention-Signal | amber Key, Sounds, Swarm, Gesehen-Modell, Verweildauer | Rahmen „atmet“ 1,8 s; Waiting-Key | ganze Kachel pulsiert ca. 1,4 Hz | pulsierendes Icon für *running* (!) | CHECK-Zustand | einmaliges Blinken bei Rot | „stands out“ |
| Priorisierung | needs action > done > working | Waiting-Key zeigt Blockierte | expliziter Prioritäts-Stack | nein | nein | – | ? |
| Wartezeit sichtbar | **ja (mm:ss)** | nein | nein | nein | nein | – | ? |
| Jump unter Windows | Windows Terminal x64 (exakter Tab) | Fenstertitel-Teilstring | Warp (SQLite + Tasten) | nein | Windows-Terminal-Tab-Titel | – | ? |
| WSL | nicht erwähnt | nein | **ja** | [?] | nein | – | nicht erwähnt |
| Remote-Host (Mac) | nein | nein | nein | nein | nein | nein | Mobile-Pairing, „remote attach“ (managed) |
| Claude Desktop Code-Tab | Status; exakte Navigation nur macOS | nein (Launcher) | nein | nein | nein | – | ? |
| Farbenblind-Konzept | [?] Glyphen im Header | **ja (Glyph + Linienstärke)** | teilweise (Motive) | nein | – | nein | ? |

---

## 4. Best Practices für die Key-Visualisierung (72/144 px)

### 4.1 Farbsemantik
1. **Grau oder dunkel heißt „alles normal“. Farbe nur bei Abweichung.** Das ist der Kern der High-Performance-HMI-Philosophie (ISA-101) [V, Sekundärquellen: control.com „Going Gray“, GoJS-HMI-Demo]. Agent Vitals setzt das konsequent um („colour is meaning, never decoration“).
2. **Kleiner Farbwortschatz mit fester Bedeutung**, deckweit identisch. Vorschlag:
   - **Amber/Orange** = braucht dich (Permission oder Frage)
   - **Rot** = Fehler oder blockiert
   - **Blau** = arbeitet
   - **Grün** = fertig und noch nicht gesehen
   - **Grau** = idle oder offline
   - Lila, wenn nötig, für Plan-Freigabe oder Frage (wie Agent Vitals „ask“ und JulienCr „plan“).
   - **Nicht** Amber für „working“ verwenden (Fehler bei JulienCr), und **kein Claude-Orange als Deko** (Agent Vitals hat das erst lernen müssen).
3. **Colorblind-safe**: Okabe-Ito-Palette verwenden [V]: Blau `#0072B2`, Orange `#E69F00`, Zinnoberrot `#D55E00`, Blaugrün `#009E73`, Himmelblau `#56B4E9`. Rot-Grün darf nie allein entscheiden. Agent Vitals hat gemessen, dass Grün und Rot bei Deuteranopie nur 1,34:1 auseinanderliegen [V].
4. **Redundante Kodierung**: Jeder Zustand braucht **Farbe + Glyph + Wort**. Beispiele: `!` bzw. Schloss für Permission, `?` für Frage, ✓ für fertig, ✕ für Fehler, Spinner für working. Zusätzlich hilft die Strichstärke des Rahmens (dünn = Info, dick = braucht dich). ISA-101-Sekundärquellen empfehlen ebenfalls Form, Füllung oder Text zusätzlich zur Farbe.
5. **Kontrast**: dunkler Grund (ca. `#121218`) mit Text in fast Weiß. Für Grafik mindestens 3:1 (WCAG 1.4.11), für Text 4.5:1. Agent Vitals zielt auf 8:1 für Identitätsfarben.

### 4.2 Bewegung: Blinken, Pulsieren, Häufigkeit
1. **Bewegung ist der stärkste präattentive Reiz** und deshalb **ausschließlich für „braucht dich“** zu verwenden. „Working“ sollte höchstens eine kleine, lokale Animation bekommen (rotierende Punkte, Spinner), **nie die ganze Kachel**. Sonst konkurriert normale Arbeit mit echten Alarmen. Negativbeispiel: etechlead pulsiert bei *running*.
2. **WCAG 2.3.1**: höchstens **3 Flashes pro Sekunde** [V]. Ein Flash ist ein Paar gegenläufiger Luminanzänderungen von ≥ 10 %. Für rote Flashes gilt eine eigene, strengere Schwelle. Ein Stream-Deck-Key ist eine kleine Fläche, trotzdem gilt: unter 3 Hz bleiben, **Ziel 0,5–1,5 Hz**.
3. **Weiches Atmen statt hartem On/Off** (Sinus oder Dreieck, Opazität zwischen ca. 30 und 100 %). Das ist weniger aggressiv und bei gleicher Auffälligkeit weniger ermüdend. Praxiswerte:
   - Agent Vitals: 1,8 s (0,55 Hz)
   - JulienCr: ca. 0,72 s (1,4 Hz) über die ganze Kachel
   - semaphore: 1 Hz
   - GoJS-ISA-Demo: 1 Hz für unquittierte Alarme
   - DTIC-Review zu Leuchtsignalen [V]: zwischen 1 und 4 Flashes pro Sekunde praktisch kein Unterschied in der Auffälligkeit, empfohlen werden ca. 3 pro Sekunde bei 50 % Duty-Cycle für Warnlichter. Für einen Schreibtisch ist das zu aggressiv.
   - **Empfehlung**: ca. 1 Hz Atmen für frische Attention, 2 Hz nur bei Eskalation.
4. **Technische Grenze**: maximal 10 `setImage` pro Sekunde [V]. Eine 1-Hz-Atmung mit 6–8 Frames reicht völlig. Frames vorrendern und cachen, nur geänderte Keys pushen (JulienCr vergleicht dafür `lastSvg`).
5. **WCAG 2.2.2 Pause/Stop/Hide**: Blinken über 5 s sollte stoppbar sein [V]. Konkret heißt das:
   - Blinken **nur in der „frischen“ Phase** (z. B. 30–60 s),
   - danach **statisch** mit dickem farbigem Rahmen und **laufender Wartezeit**,
   - und eine globale „Ruhe“-Option (Snooze, Fokusmodus).
6. **Quittieren** (ISA-18.2-Muster): unquittiert blinkt, quittiert ist ruhig farbig, erledigt ist grau. VibeDeck macht das mit „seen“: Zurückkehren zur Session gilt als Quittung.

### 4.3 Alarm-Fatigue und Habituation
- [V] Bonafide et al. 2015 (Pädiatrie, 5.070 Alarme, 87–99 % nicht handlungsrelevant): Die Reaktionszeit stieg mit der Zahl der nicht handlungsrelevanten Alarme in den 120 Minuten davor. Es handelt sich um eine Assoziation, nicht um einen Kausalnachweis. Ancker et al. 2017: Override-Raten steigen mit der **Anzahl verschiedener** Alerts pro Fall.
- **Folgerungen**:
  - Nur **handlungsrelevante** Zustände dürfen blinken (Permission, Frage, Plan, Fehler).
  - „Fertig“ ist ruhig grün und wird nach dem Ansehen grau.
  - `throttled` und `compacting` signalisieren nie Attention (wie bei JulienCr).
  - Mehrere wartende Sessions **nicht alle gleichzeitig blinken lassen**: nur die **älteste oder wichtigste** atmet, die anderen bleiben statisch farbig. Eine Aggregat-Kachel zeigt die Anzahl.
  - Töne optional und pro Typ abschaltbar (VibeDeck).
  - **Debounce**: Kurze Waiting-Phasen unter ca. 2 s, etwa Auto-Approve durch Regeln, nicht signalisieren [I].

### 4.4 Prioritätsreihenfolge (Vorschlag, aus JulienCr, VibeDeck und Ampel)
1. Permission-Request (blockiert, und eine Approval vom Deck ist möglich)
2. Frage, Elicitation oder Plan-Freigabe
3. Fehler (StopFailure ohne Retry)
4. Turn fertig, noch nicht gesehen („dein Zug“)
5. Throttled oder Rate-Limit (Info)
6. Working, Subagent, Compacting
7. Idle (gesehen)
8. Offline oder veraltet (Prozess tot), grau oder ausgeblendet

**Innerhalb einer Stufe**: **ältestes Warten zuerst**. Der Swarm- bzw. Inbox-Key springt bei jedem Druck zur nächsten Session in dieser Reihenfolge (VibeDeck).

### 4.5 Alterungs-Indikatoren (wie lange wartet die Session schon?)
- VibeDeck zeigt `0:22` bzw. `1:15` als Text auf dem Tile [V]. Sonst macht das niemand.
- **Empfehlung**:
  - Die Wartezeit `m:ss` bzw. `12m` ist immer sichtbar.
  - Zusätzlich ein **Fortschrittsrand**, der sich im Uhrzeigersinn füllt (z. B. voll nach 10 min), oder eine Farbsteigerung von Amber zu Zinnoberrot ab einer Schwelle (z. B. > 5 min).
  - **Eskalationsstufen**: 0–30 s Atmen bei 1 Hz, danach statisch mit dickem Rahmen, nach mehr als N Minuten ein kurzer „Erinnerungs-Puls“ (3 Zyklen) alle 60 s.
  - Das hält die Aufmerksamkeit, ohne dauerhaft zu blinken.

### 4.6 Gauges für 5h- und Weekly-Limit
- **Ring oder Bogen mit großer Prozentzahl** in der Mitte (saeedkolivand) oder ein **horizontaler Balken mit Zahl** (Agent Vitals, Claude Deck). Auf 72 px ist ein dicker Ring (≥ 10 px bei 144) gut lesbar. Darunter steht der Reset-Countdown (`2h14m` bzw. `Fr 09:00`).
- **Schwellen**: grün unter 60, amber 60–85, rot ab 85 (Agent Vitals) bzw. 50/80 (saeedkolivand). Die Schwellen konfigurierbar machen.
- **Pace-Marker** (Lücke bei allen Konkurrenten außer Claude Deck „projected“):
  - Auf dem Ring zeigt eine Markierung, **wo man bei linearem Verbrauch jetzt stehen dürfte** (Anteil der verstrichenen Fensterzeit).
  - Steht der Verbrauch vor dem Marker, verbraucht man zu schnell.
  - Dazu „voll in ≈ 1h40“ aus der Burn-Rate.
  - Damit wird der Key von einer reinen Anzeige zu einer Entscheidungshilfe.
- **Bewegung bei Limits** nur einmalig beim Überschreiten der Rot-Schwelle (saeedkolivand) oder ab 90 % (Agent Vitals). **Nie dauerhaft**, denn Limits sind kein akuter Handlungsbedarf.
- Eine **Kombi-Kachel** (5h-Ring außen, Weekly innen, oder zwei Halbbögen) spart Keys [I].

### 4.7 Layout und Typografie
- Ein einheitliches Gerüst auf allen Keys (Agent Vitals):
  - **Kopfzeile**: Glyph + Zustandswort, 17–19 px auf 144
  - **Mitte**: Hauptinfo, Projekt- oder Session-Name, 22–25 px fett
  - **Fußzeile**: Wartezeit, Tool, Host, 13–17 px
- Auf 72-px-Geräten wirkt alles unter ca. 13 px (bei 144) unleserlich [I].
- Texte vermessen und mit „…“ kürzen, statt sie abzuschneiden. Lange Session-Namen als Marquee nur bei Bedarf (JulienCr).
- **Host-Kennung** als kleines Eck-Badge (`WSL`, `WIN`, `MAC`), farbneutral, damit keine Zustandsfarbe verbraucht wird.
- **Band für „verlässt das Deck“** (Agent Vitals): Keys mit Seiteneffekt optisch von reinen Anzeige-Keys trennen.

---

## 5. Lücken und Chancen für unser Produkt

1. **Multi-Host-Aggregation über WSL, Windows und Remote-Mac.** Das bietet niemand.
   - [I] Architektur: ein schlanker „Reporter“ pro Host. Er liest `~/.claude/sessions/*.json` (Status, Name, `waitingFor`, `hostSessionId`) und empfängt HTTP-Hooks. Per HTTP oder WebSocket meldet er an das Plugin auf Windows. Für den Mac kommt Tailscale, LAN mit mTLS oder Token, oder ein SSH-Tunnel in Frage.
   - Mit `networkingMode=mirrored` erreicht WSL den Windows-Loopback direkt über `127.0.0.1`. Ein HTTP-Hook aus WSL kann das Plugin also ohne Umweg treffen [I, zu verifizieren]. JulienCrs Ansatz mit UNC-Pfad und `wsl.exe kill -0` ist die Fallback-Variante ohne Reporter.
2. **Desktop-App-Sessions (Code-Tab) als Bürger erster Klasse.**
   - Sie schreiben Status in die Session-Dateien [V, lokal], und Hooks feuern dort ebenfalls [V]. Agent Vitals und JulienCr ignorieren sie oder behandeln sie nur als „no status“.
   - Beim Jump gilt [?]: Für bestehende Code-Sessions gibt es keinen dokumentierten Deep Link. Zu prüfen sind undokumentierte `claude://`-Pfade mit `hostSessionId`. Als Fallback das Desktop-Fenster fokussieren und den Session-Namen anzeigen. **Bei Erfolg wäre das ein Alleinstellungsmerkmal**, weil VibeDeck das nur auf macOS kann.
3. **Jump unter Windows Terminal und WSL**, ein von allen schwach gelöster Punkt:
   - VibeDeck: nur Windows Terminal x64, WSL unklar.
   - Agent Vitals: Titel-Teilstring.
   - JulienCr: nur Warp.
   - [I] Optionen: Session-Marker im Tab-Titel, gesetzt über `terminalSequence` aus dem SessionStart-Hook (zu verifizieren) oder einen Shell-Wrapper. Dann über UI Automation oder `wt -w 0 focus-tab` gezielt fokussieren. tmux in WSL als „Gold-Pfad“ anbieten (VibeDeck bestätigt, dass tmux der zuverlässigste Weg ist).
   - Remote-Mac: per SSH `tmux select-pane` bzw. AppleScript auf dem Mac. Den Fokus auf dem Windows-Bildschirm erhält das lokale Terminal mit der SSH-Verbindung.
4. **Approvals über alle Hosts.**
   - Das HTTP-PermissionRequest-Muster von Agent Vitals (Secret, Hold, Deny-Sperre, `sanitizeSuggestions`) ist der richtige Ansatz [V]. Zu erweitern ist es auf entfernte Hosts (Secret plus TLS bzw. Tailnet).
   - Approval-Kacheln sollen **Tool + Kurzbefehl + Projekt** zeigen, wie VibeDeck mit „Bash / npm test / api“.
   - Ein wichtiger Unterschied zu Agent Vitals: Agent Vitals hat einen globalen Allow/Deny-Key, wir sollten Approval **pro Session-Key** anbieten.
5. **Offizielle Limit-Quelle**: die Statusline-Daten `rate_limits` statt nur des undokumentierten Endpoints. Robuster und ToS-freundlicher [I]. Der Endpoint bleibt als Fallback, solange keine Session läuft. Das wäre ein **Pace-Marker-Gauge**, den es so nirgends gibt.
6. **Kosten**: `cost.total_cost_usd` pro Session aus der Statusline [V]. Klar als „API-Äquivalent, Schätzung“ beschriften, weil das bei Pro und Max keine echte Rechnung ist.
7. **Attention-UX über dem Marktniveau**:
   - Gesehen und quittiert (wie VibeDeck)
   - **Wartezeit plus Alterungsring** (sonst nur VibeDeck als Text)
   - **Atmen nur bei der wichtigsten oder ältesten Session**, mit Eskalation nach Zeit
   - Snooze und Fokusmodus
   - farbenblind-sicheres Glyph-System (wie Agent Vitals)
   - Inbox- bzw. Swarm-Key mit Sprung-Reihenfolge nach Priorität und Alter
8. **Robustheit als Feature**, denn die Changelogs der Konkurrenz zeigen, dass hängende Karten und falsche Zustände der Hauptschmerz sind:
   - Liveness über `pid` und `procStart` sowie `pidDomain`
   - TTL und „stale“-Zustand (cskwork, VibeDeck)
   - Setup- und Health-Key, der fehlende Hooks anzeigt (JulienCr)
   - Hook-Installation mit Vorschau, Backup und sauberem Uninstall (VibeDeck)
   - Hooks nie stillschweigend in `settings.json` schreiben (Agent Vitals lässt den Nutzer den Snippet selbst einfügen)
9. **Positionierung**:
   - Kostenlos und Open Source (MIT oder Apache-2.0) neben Agent Vitals, aber mit **Windows/WSL-first, Multi-Host und Desktop-Sessions** als Differenzierung.
   - Keine AGPL-Assets übernehmen (Clawd bei JulienCr).
   - Den Namen „Claude“ nicht als Marke führen, sondern als „for Claude Code“ beschreiben (alle Konkurrenten betonen „unofficial“).
10. **Datenschutz**: Prompt-Text nur optional anzeigen, standardmäßig Projekt, Tool und Zustand (Prinzip von cskwork). Keine Telemetrie (Agent Vitals PRIVACY.md).

---

## 6. Quellen

**Produkte und Repos**
- VibeDeck: https://getvibedeck.com, https://getvibedeck.com/terminals, https://getvibedeck.com/sessions, https://getvibedeck.com/compatibility, https://getvibedeck.com/changelog, https://getvibedeck.com/assets/vibedeck-showcase-v7-1.0.4.0.txt, https://www.producthunt.com/products/vibedeck-stream-deck-control-for-agents
- Agent Vitals: https://github.com/tapparello/agent-vitals (README, HANDOFF.md, src/keyart.js, src/plugin.js, src/approve.js), https://notes.nicolasdeville.com/helpers/agent-vitals/
- JulienCr: https://github.com/JulienCr/streamdeck-claude, docs/architecture.md, docs/warp-focus.md, src/icons/{theme,states,render,motifs}.ts
- https://github.com/etechlead/claude-deck
- https://github.com/cskwork/streamdeck-agent-cockpit
- https://github.com/appaquet/ccmon
- https://github.com/verygoodplugins/streamdeck-mcp
- https://github.com/saeedkolivand/claude-usage-streamdeck-plugin
- Claude Deck (Cut/daily): https://notes.nicolasdeville.com/helpers/claude-deck/
- AgentDeck: https://github.com/puritysb/AgentDeck, https://hashout.jp/ai/2290/
- Elgato-Explorer-Artikel: https://www.elgato.com/us/en/explorer/products/stream-deck/control-claude-with-stream-deck-for-faster-workflows/
- Lichter und Menüleiste: https://github.com/artemy/semaphore, https://pypi.org/project/cclight/, https://hunted.space/product/ampel, https://github.com/fr1j0/hive-light, https://github.com/m1ckc3s/claude-status-bar, https://github.com/mattdotbuild/claude-usage-tray, https://github.com/ksmaster03/claude-usage-tray

**Claude Code und Stream Deck (Plattform)**
- Hooks: https://code.claude.com/docs/en/hooks
- Statusline: https://code.claude.com/docs/en/statusline
- Deep Links CLI: https://code.claude.com/docs/en/deep-links
- Desktop (SSH, WSL, Links, Benachrichtigungen): https://code.claude.com/docs/en/desktop
- Desktop-Links: https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link
- Elgato Images & Layouts (Größen, max. 10 Updates/s): https://docs.elgato.com/guidelines/streamdeck/plugins/images-and-layouts

**Wahrnehmung und Alarm-Design**
- WCAG 2.3.1 Three Flashes: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- WCAG 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- ISA-101 Graustufen-HMI (sekundär): https://control.com/technical-articles/going-gray/, https://gojs.net/latest/samples/hmiOperatorScreen
- Flash-Frequenz und Auffälligkeit (DTIC-Review): https://apps.dtic.mil/sti/html/tr/ADA221924/index.html
- Alarm-Fatigue: Bonafide et al. 2015 https://psnet.ahrq.gov/issue/association-between-exposure-nonactionable-physiologic-monitor-alarms-and-response-time, Ancker et al. 2017 https://psnet.ahrq.gov/issue/effects-workload-work-complexity-and-repeated-alerts-alert-fatigue-clinical-decision-support
- Okabe-Ito-Palette: https://siegal.bio.nyu.edu/color-palette/, https://conceptviz.app/blog/okabe-ito-palette-hex-codes-complete-reference

**Lokale Verifikation (nur lesend)**
- `\\wsl.localhost\Ubuntu\home\heinrich\.claude\sessions\*.json` (611 Dateien; Felder und Statuswerte ausgezählt, `.key`-Dateien nicht gelesen)
- `%USERPROFILE%\.claude\sessions\*.json`
