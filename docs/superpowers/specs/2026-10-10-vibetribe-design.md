# VibeTribe – Design-Spezifikation (v1)

- **Stand:** 2026-10-18, Revision 12 (Plan 14: Marketplace-Veröffentlichung; Einrichtung der Hooks aus dem Property Inspector, Kopie von Stream Decks Node als Hook-Laufzeit, WSL per Klick, Standard-Distribution statt `Ubuntu`, Paket über `pnpm plugin:pack`; §2.1, §2.2, §3.1, §4.1, §6.2, §8.1, §8.2, §8.4, §10, §12, §13); Revision 11 (Plan 13: Drift-Prüfungen `pnpm drift`, stündliche Selbstprüfung der Zentrale, Live-Test `pnpm e2e:live` auf Haiku als einzige Ausnahme von „kein Modellaufruf“, §10, §11.3); Revision 10 (Plan 12: gesehen, wenn die Session in Claude Desktop geöffnet wird, eigene Inbox-Sprünge zählen nicht, §4.4, §4.8, §6.2, §9, §10); Revision 9 (Plan 11: angepinnte Sessions aus Claude Desktop §4.7, Property Inspector der Slot-Aktion §6.2, Vorrang angepinnter Sessions in der Slot-Zuordnung §6.3, §10, Spalte „Pin“ §11.1); Revision 8 (gelesene REM-Eingabe ist ruhig, §4.3); Revision 7 (Plan 10: Port-Datei als zweiter Vertrag §3.1, Ziel des Reporters §8.1, Ersatzports, neuer Bind-Versuch und Port-Datei §8.2, §8.4, §10, §11.1, keine Handler-Prüfung §9); Revision 6 (Plan 8: `review_ready` als Done §4.3, REM nach einem Neustart §4.5, `background.json` mit 30-s-Abstand und nur mit Listener §4.6, „Open…“ 2,5 s und Handler-Ursache im Log §9); Revision 5 (Plan 7: Herkunft nach Host, Slots für Alarme, `+N`, Hintergrund-Jobs über Neustarts, Extra-Taste; §4.1, §4.5, §4.6, §6.2, §6.3, §9; Done counts as attention (user decision 2026-10-14): §5, §6.3, §12; Handoff v2, Done atmet nicht (R11), Rahmen-Einzug (R12): §5, §12); Revision 4 (Plan 6: Claude-Design-Handoff, §5, §6, §12); Revision 3 (Proben-Ergebnisse aus Plan 1, `docs/research/probes/`); Revision 2: Review durch Claude Fable
- **Status:** Entwurf zur Freigabe
- **Repo:** `h-mergel/vibetribe` (öffentlich), lokal `~/dev/projects/vibetribe`
- **Recherche:** [`docs/research/2026-10-10-competitors.md`](../../research/2026-10-10-competitors.md), [`docs/research/2026-10-10-technical.md`](../../research/2026-10-10-technical.md)

## 1. Ziel

VibeTribe ist ein Stream-Deck-Plugin, das alle laufenden Claude-Code-Sessions eines Entwicklers auf einem Deck zusammenführt. Ein Blick zeigt, welche Session Aufmerksamkeit braucht und seit wann. Ein Tastendruck springt direkt in diese Session. Daneben sind die Nutzungslimits (5h, Woche) und der Extra-Usage-Verbrauch ständig sichtbar.

Zuerst ist es ein eigenes Tool für das Setup des Autors. Code und Doku sind aber so sauber, dass es später ohne Umbau Open Source bzw. ein Produkt werden kann.

### 1.1 Zielumgebung (v1)

| Bereich | Ausprägung |
|---|---|
| Deck | Stream Deck MK.2, 15 Tasten (5×3), 72×72 px; Stream-Deck-App 7.6 unter Windows 11 |
| Claude-Sessions | nativ unter Windows; in WSL2 (Ubuntu, `networkingMode=mirrored`); im Code-Tab von Claude Desktop (läuft teils in WSL); auf einem MacBook, gesteuert per Remote Control über Claude Desktop oder claude.ai |
| Abrechnung | Max/Pro-Abo plus Extra Usage |
| Netz Mac ↔ Windows | Tailscale (nicht umgesetzt, Plan 5); Remote-Sessions kommen heute über die Session-Liste des Kontos (ADR 0006) |

Beobachtung auf dem Zielrechner: Fast alle Sessions laufen über Claude Desktop (`entrypoint=claude-desktop`; WSL: 610 von 611, Windows: 3 von 3). Das Design muss deshalb auch ohne Terminal-Statusline voll funktionieren.

### 1.2 Erfolgskriterien

1. Ein Blick aufs Deck zeigt in unter einer Sekunde, welche Session dich braucht und wie lange schon.
2. Ein Druck auf eine Session-Taste landet in der richtigen Session: dem richtigen Windows-Terminal-Tab, der richtigen Desktop-Session bzw. der richtigen Remote-Control-Session.
3. 5h-Limit, Wochenlimit und Extra Usage sind sichtbar oder eindeutig als veraltet markiert.
4. Keine „Leichen“: Beendete oder abgestürzte Sessions verschwinden zuverlässig. Veraltete Session-Dateien werden nie als aktiv angezeigt.
5. Ist das Deck oder das Plugin aus, merkt Claude Code nichts davon. Auch bei laufendem Plugin bremsen die Hooks Claude nicht spürbar: nichts blockiert pro Tool-Aufruf.

## 2. Umfang

### 2.1 In v1

- Anzeige der Zustände aller Sessions (Windows, WSL, Desktop, Mac) mit Eskalation der Aufmerksamkeit
- Anzeige laufender Hintergrund-Jobs (Shell, Agents, Monitore) auch bei fertigen Durchgängen
- Sprung zur Session, plus „gesehen“-Quittung
- 5h- und Wochenlimit mit Tempo-Markierung, Extra-Usage-Credits
- Setup-Befehl für Hooks und Statusline auf Windows, in WSL und auf dem Mac (Mac nicht umgesetzt, Plan 5); unter Windows und in WSL auch per Klick im Property Inspector (§8.4)
- Kostenloser Eintrag im Elgato Marketplace (Plan 14, ADR 0011)
- Mac-Agent als launchd-Dienst (lokales Relais und Lebenszeichen) (nicht umgesetzt, Plan 5)
- Debug-Seite, Debug-JSON, Simulator, PNG-Galerie aller Kacheln

### 2.2 Bewusst nicht in v1

- Freigaben (Allow/Deny) und Antworten auf Rückfragen am Deck
- Sessions vom Deck aus starten
- VS Code (Panel und integriertes Terminal)
- Andere Agents als Claude Code
- Sounds
- Stream Deck +, XL und andere Geräte (sie funktionieren voraussichtlich, werden aber nicht gezielt gestaltet)
- Geschätzte API-Kosten pro Session („Kosten“ bedeutet in v1 die verbrauchten Extra-Usage-Credits)

## 3. Architektur

Ansatz B: ein Neubau, bei dem das Plugin selbst die Zentrale ist. Es gibt keinen eigenen Hintergrunddienst unter Windows, denn die Stream-Deck-App startet das Plugin ohnehin. Von Agent Vitals (MIT) werden Ideen übernommen, aber kein Code.

pnpm-Workspace, TypeScript, Node 24:

| Paket | Aufgabe | Abhängigkeiten |
|---|---|---|
| `packages/core` | Zustandsmodell: Events → Sessions, Priorität, Episoden und „gesehen“, Eskalation, Lebenszeichen, Slot-Zuordnung, Limit-Modell, Animationsbudget. Reine Logik mit injizierbarer Uhr. | keine Laufzeit-Abhängigkeiten |
| `packages/render` | `Kachelmodell → SVG` (144×144). Reine Funktionen, mit PNG-Export für Tests und Galerie (resvg). | `core` (Typen und reine Hilfsfunktionen wie `formatWait`, `breathLevel`) |
| `packages/plugin` | Stream-Deck-Plugin (SDK v3, `@elgato/streamdeck` 3.x). Enthält die Zentrale: HTTP-Server, Leser für Session-Dateien, Abfrage des Usage-Endpunkts, Sprung-Logik, Debug-Seite. | `core`, `render` |
| `packages/reporter` | Ein Node-Skript ohne Abhängigkeiten (als einzelne Datei gebündelt), Rollen: Hook-Befehl, Statusline-Weiche und der Befehl `setup`. Mac-Agent (`agent`) und `simulate` (nicht umgesetzt, Plan 5); der Simulator ist heute `pnpm hub:simulate`. | keine |

Die Grenzen sind so gezogen, dass `core` später ohne Umbau in einen eigenständigen Dienst wandern kann (Ansatz C).

### 3.1 Architekturprinzipien

VibeTribe ist kein Bastelprojekt. Die Prinzipien werden pragmatisch angewendet, „wo sinnvoll“, nicht als Selbstzweck.

**Struktur: Ports & Adapters**
- `core` ist die Domäne: reine Funktionen und Klassen, kein I/O, keine Uhr (Zeit kommt als Parameter), keine Stream-Deck-, HTTP- oder Dateisystem-Abhängigkeit.
- Alles Äußere ist ein **Adapter hinter einem schmalen Interface (Port)**, das dort definiert wird, wo es gebraucht wird (im Plugin):
  - `EventIngress` (HTTP)
  - `SessionFileSource` (Windows-, WSL-Leser, Mac-Lebenszeichen)
  - `UsageClient`
  - `Jumper` (je Herkunft)
  - `DeckSurface` (`setImage`, Tasten)
  - `Clock`
  - `Logger`
- Abhängigkeiten zeigen nur nach innen: `plugin → render → core`. Der Reporter ist eigenständig; nur `@vibetribe/reporter/setup` darf das Plugin einbinden (`plugin → reporter`, ADR 0011). Das Event-Format (Hülle §8.3) und seit Plan 10 die Port-Datei der Zentrale (§8.2) sind die einzigen gemeinsamen Verträge zwischen Reporter und Zentrale; beide werden im kleinen Paket `packages/protocol` (Typen + Validierung) genau einmal definiert.
- Eine einzige **Composition Root** im Plugin erzeugt und verdrahtet alle Adapter per Konstruktor-Injektion. Keine globalen Singletons, kein DI-Framework.

**SOLID, pragmatisch**
- **S:** eine Verantwortung pro Modul (Richtwert < 300 Zeilen pro Datei).
- **O:** Neue Quellen oder Sprungziele sind neue Adapter; `core` bleibt unverändert.
- **L/I:** Schmale Interfaces statt Klassenhierarchien; keine Vererbung zur Wiederverwendung.
- **D:** Domänenlogik hängt nur von Interfaces ab, nie von konkreten Adaptern.

**KISS und YAGNI**
- Keine Frameworks, wo die Standardbibliothek reicht: `node:http` statt Express, eigene kleine Validierung statt Schema-Bibliothek, solange das Format klein bleibt.
- Keine spekulativen Erweiterungspunkte: kein generisches Plugin-System, keine Mehr-Agenten-Abstraktion, keine Konfigurationsoptionen ohne Anwendungsfall in v1.
- Neue Abhängigkeiten nur mit Begründung.

**Grenzen und Fehler**
- Jede externe Eingabe (HTTP-Body, Session-Datei, Usage-Antwort, Settings) wird am Adapter validiert und in getypte Werte übersetzt. `core` vertraut seinen Typen.
- Adapter werfen nicht in `core` hinein. Fehler werden zu Gesundheitszuständen (Status-Kachel) und Log-Einträgen.

**Qualitäts-Gates**
- TDD für jede Verhaltensänderung.
- Testpyramide: Unit-Tests für `core` und `render`; Vertragstests der Adapter gegen Fixtures (z. B. aufgezeichnete Hook-Payloads aus den Proben); wenige End-to-End-Tests über den Simulator.
- `pnpm check` (Biome, TypeScript strict, vitest) lokal und in GitHub Actions bei jedem Push/PR.
- Conventional Commits; jeder Plan-Task wird vor dem nächsten reviewt.
- Architekturentscheidungen werden als kurze ADRs unter `docs/adr/` festgehalten.

## 4. Zustandsmodell

### 4.1 Session-Identität und Herkunft

- Eine Session ist eindeutig durch `(host, sessionId)` bestimmt. `sessionId` ist die `session_id` aus dem Hook-Payload bzw. `sessionId` aus der Session-Datei.
- Hook-Payloads enthalten **keine** PID und keinen `entrypoint`, die **Hook-Umgebung aber schon** (Probe C2): `CLAUDE_PID`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_HOST_SESSION_ID` (Desktop-ID `local_…`), `CLAUDE_CODE_SESSION_ID`. Der Reporter sendet diese Werte in der Hülle mit (§8.3).
- Die Zentrale verknüpft Hook-Events zusätzlich über `sessionId` mit der Session-Datei desselben Hosts. Die Hook-`session_id` ist laut Probe B6 identisch mit `sessionId` der Datei. Aus der Datei stammen `procStart`, `name` (Desktop-Titel), `bridgeSessionId`, `status` und `waitingFor`. Bei Widersprüchen gewinnt die Datei.
- Das Herkunfts-Abzeichen sagt, **wo** eine Session läuft, nicht wie sie gestartet wurde (Plan 7: Der Nutzer startet fast alles aus Claude Desktop, auch Sessions in WSL). Es folgt allein der Art des Hosts. Der `entrypoint` bestimmt nur den Sprunglink (§9).

| Abzeichen | Bedingung |
|---|---|
| `WIN` | Host ist Windows nativ (Session-Datei unter `%USERPROFILE%\.claude\sessions` bzw. Reporter mit `os = windows`), egal ob CLI oder Claude Desktop |
| `WSL` | Host ist WSL, egal ob CLI oder Claude Desktop |
| `REM` | Session auf einem anderen Rechner: aus der Remote-Liste des Kontos (§4.3); Hook-Events eines Reporters auf einem Mac zählen ebenfalls dazu |

- Eine nur aus Hooks bekannte Session kennt ihren Host aus dem `os` des Reporters und zeigt sofort das passende Abzeichen.
- Der Simulator (`pnpm hub:simulate`, Host `sim`) zeigt das Abzeichen des `os`, das seine Szenarien angeben.
- `?` erscheint auf der Kachel nur noch, wenn ein Modell kein Abzeichen trägt (Renderer-Ersatz). `APP` gibt es nur noch in den festen Beispielmodellen des Handoffs.

### 4.2 Zustände

Die Tabelle ist nach Priorität absteigend sortiert. Die höchste zutreffende gewinnt.

| # | Zustand (`state`) | Auslöser | Verlassen durch |
|---|---|---|---|
| 1 | `needs_permission` | `PermissionRequest`; `Notification` mit `notification_type=permission_prompt`; Session-Datei `status=waiting` mit `waitingFor` ∈ {`permission prompt`, `sandbox request`} | `PostToolUse` oder `PostToolUseFailure` desselben Tools (`tool_use_id`, ersatzweise `tool_name`); `Stop`, `StopFailure`, `UserPromptSubmit`, `SessionEnd`; Session-Datei wechselt von `waiting` auf `busy` oder `idle` mit `statusUpdatedAt` > `episode.since` |
| 2 | `needs_input` | `Elicitation`; `Notification` mit `elicitation_dialog`, `elicitation_url_dialog` oder `agent_needs_input`; `PreToolUse` für das Rückfragen-Tool (AskUserQuestion) bzw. die Plan-Freigabe (ExitPlanMode); Session-Datei `status=waiting` mit anderem `waitingFor` (`input needed`, `worker request`, `dialog open`, …) | wie 1, außerdem `ElicitationResult` |
| 3 | `error` | `StopFailure` mit `error` ∈ {`authentication_failed`, `billing_error`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown`} | `UserPromptSubmit`, `PreToolUse`, `Stop`, `SessionEnd`; Session-Datei `busy` mit `statusUpdatedAt` neuer als der Fehler |
| 4 | `done_unseen` | `Stop`, solange die Session nicht als gesehen markiert ist | „gesehen“ (siehe 4.4), `UserPromptSubmit` |
| 5 | `throttled` | `StopFailure` mit `error` ∈ {`rate_limit`, `overloaded`}; `Notification` `quota_auto_resume_*`, die ein Warten ankündigt | wie `error`; zusätzlich `Notification quota_auto_resume_fired` |
| 6 | `working` | `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `PreCompact`; Session-Datei `status=busy` | `Stop`, `StopFailure`, Wartezustände; Session-Datei `status=idle` mit `statusUpdatedAt` neuer als das letzte Hook-Event (deckt den Abbruch per Esc ab, bei dem kein `Stop` feuert) |
| 7 | `background` | Durchgang beendet und gesehen (bzw. ohne Episode), aber `background.count > 0` (siehe 4.6) | `background.count` fällt auf 0 → `idle`; `UserPromptSubmit` → `working` |
| 8 | `idle` | `done_unseen` wurde gesehen und kein Hintergrund läuft; `SessionStart` ohne weitere Aktivität; Abbruch (siehe `working`) | `UserPromptSubmit`; `background.count > 0` → `background` |
| 9 | `no_signal` | nur entfernte Sessions (`REM`): Remote-Liste bzw. Lebenszeichen fehlt (siehe 4.3) | eine neue gültige Liste, ein Event oder Lebenszeichen; nach 210 s ohne Signal (90 s `no_signal` plus 2 min) wird die Session entfernt |

**Details zu den Zuständen**
- **Detailzeile bei `working`:** das letzte Tool aus `PreToolUse.tool_name`, „Subagent“ (`SubagentStart`/`SubagentStop` mitgezählt) oder „Kompaktiert“ (`PreCompact`).
- **Parallele Wartegründe:** Die Zentrale führt pro Session eine Menge offener Wartegründe, Schlüssel ist `tool_use_id` (bzw. `agent_id` + `tool_name`, falls keine ID vorhanden). Ein Wartezustand endet erst, wenn die Menge leer ist. So löscht das `PreToolUse` eines parallel laufenden Subagents keine noch offene Freigabe. `PreToolUse` beendet nie einen Wartezustand.

**Normalisierung der Roh-Hooks (Proben B, M)**
- **`PermissionRequest`** trägt keine `tool_use_id`, wohl aber `tool_name` und, bei Subagents, `agent_id`. Es wird zu `wait_start` mit `waitId: null`, `toolName`, `agentId`.
  - `reason: input` bei `tool_name` ∈ {`AskUserQuestion`, `ExitPlanMode`}, sonst `permission`.
- **`Notification permission_prompt`** kommt etwa 8 s nach `PermissionRequest`, ohne `agent_id`. Ein anonymer Wartegrund entsteht nur, wenn noch keiner offen ist. Sonst wird das Event als Duplikat verworfen.
- **Ablehnen einer Freigabe, Stoppen und Ablehnen eines Plans erzeugen in Claude Desktop kein Hook-Event**, weder `PostToolUseFailure` noch `Stop`. Das Ende dieser Zustände kommt **ausschließlich** über den Statuswechsel der Session-Datei (`waiting`/`busy` → `idle`). Bekannte Sessions in `waiting` oder `busy` werden deshalb alle 1–2 s gelesen, statt alle 5 s.
- **Automatische Durchgänge** (§4.5) erkennt der Reporter am Prompt-Anfang: `<task-notification>` (beendeter Hintergrund-Job) oder `Another Claude session sent a message:` (Nachricht einer anderen Session). Er sendet nur `auto: true`, nie den Text.

**Grundsätze**
- `no_signal` überlagert alle anderen Zustände: Ohne Lebenszeichen sind die übrigen Daten veraltet. Die Prioritätsnummer 9 gilt nur für die Sortierung in Inbox und Überlauf.
- Hooks liefern Zustandswechsel ereignisgetrieben. Session-Dateien liefern Wiederherstellung (z. B. nach einem Plugin-Neustart), Metadaten und das Lebenszeichen.
- Eine bloße `busy`-Meldung ohne vorheriges `waiting` beendet keinen Wartezustand. Claude meldet nämlich auch beim Warten weiterhin `busy`. Ein beobachteter Übergang `waiting → busy|idle` beendet ihn dagegen.
- **Zeit:** Die Zentrale stempelt jeden Eingang mit ihrer eigenen Uhr (`receivedAt`). Vergleiche zwischen Hosts, `episode.since` und alle Zeitfenster nutzen `receivedAt`. Den Zeitstempel des Senders (`ts`) nutzt sie nur, um Events innerhalb einer Session zu ordnen. So stört ein Uhrenversatz zwischen Mac und Windows nicht.

### 4.3 Lebenszeichen (gegen Leichen)

**Lokal (Windows, WSL)**
- Eine Session gilt nur, wenn die PID existiert **und** ihre Prozess-Startzeit zu `procStart` passt. Das erkennt wiederverwendete PIDs.
- Ist die PID tot oder passt die Startzeit nicht, wird die Session **sofort** entfernt. Lokal gibt es kein `no_signal`.
- **Abfrage-Intervall:** alle 5 s; bekannte Sessions in `waiting` oder `busy` alle 1–2 s, weil Ablehnen und Stoppen nur über die Datei sichtbar werden (§4.2). Aus der Session-Datei vollständig gelesen werden nur Dateien, deren mtime jünger ist als der letzte Durchlauf, sowie bekannte Sessions. Die Ordner enthalten Hunderte Leichen, gelesen werden nur Dateien mit lebender PID.
- **Windows:**
  - Ob ein Prozess existiert, prüft `process.kill(pid, 0)`.
  - Die Startzeit (`procStart` = FILETIME, 100 ns seit 1601; exakt gleich `Win32_Process.CreationDate`, Probe G) wird nur für neue oder geänderte PIDs geprüft, gebündelt über **einen dauerhaft laufenden** PowerShell-Kindprozess.
  - Ein Aufruf pro Abfrage kostet etwa 1,4 s und kommt nicht in Frage. `wmic` existiert in Windows 11 24H2+ nicht mehr.
- **WSL:**
  - Abgefragt wird nur, wenn `wsl.exe -l --running` die konfigurierte Distro listet (Zwischenspeicher 5 s). So startet das Plugin eine gestoppte Distro nie und hält sie nicht wach.
  - Konfigurierbar sind die Distribution (Standard: die Standard-Distribution aus `wsl.exe -l -v`; `VIBETRIBE_WSL_DISTRO` überschreibt sie, `none` schaltet WSL ab) und der Linux-Benutzer (Standard: per `wsl.exe -d <distro> whoami` ermittelt).
  - Die Startzeit kommt aus `\\wsl.localhost\<distro>\proc\<pid>\stat`, Feld 22 (in Clock-Ticks seit dem Systemstart), und wird mit `procStart` verglichen.
- `SessionEnd` entfernt eine Session sofort. Bei `reason` ∈ {`clear`, `resume`} bleibt ihr Slot reserviert (siehe 6.3). Events, die bis zu 60 s nach `SessionEnd` für dieselbe Session eintreffen (späte asynchrone Hooks), werden ignoriert.
- Sessions, die nur aus Hooks bekannt sind (keine Session-Datei verknüpft), werden nach 30 min ohne Event entfernt.

**Entfernt: Remote-Liste des Kontos (Plan 3d, Probe J2)**
- Die Zentrale fragt `GET https://api.anthropic.com/v1/code/sessions?limit=50` ab, mit demselben OAuth-Token wie den Usage-Endpunkt (§7.1: nur lesend, Anmeldedatei mit dem spätesten `expiresAt`). Header: `Authorization: Bearer …`, `anthropic-beta: oauth-2025-04-20`, `anthropic-version: 2023-06-01`, `User-Agent: claude-code/<Version>`. Ohne gültigen Token wird nicht abgefragt.
- **Intervall:** alle 20 s (Messung: Plan 3d Task 1, Probe J2b: 15 Abfragen im 20-s-Takt, alle 200, kein 429). Bei 429, 5xx, Netzfehler, unerwarteter Antwort oder 401 verdoppelt sich die Pause bis höchstens 5 min; eine gültige Antwort oder ein neuer Token (`expiresAt` geändert) setzt sie zurück.
- **Ids:** Die API liefert `cse_<X>`, lokale Session-Dateien tragen `session_<X>` (Probe J2c: dieselbe Session unter anderem Tag). Der Client akzeptiert beide Formen (`^(cse|session)_[A-Za-z0-9]{1,64}$`) und führt sie auf `session_<X>` zurück; `RemoteSession.id` hat immer diese Form. Alles Weitere (Abgleich mit lokalen `bridgeSessionId`s, Sprunglink `claude://claude.ai/code/session_<X>`) arbeitet nur damit. Andere Präfixe oder Zeichen: Eintrag ignoriert.
- **Angezeigt** werden Sessions mit `environment_kind = bridge` (Remote Control) und Einträge ohne das Feld; andere Arten (z. B. Cloud-Sessions) nur, wenn die Konstante `REMOTE_ENVIRONMENT_KINDS` auf `"all"` steht.
- **Lokal vor remote:** Eine Session ist remote nur, solange keine lokale Session-Datei dieselbe `bridgeSessionId` trägt oder innerhalb der letzten 120 s getragen hat. Die letzte Liste wird gemerkt und bei jeder Änderung der lokalen `bridgeSessionId`s neu angewendet (ohne als Lebenszeichen der Remote-Quelle zu zählen): Beim Start kann eine Desktop-Session mit Remote Control für etwa 1–2 s doppelt erscheinen, bis der erste Windows-Scan eintrifft; danach nie mehr doppelt. Eine beendete lokale Session hinterlässt keinen REM-Geist.
- **Die Liste ist maßgeblich:** Eine Session, die fehlt oder nicht `connection_status = connected` ist, wird entfernt; `status = archived` wird ignoriert. `disconnected` entspricht lokal einer toten PID: Die Liste behält getrennte Sessions tagelang (Probe J2: 23 Sessions, 3 verbunden), und `no_signal` bleibt dem Ausfall der Quelle selbst vorbehalten.
- **Zuordnung** (tolerant; unbekannte oder fehlende Felder führen nie zum Absturz):

| Beobachtet | Zustand |
|---|---|
| `status_bucket = blocked` oder `external_metadata.post_turn_summary.status_category = need_input` (diese nur, wenn `worker_status` nicht `running` ist) | `needs_input` (Freigabe und Frage sind nicht unterscheidbar), solange `unread` nicht `false` ist; gelesen und mit ruhendem Worker (`worker_status` fehlt oder `idle`) ist die Session `idle`: Die Zusammenfassung stuft auch Angebote („Sag bereit, dann …“) als Eingabe ein, und wer den Durchgang gelesen hat, weiß, was ansteht (Nutzerentscheidung 2026-10-16) |
| `worker_status` vorhanden und ≠ `idle` | `working` |
| `status_bucket` oder `status_category` = `completed` oder `review_ready` und `unread = true` | `done_unseen` – einmal je Durchgang (siehe unten). `review_ready`: Sonde 2026-10-14, eine verbundene, untätige Session mit diesem Bucket und dieser Kategorie. Endet der Durchgang mit einer Frage (`need_input`), gilt die erste Zeile: Eine Frage ist Input |
| eine Session, die fertig und ungelesen war, ist jetzt `idle` und gelesen; oder eine, die wartete, ist jetzt `idle` | gesehen (auf einem anderen Gerät gelesen); wartet oder arbeitet sie, bleibt die neue Episode ungesehen |
| sonst | `idle` |

- **Durchgänge** merkt sich die Zentrale je Session mit ihrem `last_event_at`, auch während die Session fehlt (bis 24 h): Ein am Deck gesehener Durchgang kommt nach einem kurzen Verbindungsabbruch nicht zurück; ein ungesehener schon. Ein bereits gemeldeter Durchgang wird nur dann erneut als fertig gemeldet, wenn sich `last_event_at` geändert hat **und** die Zentrale seit der Meldung die Session in einer Abfrage nicht untätig (arbeitend oder wartend) sah oder `unread` von `false` auf `true` wechselte. Ein bloßes Weiterrücken von `last_event_at` bei einer untätigen, noch ungelesenen Session ist kein neuer Durchgang (Probe J2b/J2c: solche Sprünge kommen ohne erkennbaren Anlass vor). Erste Sichtung und der Wechsel `unread` `false` → `true` melden immer. Nach dem Entfernen wegen `no_signal` gilt ein fertiger, ungelesener Durchgang wieder als neu. Ohne `last_event_at` entscheidet der Wechsel zwischen zwei Listen.
- Titel = `title`. Episodenbeginn = `last_event_at` (nie in der Zukunft), sonst der Empfangszeitpunkt.
- Kommt 90 s lang keine gültige Liste, gehen alle Remote-Sessions auf `no_signal`; nach 210 s werden sie entfernt.
- Eine Antwort ohne `data`-Liste oder ohne erkennbares `connection_status` gilt als Fehler der Quelle („unexpected response“, REM-Zeile der Status-Taste `down`), nicht als leere Liste.

**Entfernt (Mac)** (nicht umgesetzt, Plan 5)
- Der Mac-Agent schickt bei jeder Änderung einer Session-Datei sofort ein Delta (`status`, `waitingFor`, `statusUpdatedAt`, `name`, `bridgeSessionId`). Zusätzlich schickt er alle 30 s ein vollständiges Lebenszeichen.
- **Die Liste im Lebenszeichen ist maßgeblich:** Fehlt eine Mac-Session darin, wird sie entfernt.
- Kommt 90 s lang kein Lebenszeichen, gehen alle Mac-Sessions auf `no_signal`. Nach weiteren 2 min werden sie entfernt.

### 4.4 „Gesehen“ und Episoden

- Eine **Episode** beginnt mit dem Eintritt in `needs_permission`, `needs_input`, `error` oder `done_unseen`. Jede Episode hat einen Startzeitpunkt `since` (`receivedAt`), von dem die Wartezeit-Uhr läuft.
- **Dieselbe Anfrage erzeugt nur eine Episode.** `PermissionRequest` (sofort), Session-Datei `waiting` (≤ 5 s) und `Notification permission_prompt` (nach ~6 s) melden oft dieselbe Anfrage. Ein Auslöser für einen bereits aktiven Wartezustand derselben Session startet keine neue Episode.
- Als gesehen gilt eine Episode bei (a) Sprung zur Session per Slot-Taste, (b) `UserPromptSubmit` in der Session, (c) langem Druck (≥ 600 ms) auf die Slot-Taste („quittieren ohne Springen“) oder (d) Öffnen der Session in Claude Desktop, nachdem die Episode begann (anklicken oder hinwechseln, ohne das Deck; Plan 12, §4.8). (d) wirkt wie (a) auf jede ungesehene Episode. War die Session schon offen, als die Episode begann, gilt (d) erst nach einem erneuten Öffnen (bewusst, Nutzerentscheidung 2026-10-16).
- Durch „gesehen“ wird aus `done_unseen` der Zustand `idle`, bzw. `background`, wenn noch Hintergrund-Jobs laufen. Bei `needs_*` und `error` bleibt der Zustand bestehen, aber die Eskalation stoppt (siehe 5). Eine neue Episode startet die Eskalation neu.

### 4.6 Hintergrund-Jobs

Ein Durchgang kann fertig sein, während die Session im Hintergrund weiterarbeitet: Shell-Befehle mit `run_in_background`, Hintergrund-Agents, Monitore. Claude reagiert später automatisch auf deren Ergebnisse. Das Deck zeigt das als eigenes Merkmal `background = { count, kinds }`, getrennt vom eigentlichen Zustand.

- **Quellen:**
  - `Stop.background_tasks[]` **und** `SubagentStop.background_tasks[]`: jeweils eine Momentaufnahme aller laufenden Jobs der Session. Sie ersetzt den bisherigen Stand. Einträge: `{ id, type: "shell" | "subagent" | …, status, description, command | agent_type }` (Probe M1).
  - `SubagentStart` mit `agent_id`: zählt einen Agent hoch, bis zur nächsten Momentaufnahme. Hintergrund-Agents können beim Aufwecken erneut `SubagentStart` mit derselben `agent_id` senden.
  - **Job-Ende während die Session ruht (Probe M2):** Claude startet einen automatischen Durchgang (`UserPromptSubmit` mit `<task-notification>`, danach `Stop` mit aktualisierter Liste). Ein eigenes Event wie `TaskCompleted` gibt es dabei nicht.
- **Arten (`kinds`):** `type: "shell"` → `shell`, `"subagent"` → `agent`, `"monitor"` → `monitor`, sonst `other`. Übertragen werden nur Art und Anzahl, keine Beschreibungen oder Befehle.
- **Darstellung:**
  - `done_unseen` mit `background.count > 0`: Zustand bleibt `done_unseen`, dazu ein Abzeichen mit der Anzahl (z. B. „⧗3“).
  - Nach „gesehen“: Zustand `background` („Hintergrund“) statt `idle`, Wort „3 laufen“, Detailzeile mit der Aufteilung (z. B. „2 Shell · 1 Agent“).
  - `working` mit laufenden Hintergrund-Jobs: Abzeichen wie oben.
- **Keine Aufmerksamkeit:** `background` animiert nie und zählt in der Inbox nicht als wartend.
- **Absicherung gegen hängende Zähler:** Ändert sich `background` 30 min lang nicht, zeigt die Kachel „Hintergrund?“ statt einer festen Zahl. `SessionEnd` und eine tote PID setzen den Zähler auf 0.
- **Über Neustarts (Plan 7):**
  - Keine lokale Quelle kennt die laufenden Jobs. Sonde vom 2026-10-14: Session-Dateien tragen keine Job-Felder, Transkripte nur vereinzelte `task_status`-Einträge, und `SessionStart` liefert keine Liste.
  - Die Zentrale speichert deshalb je lokaler Session die letzte Job-Liste in `%APPDATA%\vibetribe\background.json`: nur Ids und Arten, mit Änderungszeitpunkt und dem Schreibzeitpunkt `savedAt`.
  - Die Datei wird atomar ersetzt: bei jeder Änderung und alle 10 min, solange Jobs laufen. Ein Schreibfehler wird mit einem späteren Ereignis wiederholt, solange er anhält höchstens alle 30 s (Plan 8); auch eine neue Änderung wartet dann bis zum nächsten Versuch. Eine kaputte Datei wird einmal geloggt und ignoriert.
  - Geschrieben wird nur, solange der HTTP-Eingang der Zentrale lauscht (Plan 8). Laufen Plugin und `hub.mjs` gleichzeitig, schreibt der, der den Port verloren hat, die Datei nie.
  - Geladen wird sie vor dem HTTP-Eingang.
  - Nach einem Neustart bekommt eine Session ihre Jobs zurück, sobald der erste Scan ihres Hosts sie lebend listet. Fehlt sie darin, ist sie beendet und der Eintrag entfällt.
  - Eine Job-Liste aus `Stop`/`SubagentStop` oder ein `SessionEnd` vor diesem Scan gewinnt.
  - Noch nicht wiederhergestellte Einträge behalten beim erneuten Speichern ihren ursprünglichen `savedAt`. War die Zentrale länger als 6 h weg (`savedAt`, auch ein `savedAt` in der Zukunft), wird nichts wiederhergestellt und der Eintrag entfällt. Die 30-min-Marke „?“ zählt vom gespeicherten Änderungszeitpunkt.
- Geplante Loops (`session_crons[]`) werden in v1 nicht angezeigt.

### 4.5 Bekannte Einschränkungen

- `UserPromptSubmit` und `Stop` feuern auch für automatische Turns (geplante Aufgaben, `/loop`, Berichte von Hintergrund-Subagents, Nachrichten zwischen Sessions). Jeder solche Turn erzeugt ein `done_unseen`. Abschwächung: Ein `Stop` innerhalb von 10 s nach einem `Stop` derselben Session ohne dazwischenliegendes echtes `UserPromptSubmit` startet keine neue Episode.
- Nach einem Plugin-Neustart lässt sich `done_unseen` lokaler Sessions nicht wiederherstellen. Diese Sessions erscheinen als `idle`, bzw. als `background`, wenn gespeicherte Jobs laufen (§4.6).
- REM: Die Remote-Liste trägt `unread` selbst. Jeder noch ungelesene fertige Durchgang (`completed` oder `review_ready`) einer verbundenen Session erscheint nach einem Neustart **einmal** wieder als `done_unseen` (auch wenn er vorher am Deck gesehen war; das Gedächtnis der Durchgänge liegt nur im Speicher) und kann einen Slot nehmen (R9). Spätere Abfragen melden ihn nicht erneut.
- Endet ein Job, während das Plugin nicht läuft, zeigt die Session ihn nach dem Neustart weiter, bis ihr nächster Durchgang endet; nach 30 min ohne Änderung mit „?“.

### 4.7 Angepinnte Sessions aus Claude Desktop (Plan 11)

- Claude Desktop speichert die angepinnten Code-Sessions seiner Sidebar in `claude_desktop_config.json` unter `preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder`: eine Liste `code:local_<uuid>` in Sidebar-Reihenfolge. Gemessen am 2026-10-16: 6 Einträge; genau dieselben 6 Desktop-Session-Dateien (`claude-code-sessions\<ws>\<acct>\local_<uuid>.json`) tragen `isStarred: true`, dieselbe Menge steht in `starred-local-code-sessions`.
- **Ort:** seit Desktops Update im Oktober 2026 `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\`, davor beim MSIX-Paket `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`, bei einer klassischen Installation `%APPDATA%\Claude\`. Die erste vorhandene Datei zählt (`desktopDirs` in `packages/hub/src/compose.ts`, `desktopConfigFiles` in `packages/hub/src/pins/desktop.ts`).
- **Lesen:** alle 5 s, nur lesend (ADR 0008). Fehlt die Datei oder ist sie anders geformt, gibt es keine Pins; das Deck arbeitet dann wie ohne Pins. Ist sie gerade unlesbar (gesperrt, halb geschrieben und damit kein JSON), bleiben die zuletzt gelesenen Pins, ohne Logzeile. Titel und Ids kommen nie ins Log. Ein Eintrag zählt nur in der Form `code:local_<Id>` (Zeichen wie beim Sprunglink, §9); Doppelte zählen einmal.
- **Zuordnung über die Desktop-Id:** Jede Desktop-Session, unter Windows wie in WSL, trägt sie als `hostSessionId` in ihrer Session-Datei (§4.1; dieselbe Id wie im Sprunglink, §9). Eine nur aus Hooks bekannte Session ist bis zum ersten Scan ihres Hosts nicht angepinnt.
- **Nicht abgedeckt:** angepinnte Remote- und Cloud-Sessions (`session_…`). Desktop speichert sie nicht in der Datei, sondern im IndexedDB-Speicher der claude.ai-Seite (LevelDB, Liste `starredIds`; am 2026-10-16 die 2 übrigen der 8 Pins der Sidebar, keine davon in einer lokalen Session-Datei). Die Remote-Liste des Kontos kennt kein Pin-Feld. REM-Sessions sind deshalb nie angepinnt.


### 4.8 Gesehen in Claude Desktop (Plan 12)

- **Quelle:** Claude Desktop führt je Code-Session eine Datei `claude-code-sessions\<ws>\<acct>\local_<uuid>.json` im selben Ordner wie die Konfiguration aus §4.7 (MSIX-Paket bzw. `%APPDATA%\Claude\`). Ihr Feld `lastFocusedAt` (ms seit 1970, Windows-Uhr) setzt Desktop, wenn der Nutzer die Session öffnet oder zu ihr wechselt; solange sie offen bleibt, ändert es sich nicht. Gemessen am 2026-10-16: 61 Dateien in einem Konto-Ordner, 44 mit `lastFocusedAt`, 17 ohne; 0,7–249 KB, Median 76 KB. Der Dateiname steht in allen als `sessionId`.
- **Regel (Nutzer, 2026-10-16):** Eine lokale Session mit Desktop-Id (`hostSessionId`, §4.7), die Aufmerksamkeit braucht (§6.3: `needs_permission`, `needs_input`, `error` oder `done_unseen`, jeweils ungesehen), gilt als gesehen, wenn `episode.since < lastFocusedAt ≤ jetzt`. Gesehen wird genau wie nach einem Sprung (`Hub.markSeen`): Done wird ruhig, Freigabe, Frage und Fehler bleiben bestehen und hören auf zu eskalieren (§4.4, §5). Verglichen wird mit der Episode, wie sie nach dem Lesen ist; eine Episode, die währenddessen beginnt, bleibt ungesehen.
- **Bewusste Ausnahme:** War die Session schon offen, als ihr Durchgang endete (oder ihre Anfrage kam), gibt es kein neues `lastFocusedAt`; die Episode bleibt ungesehen, bis der Nutzer über das Deck springt oder eine andere Session und wieder zurück anklickt. Ob Desktops Fenster vorne ist, verrät keine Datei; eine Heuristik dafür gibt es nicht (der Nutzer will kein Done verpassen).
- **Uhr:** `lastFocusedAt` kommt von Desktop, `episode.since` von der Zentrale; beide nutzen die Windows-Uhr desselben Rechners. Ein `lastFocusedAt` nach jetzt (Uhr zurückgestellt) zählt nicht, bis die Uhr es erreicht, und trifft dann nur Episoden, die vor ihm begannen.
- **Lesen:** im selben 5-s-Takt wie die Pins (§4.7), nur lesend (ADR 0009), und nur die Dateien der Sessions, die gerade Aufmerksamkeit brauchen (meist 0–3); ohne solche Session wird nichts gelesen. Welche Datei zu welcher Desktop-Id gehört, liefert ein Scan der drei Ordner-Ebenen beim ersten Bedarf; er läuft erneut, wenn eine Id unbekannt ist oder ihre Datei nicht gelesen werden konnte. Erkennung nach höchstens 5 s.
- **Fail-soft:** Fehlt ein Ordner oder eine Datei, ist sie gesperrt oder halb geschrieben, fehlt `lastFocusedAt` oder ist es keine Zahl: keine Wirkung, kein Fehler, keine Logzeile. Eine gesehene Session schreibt eine Zeile `seen in Claude Desktop: <n>` (nur die Anzahl, nie Titel oder Ids).
- **Eigene Sprünge des Decks:** Öffnet das Deck eine Session per Link, setzt Desktop ihr `lastFocusedAt` etwa 2 s später (gemessen am 2026-10-16). Nach einem Slot-Sprung ist die Session ohnehin gesehen. Nach einem Inbox-Sprung zählt ein Fokus bis 5 s (Fenster der Inbox) danach nicht: Beim Durchblättern gilt weiter nur die Session als gesehen, auf der der Nutzer landet (§6.2, §9). Klickt er eine übersprungene Session später selbst in Desktop an, zählt das.
- **Nicht betroffen:** REM-Sessions haben keine Desktop-Id; sie folgen weiter `unread` der Remote-Liste (§4.3). CLI-Sessions im Terminal haben ebenfalls keine.

## 5. Aufmerksamkeit und Eskalation

Die Zahlen sind Startwerte und lassen sich einstellen.

| Phase | Gilt für | Darstellung |
|---|---|---|
| 0–30 s nach Beginn der Episode | `needs_permission`, `needs_input` (ungesehen) | sanftes „Atmen“ der Kachel, Periode 1,2 s; Helligkeit des Akzents zwischen 35 und 100 %; 4 Bilder pro Sekunde |
| ab 30 s | dieselben | ruhig, mit dickem Akzentrahmen; Wartezeit-Uhr `42 s`, ab 1 min `3 min`, ab 60 min `1:05 h`, ab 10 h `12 h` |
| Erinnerung | nur die **älteste** ungesehene Episode mit `needs_*` | alle 60 s ein Puls aus 3 Atem-Zyklen |
| ungesehen | `done_unseen` | von Anfang an ruhig mit dickem Rahmen und Tönung in der Done-Farbe, gefülltes Symbol, Uhr; atmet nie (Handoff v2, R11) |
| gesehen | `needs_*`, `error` | ruhig, dünner Rahmen, Uhr läuft weiter |
| gesehen | `done_unseen` (wird `idle` bzw. `background`) | ruhig, ohne Rahmen |
| — | `error`, `done_unseen`, `throttled`, `background` | nie animiert, nur Farbe, Symbol und Wort (ungesehenes `error` und `done_unseen`: dicker Rahmen); `throttled` in Info-Farbe; `background` ruhig in der Farbe von `working`, aber mit eigenem Symbol |
| — | `working` | kleines lokales Arbeitszeichen (z. B. drei Punkte, 1 Bild pro Sekunde), nie die ganze Kachel |

**Regeln**
- Bewegung gibt es ausschließlich bei „braucht dich“ (`needs_*`). Done counts as attention (user decision 2026-10-14, R9): ein fertiger, ungesehener Durchgang ist so auffällig wie Input/Approve im ruhigen Zustand (dicker Rahmen, Tönung, Slot, `+N`), atmet aber nie (R11, Handoff v2: Bewegung bleibt für „braucht dich“). Handoff v2 zeichnet `done_unseen` selbst so; nach dem Ansehen wird die Session `idle`.
- Kein hartes Blinken; der Wert bleibt immer unter 3 Wechseln pro Sekunde (WCAG 2.3.1).
- Jeder Zustand wird dreifach codiert (Farbe, Symbol, Wort). Die Farben basieren auf Okabe-Ito; Rot und Grün entscheiden nie allein.
- **Bildbudget für das ganze Plugin: höchstens 10 `setImage` pro Sekunde.** Elgatos Grenze gilt für das Plugin, nicht pro Taste. Daraus folgt:
  - Gleichzeitig atmen höchstens 2 Tasten: zuerst die neuesten ungesehenen `needs_*`-Episoden in ihren ersten 30 s, danach, falls ein Platz frei ist, die Erinnerung der ältesten (Claude-Design-Handoff §4.1: so atmet eine neue Anfrage immer an, auch wenn ältere warten). Alle anderen werden ruhig dargestellt. Atemstufen 0,35 · 0,675 · 1 · 0,675, je 300 ms.
  - Ein unverändertes Bild wird nicht erneut gesendet. Uhren ticken nur in der ersten Minute sekündlich, danach minütlich; die Uhr einer atmenden Taste ändert sich nur mit einem Atembild. Das Arbeitszeichen (heller Punkt) wandert alle 2 s.
  - Ein Scheduler in `core` verteilt das Budget. Vorrang haben Zustandswechsel, dann Atmen, dann Uhren, dann Arbeitszeichen. Reicht das Budget nicht (1 Bild/s bleibt für Zustandswechsel frei), bleiben zuerst die Arbeitszeichen stehen, dann springen Sekunden-Uhren in 2-s-Schritten (`planFrames`).

## 6. Deck-Aktionen und Belegung

### 6.1 Standardbelegung MK.2

```
┌────────┬────────┬────────┬────────┬────────┐
│ Apps   │  5h    │ Week   │ Inbox  │ Status │
├────────┼────────┼────────┼────────┼────────┤
│ Extra  │ Slot 1 │ Slot 2 │ Slot 3 │ Slot 4 │
├────────┼────────┼────────┼────────┼────────┤
│Spotify │ Slot 5 │ Slot 6 │  Mic   │Next pg │
└────────┴────────┴────────┴────────┴────────┘
```

Alle Aktionen lassen sich frei platzieren. Das Plugin bringt ein vorkonfiguriertes Profil mit dieser Belegung mit. Die Zahl der Slots folgt den platzierten Slot-Tasten; das Diagramm zeigt die Belegung auf dem Gerät des Nutzers (Plan 6, „Mischform“: sechs Slots zwischen eigenen Tasten; Apps, Spotify, Mic und Next page sind Tasten außerhalb des Plugins).

Die Status-Taste zeigt die Zeilen WIN, WSL, REM (Remote-Sessions, §4.3) und LIM (Limit-Abfrage). `off` bedeutet: nicht konfiguriert. In der Variante comfortable zeigt sie nur Störungen (sonst „Sources ok“); Tippen zeigt 5 s alle vier.

### 6.2 Aktionen

| Aktion | Inhalt | Kurz drücken | Lang drücken |
|---|---|---|---|
| **Session-Slot** | Titel (Desktop-Name, sonst Projektordner; höchstens 2 Zeilen), Zustand als Symbol und Wort, Wartezeit-Uhr, Detailzeile, Herkunfts-Abzeichen, Hintergrund-Abzeichen mit Anzahl (4.6) | Sprung zur Session und „gesehen“ | quittieren ohne Springen |
| **Inbox** | dringendste Session (Titel und Zustand) und Zahl der wartenden Sessions (inklusive `done_unseen`); `+N` = Sessions, die Aufmerksamkeit brauchen (§6.3), aber keinen sichtbaren Slot haben. Normalerweise 0, weil sie sich einen Slot nehmen | Sprung zur dringendsten Session; weitere Drücke innerhalb von 5 s gehen die wartenden Sessions der Reihe nach durch. Als gesehen gilt nur die Session, auf der der Nutzer landet, d. h. 5 s lang kein weiterer Druck; dass Claude Desktop die übersprungenen dabei kurz zeigt, zählt nicht (§4.8). | alle `done_unseen` quittieren |
| **5h-Limit** | Ring mit Verbrauch in %, Tempo-Markierung, Zeit bis zum Reset | sofort neu laden (unter Beachtung des Backoffs) | — |
| **Wochenlimit** | wie 5h-Limit, mit dem 7-Tage-Fenster | wie oben | — |
| **Extra Usage** | verbrauchte Credits / Monatslimit in Währung, Balken; `As of 14:32`, wenn die Daten älter als 10 min sind | öffnet `https://claude.ai/settings/usage` im Standardbrowser. Dort schaltet der Nutzer Extra Usage ein oder aus; das Plugin ändert nie selbst Konto- oder Abrechnungseinstellungen | — |
| **Status** | Gesundheit der Quellen: WIN, WSL, REM, LIM (`ok`, `stale`, `down`, `off`); Hinweise wie „Port in use“, „Setup“ (Hooks fehlen oder sind veraltet, §8.4) oder „No token“ | alle vier Quellen 5 s lang (`expanded`) | öffnet die Debug-Seite im Browser (Diagnose) |

**Property Inspector (Plan 11, Plan 14):** Alle Aktionen teilen eine Seite, `ui/vibetribe.html`; sie liegt im Plugin, lädt nichts nach und funktioniert offline. Sie zeigt immer die Einrichtung der Hooks (§8.4). Nur an der Aktion „Session slot“ zeigt sie zusätzlich ein Kästchen „Prefer pinned sessions“, Standard an. Es ist eine globale Einstellung für alle Slots (Stream-Deck-`globalSettings`, Schlüssel `preferPinned`) und nur in der Stream-Deck-App am PC sichtbar, nicht auf dem Gerät. Das Plugin liest die Einstellung einmal nach dem Verbinden und folgt jeder Änderung sofort, ohne Neustart. Bis der erste Wert angewandt ist, gelten keine Pins (beim Start also nie kurz „an“, wenn der Nutzer „aus“ gewählt hat); ein Lesefehler steht im Log, dann gilt der Standard (an). Aus: Die Slot-Zuordnung arbeitet genau wie ohne Pins (§6.3).

### 6.3 Slot-Zuordnung

- **Stabil:** Eine Session behält ihren Slot, solange sie lebt. Neue Sessions bekommen den ersten freien Slot, in der Reihenfolge der Platzierung auf dem Deck.
  - Slot-Indizes: Der Index wird beim ersten Erscheinen einer Slot-Taste vergeben und bleibt bei dieser Taste, solange sie sichtbar ist oder höchstens 60 s unsichtbar war. Danach wird er freigegeben; die nächste neue Slot-Taste bekommt den niedrigsten freien Index.
  - Neue Sessions bekommen nur Slots, deren Taste gerade sichtbar ist (Seitenwechsel). Unsichtbare Slots behalten ihre Session.
  - Ist ein Slot länger als 60 s unsichtbar, gibt er seine Session frei (sie rückt auf einen sichtbaren freien Slot); ein leerer unsichtbarer Slot wird entfernt.
- **`/clear` und `/resume`:** Bei `SessionEnd` mit `reason` ∈ {`clear`, `resume`} bleibt der Slot 10 s reserviert. Er geht an das nächste `SessionStart` mit gleichem Host und gleichem `cwd` (bei verknüpfter Session-Datei: gleiche PID).
- Mehr Sessions als Slots: Die überzähligen Sessions erscheinen nur in der Inbox. Wird ein Slot frei, rückt die Überlauf-Session mit der höchsten Priorität nach.
- **Wer Aufmerksamkeit braucht, verdrängt Ruhige (Plan 7):**
  - **Wer Aufmerksamkeit braucht:** Eine Session in `needs_permission`, `needs_input`, `error` oder `done_unseen`, deren Episode ungesehen ist.
  - Done counts as attention (user decision 2026-10-14): `done_unseen` verdrängt wie ein Alarm und zählt zu `+N`, bis es gesehen ist. Ersetzt die frühere Regel „`done_unseen` füllt nur freie Slots“. Preis: Auch automatische Durchgänge (fertige Hintergrund-Jobs, `/loop`) und ungelesene REM-Ergebnisse nach einem Neustart melden sich laut; die Haltezeit (30 s) begrenzt das Hin und Her.
  - Alle anderen sind ruhig: arbeitend, Hintergrund, untätig, gedrosselt, `no_signal` oder gesehen.
  - Findet eine Session, die Aufmerksamkeit braucht, keinen freien sichtbaren Slot, nimmt sie den sichtbaren Slot der Session, die am längsten ruhig ist:
    - zuerst eine, die nicht in Claude Desktop angepinnt ist; eine angepinnte nur, wenn keine andere weichen kann (Plan 11, siehe unten);
    - dann die, die nie oder am längsten nicht mehr Aufmerksamkeit brauchte (mit oder ohne Slot);
    - dann die ruhigere (untätig vor arbeitend);
    - dann der spätere Slot.
  - Mehrere Anwärter kommen in der Reihenfolge der Dringlichkeit dran.
  - Nie verdrängt wird eine Session, die selbst Aufmerksamkeit braucht. Ebenso wenig eine, die sie vor weniger als 30 s noch brauchte (Haltezeit). So wechseln sich zwei Wartende nie schneller als alle 30 s auf einem Slot ab.
  - Ruhige Sessions ohne Pin tauschen nie untereinander. Eine ruhige Session ohne Pin und ohne Slot verdrängt niemanden. Angepinnte siehe unten.
  - Nur sichtbare Slots werden genommen.
    - Eine Session auf einem unsichtbaren Slot behält ihn; nach 60 s gibt die 60-s-Regel sie frei.
    - Verdrängt wird nur beim Aktualisieren und im Takt, nicht während die Tasten einer Seite einzeln wieder erscheinen.
  - Ein Druck auf eine Slot-Taste wirkt auf die Session, die die Taste zuletzt gezeigt hat (zuletzt angenommenes Bild), nicht auf eine gerade eingewechselte.
  - Ein Wechsel kostet zwei Zustandsbilder (Slot und Inbox) und fällt unter den Vorrang der Zustandswechsel im Bildbudget (§5).
- **Angepinnte Sessions behalten ihre Slots (Plan 11, Regeln des Nutzers vom 2026-10-16):**
  - Angepinnt ist eine Session, deren Desktop-Id in der Pin-Liste von Claude Desktop steht (§4.7), solange „Prefer pinned sessions“ an ist (§6.2). Aus: Die Zuordnung ist genau die ohne Pins.
  - **Laufend** ist jede Session außer `idle` und `no_signal`: arbeitend, gedrosselt, mit Hintergrund-Jobs, mit gesehener Freigabe, Frage oder Fehler (es läuft etwas oder wartet auf eine Antwort). **Ruhend** sind `idle` und `no_signal`.
  - **Vorrang**, nach den Sessions, die Aufmerksamkeit brauchen (oben):
    1. **Laufend schlägt angepinnt:** Eine ruhende angepinnte Session nimmt nie den Slot einer laufenden.
    2. **Bei Gleichstand gewinnt die angepinnte:** Eine ruhige angepinnte Session ohne Slot nimmt den sichtbaren Slot einer ruhigen Session ohne Pin, wenn beide ruhen, beide laufen oder nur die angepinnte läuft. Unter mehreren Slots wählt sie wie oben: am längsten ruhig, dann ruhiger, dann der spätere Slot. Wartet zugleich eine ruhende angepinnte Session, nimmt eine laufende angepinnte zuerst den Slot einer laufenden Session ohne Pin; der Slot der ruhenden bleibt für die ruhende.
    3. **Alarme verdrängen zuerst Sessions ohne Pin** (oben); den Slot einer angepinnten nur, wenn keine andere weichen kann.
  - Angepinnte verdrängen sich nie gegenseitig. Mehrere angepinnte Anwärter ohne Slot kommen so dran: laufende zuerst, dann die Reihenfolge der Sidebar (`pinnedOrder`). Die Reihenfolge entscheidet nur, wer zuerst einen Slot bekommt, nie einen Tausch unter Angepinnten: Umsortieren in Desktop bewegt keine Taste.
  - **Wann ruhige Sessions tauschen:** nur, wenn eine angepinnte Session keinen Slot hat (neu, gerade in Desktop angepinnt, von einem Alarm verdrängt oder mit ihrem verborgenen Slot über die 60-s-Regel freigegeben) und ein passender sichtbarer Slot nicht geschützt ist. Gegen Flattern gilt dasselbe wie für Alarme: Haltezeit 30 s nach Aufmerksamkeit, nur sichtbare Slots, nur beim Aktualisieren und im Takt, nicht während die Tasten einer Seite wieder erscheinen. Freie Slots füllt `sync` wie bisher nach Dringlichkeit; der Tausch zugunsten einer angepinnten Session folgt im selben Schritt (`SlotTable.promote`), bevor das Bild gesendet wird. Ein frisch gesetzter Pin wirkt spätestens nach 5 s (Lesetakt, §4.7). Mit Pins rücken angepinnte Sessions von einer Seite, die länger als 60 s verborgen ist, auf die sichtbare Seite und verdrängen dort ruhende Sessions ohne Pin.
  - **Folge von „laufend schlägt angepinnt“ in der Gegenrichtung:** Eine laufende Session ohne Pin und ohne Slot nimmt nie den Slot einer ruhenden angepinnten Session (Ruhige ohne Pin verdrängen nie). Gibt es mindestens so viele Pins wie Slots, bekommt eine neue laufende Session ohne Pin erst eine Taste, wenn ein Slot frei wird (oder wenn sie Aufmerksamkeit braucht).
- Leere Slots sind dunkel und zeigen keinen Text.

## 7. Limits und Extra Usage

### 7.1 Quellen

Weil fast alle Sessions über Claude Desktop laufen und dort keine Statusline existiert, ist der Usage-Endpunkt in der Praxis die **Hauptquelle**. Er wird zuerst und robust gebaut. Die Statusline ergänzt ihn, wo vorhanden.

1. **Usage-Endpunkt** `GET https://api.anthropic.com/api/oauth/usage` (undokumentiert):
   - Nur das Plugin fragt ab, höchstens alle 5 min.
   - Header: `Authorization: Bearer <OAuth-Token>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/<installierte Version>`.
   - Den Token liest das Plugin nur lesend aus der Anmeldedatei mit dem spätesten `expiresAt` (Windows oder WSL). Es erneuert ihn nie selbst.
   - **Token-Erneuerung (Probe K):** Claude Desktop verwaltet seine Anmeldung selbst und frischt die Anmeldedateien nicht auf. Bei reiner Desktop-Nutzung sind sie meist abgelaufen. Ein Aufruf des Windows-CLI (`claude -p …`) frischt die Windows-Datei auf.
     - Das Plugin stößt deshalb eine Erneuerung über das installierte CLI an, sobald der Token abgelaufen ist oder in weniger als 10 min abläuft, höchstens einmal pro Stunde.
     - Dafür läuft nur `claude -p /cost` (kein Modellaufruf; ein Rückfall auf einen Modellaufruf ist ausdrücklich nicht gewollt). Jeder Versuch schreibt eine Logzeile `token refresh: ok` bzw. `token refresh: no change`, ohne Token-Inhalt; so zeigt der nächste Ablauf, ob `/cost` allein die Anmeldung erneuert.
   - Bei 429: exponentielles Backoff bis 30 min. Die Antwort enthält keine Rate-Limit-Header.
   - Bei 401: Anzeige `Sign in` (Anmeldung abgelaufen). Neu abgefragt wird nach einer Erneuerung oder wenn sich die Anmeldedatei ändert.
   - **Feld-Mapping:**
     - `fiveHour` = `{ usedPct: five_hour.utilization, resetsAt: Date.parse(five_hour.resets_at) }`, `sevenDay` entsprechend aus `seven_day`
     - `extra` = `{ enabled: extra_usage.is_enabled, usedCredits: used_credits / 10^decimal_places, monthlyLimit: monthly_limit / 10^decimal_places, currency }`
     - Die Beträge kommen in kleinsten Währungseinheiten (Probe K).
   - Die letzte gültige Antwort wird unter `%APPDATA%\vibetribe\usage-cache.json` gespeichert und nach einem Neustart sofort als `As of 14:32` angezeigt.
2. **Statusline-JSON** (nur Terminal-Sessions): `rate_limits.five_hour` und `rate_limits.seven_day` (`used_percentage`, `resets_at`). Die Daten kommen über die Statusline-Weiche des Reporters. Gewählt wird je Fenster der Wert mit dem jüngsten `receivedAt`, egal aus welcher Quelle.
3. **Fensterwechsel:** Fehlt `five_hour` bzw. `seven_day` in einem Snapshot, obwohl das vorherige `resets_at` schon vorbei ist, gilt 0 % („neues Fenster“). Der alte Wert wird nicht weiter angezeigt.
4. **Veraltete Werte:** Ist eine Quelle älter als erlaubt (5h/Woche: 15 min; Extra: 10 min), zeigt die Kachel `As of 14:32` in gedämpfter Darstellung.

### 7.2 Tempo-Markierung

`fensterstart = resets_at − fensterlänge`; `soll_% = (jetzt − fensterstart) / fensterlänge × 100`. Die Markierung sitzt auf dem Ring bei `soll_%`. Liegt der Verbrauch mehr als 10 Prozentpunkte über `soll_%`, zeigt die Kachel zusätzlich einen Pfeil „vor Plan“.

### 7.3 Farbstufen (Limit-Kacheln)

- unter 60 % neutral
- 60–85 % amber
- ab 85 % rot

Limit-Kacheln animieren nie.

## 8. Datenfluss und Schnittstellen

```
Windows-Claude ─┐  Hooks (async) + Statusline
WSL-Claude ─────┼──── vibetribe-report ──HTTP+Token──► 127.0.0.1:<port> ┐
Claude Desktop ─┘                                                      │
                                                                       ▼
MacBook: Hooks → vibetribe-report ─► 127.0.0.1 (Mac)        ┌─────────────────────┐
         vibetribe agent (launchd, Relais + Lebenszeichen) ─►│ Plugin (Zentrale)   │
                              Tailscale + Token              │ core · render · deck│
sessions/*.json (Win + WSL) ── Lebenszeichen ───────────────►│                     │
/api/oauth/usage (≤ alle 5 min) ── Limits, Extra Usage ─────►└─────────────────────┘
```

Der Zweig über den Mac-Agent und Tailscale ist nicht umgesetzt, Plan 5.

### 8.1 Reporter (`vibetribe-report`)

**Hook-Rolle**
- **Eingetragene Events:** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Elicitation`, `ElicitationResult`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `SessionEnd`.
- **Eintragsform:**
  - **`async: true`** für alle Events außer `SessionEnd`. Claude wartet also nie auf den Reporter. `SessionEnd` bleibt synchron (das Zeitbudget von 1,5 s reicht).
  - **Ohne Shell:** `command` ist der **absolute Pfad zu `node`**, den `setup` pro Host ermittelt (`process.execPath`), dazu `args: [<Pfad zu reporter.mjs>, "hook"]` und `timeout: 2`. Richtet das Plugin die Hooks unter Windows ein, ist es die Kopie `%USERPROFILE%\.vibetribe\node-<version>.exe` von Stream Decks Node (§8.4).
  - Claude Desktop liest weder PowerShell-Profile noch Shims von nvm, fnm oder volta, und launchd kennt keinen `PATH`. Deshalb braucht es den absoluten Pfad.
- **Ablauf:** liest den Payload von stdin, ergänzt ihn um eine Hülle (8.3), schickt ihn per HTTP-POST mit 300 ms Timeout.
  - Er gibt **nie** eine Entscheidung zurück: keine Ausgabe auf stdout, Exit-Code immer 0.
  - Ist die Zentrale nicht erreichbar, verwirft er das Event stillschweigend.
- **Ziel:** unter Windows und in WSL `127.0.0.1` auf dem Port aus der Port-Datei der Zentrale (§8.2). Der Reporter liest sie neben seinem Token, in WSL über `/mnt/c/Users/<user>/.vibetribe/port`; fehlt sie oder ist sie ungültig, gilt 43710. Ein `hubUrl` in `~/.vibetribe/config.json` hat Vorrang; `http://127.0.0.1:43710`, das frühere Setups dort eintrugen, gilt nicht als Vorgabe (Plan 10). Auf dem Mac der lokale Agent (`127.0.0.1:43710` auf dem Mac). So zahlt kein Tool-Aufruf auf dem Mac eine Tailscale-Latenz oder den Timeout, wenn der PC schläft.

**Statusline-Rolle**
- Liest das Statusline-JSON. Startet den POST an die Zentrale und den vorherigen Statusline-Befehl **gleichzeitig**. Claude bricht laufende Statusline-Skripte bei einem neuen Update ab, und die Anzeige des Nutzers darf nicht verloren gehen.
- Gibt die Ausgabe des vorherigen Befehls unverändert weiter. War keine Statusline eingerichtet, gibt er nichts aus.
- Der vorherige Befehl samt `padding` und `refreshInterval` wird in `~/.vibetribe/config.json` gespeichert (Rechte 0600 bzw. nur für den Nutzer lesbar). `setup --uninstall` schreibt ihn zurück.

**Agent-Rolle (`vibetribe agent`, nur Mac, launchd)** (nicht umgesetzt, Plan 5)
- Nimmt lokal auf `127.0.0.1:43710` Hook- und Statusline-Events entgegen und leitet sie über eine ausgehende Verbindung an die Zentrale weiter: Tailscale, Token, Puffer bis 500 Events bzw. 10 min.
- Liest `~/.claude/sessions/*.json`, prüft, ob die Sessions noch leben, und schickt Deltas sowie alle 30 s ein vollständiges Lebenszeichen (siehe 4.3).

**Datenschutz:** Prompt-Texte, Tool-Eingaben und Tool-Ausgaben werden **nicht** übertragen. Übertragen werden nur Event-Name, Tool-Name, `tool_use_id`, `agent_id`, Notification-Typ, Fehlertyp, `reason`, Art und Anzahl der Hintergrund-Jobs sowie Session-Metadaten.

### 8.2 Zentrale (HTTP im Plugin)

- **Port:** zuerst 43710 auf `127.0.0.1` (`VIBETRIBE_PORT` setzt einen anderen ersten Port).
  - WSL reserviert beim Mirrored-Netzwerk mit jedem Start einen Block von 4096 Ports auch auf der Windows-Seite (`/proc/sys/net/ipv4/ip_local_port_range`). Der Block ist unsichtbar (kein Prozess in `netstat`, `listen()` unter Windows scheitert mit `EADDRINUSE`) und wandert zwischen WSL-Starts: gemessen 44620–48715, am 2026-10-16 40525–44620 mit 43710 darin. Dazu kommen die Ausschlussbereiche von Windows (`netsh int ipv4 show excludedportrange protocol=tcp`).
  - **Ersatzports (Plan 10):** Lässt sich der Port nicht binden, nimmt das Plugin den ersten freien aus 37710, 31710, 25710 (`FALLBACK_PORTS` in `packages/hub/src/compose.ts`). Sie liegen unter dem dynamischen Bereich von Windows (49152–65535) und je 6000 auseinander; ein WSL-Block trifft höchstens einen.
  - **Neuer Versuch:** Bindet keiner, versucht das Plugin alle 5 s erneut alle Ports der Reihe nach, bis einer frei wird oder es endet (z. B. hält nach einem Neustart von Stream Deck die alte Instanz den Port noch). Bis dahin zeigt die Status-Kachel „Port in use“; die Logzeile steht einmal je neuer Ursache da. Ein gebundener Ersatzport bleibt bis zum nächsten Start, auch wenn 43710 frei wird.
  - **Port-Datei:** Den gebundenen Port schreibt die Zentrale nach jedem Binden atomar nach `%USERPROFILE%\.vibetribe\port` (neben den Token; nur die Zahl). Name, Standardport und Prüfung stehen in `packages/protocol/src/port.ts`. Beim Beenden bleibt die Datei liegen; der nächste Start überschreibt sie.
  - `hub.mjs` versucht nur den ersten Port und endet mit Exit 2, wenn er belegt ist. Plugin und `hub.mjs` laufen nie gleichzeitig: Liegt das Plugin auf einem Ersatzport und ist 43710 frei, startet `hub.mjs` und überschreibt die Port-Datei.
- **Absicherung auf Loopback** (gegen CSRF und DNS-Rebinding aus dem Browser):
  - Jeder Request muss den Header `Host` ∈ {`127.0.0.1:<port>`, `localhost:<port>`} tragen.
  - Requests mit einem `Origin`-Header werden abgelehnt (403).
  - `POST /v1/*` erfordert `Content-Type: application/json` und `Authorization: Bearer <token>`.
  - Den Token erzeugt das Plugin beim Start (oder `setup` unter Windows), falls er fehlt, und legt ihn in `%USERPROFILE%\.vibetribe\token` ab. Der Reporter in WSL liest ihn über `/mnt/c/Users/<user>/.vibetribe/token`.
  - `/debug*` ist nur bei einer Loopback-Gegenstelle erreichbar.
- **Tailscale-Schnittstelle** (standardmäßig aus) (nicht umgesetzt, Plan 5):
  - Bindet zusätzlich auf die Tailscale-IP. Ist Tailscale beim Start noch nicht bereit, versucht sie es alle 30 s erneut. Der Grund steht im Debug-Log.
  - Nur `POST /v1/*` mit Token, kein `/debug`.
  - Braucht eine Windows-Firewall-Regel für das `node.exe` der Stream-Deck-App, beschränkt auf das Tailscale-Interface (siehe 8.4).
- **Verarbeitung:** antwortet sofort mit `202` und verarbeitet aus einer Warteschlange. So reißt der 300-ms-Timeout des Reporters nicht, wenn gerade viel gerendert wird.
- **Endpunkte:**
  - `POST /v1/event` – Hook-Events
  - `POST /v1/statusline` – Statusline-Snapshot
  - `POST /v1/heartbeat` – Delta bzw. vollständiges Lebenszeichen des Mac-Agents (nicht umgesetzt, Plan 5)
  - `GET /debug` – Debug-Seite
  - `GET /debug/state.json` – Zustand aller Tasten
  - `GET /health`

### 8.3 Event-Hülle (Version 1)

Maßgeblich ist `packages/protocol/src/envelope.ts` (Typen) und `validate.ts` (Prüfung). Zwei Arten:

```json
{
  "v": 1,
  "kind": "hook",
  "source": { "host": "win|wsl:<Distro>|mac:<hostname>", "os": "windows|wsl|mac", "distro": "Ubuntu", "entrypoint": "claude-desktop" },
  "session": { "id": "<session_id>", "cwd": "/home/…/atlas", "pid": 773707, "hostSessionId": "local_…" },
  "event": {
    "name": "PermissionRequest",
    "ts": 1791590400000,
    "toolName": "Bash",
    "toolUseId": "toolu_…",
    "agentId": null,
    "notificationType": null,
    "errorType": null,
    "reason": null,
    "auto": null,
    "backgroundTasks": null
  }
}
```

```json
{ "v": 1, "kind": "statusline", "source": { … }, "session": { … }, "ts": 1791590400000,
  "fiveHour": { "usedPct": 42, "resetsAt": 1791600000000 }, "sevenDay": null }
```

- `backgroundTasks` ist nur bei `Stop` und `SubagentStop` gesetzt: eine Liste von `{ "id": "<task-id>", "type": "<Rohtyp von Claude Code>" }` ohne Beschreibung; die Zentrale ordnet den Typ einer Art zu (`shell`, `agent`, `monitor`, `other`).
- `auto` ist nur bei `UserPromptSubmit` gesetzt (automatischer Durchgang, 4.5).
- `notificationType`, `reason` und `errorType` (nur `StopFailure`) werden nur als Codes `^[a-z_]{1,32}$` übertragen, sonst `null`.
- Ein Feld `term` gibt es nicht (Windows Terminal ist zurückgestellt).
- `pid`, `entrypoint`, `name`, `hostSessionId` und `bridgeSessionId` ergänzt die Zentrale aus der verknüpften Session-Datei (4.1).

### 8.4 Setup (`vibetribe setup`)

- Läuft auf jedem Host einzeln: Windows (PowerShell), in WSL und auf dem Mac (Mac nicht umgesetzt, Plan 5).
- **Aus dem Plugin (Plan 14, ADR 0011):** Der Property Inspector jeder Aktion zeigt den Zustand der Hooks unter Windows (`missing`, `outdated`, `installed`, gelesen mit `setupState`) und die Knöpfe „Set up hooks“ bzw. „Update hooks“ und „Remove hooks“. Nur dieser Klick ändert `settings.json`.
  - Windows: Das Plugin ruft `install`/`uninstall` des Reporters im eigenen Prozess. Den Reporter schreibt es aus seinem eigenen Code nach `%USERPROFILE%\.vibetribe\reporter.mjs` (es liest nie seinen Plugin-Ordner, DRM); die Hooks laufen mit der Kopie `%USERPROFILE%\.vibetribe\node-<version>.exe` von Stream Decks Node (Version aus `process.versions.node`), weil dessen Ordner die Version trägt und mit App-Updates wechselt. Eine vorhandene Kopie derselben Version wird nie ersetzt (Windows sperrt sie, solange ein Hook sie ausführt); andere Kopien löscht die Einrichtung nach dem Schreiben von `settings.json`, soweit sie nicht gesperrt sind; die Kopie, die die bisherigen Einstellungen nennen, bleibt (laufende Sessions nutzen sie noch), nach einem Update gibt es also bis zum nächsten Update bis zu zwei Kopien. „Remove hooks“ lässt Kopie und Reporter liegen.
  - `outdated`: Hooks und Statusline sind eingetragen, aber `reporter.mjs` ist nicht der Reporter dieses Plugins oder ein `node` der Hooks fehlt. Die Status-Taste zeigt „Setup“, solange der Zustand nicht `installed` ist (Quelle `setup` der Zentrale, veraltet nie).
  - WSL: Die Distribution kommt aus `VIBETRIBE_WSL_DISTRO` (`none` schaltet WSL ab), sonst aus `wsl.exe -l -v` (Zeile mit `*`, UTF-16 oder mit `WSL_UTF8=1` UTF-8; `docker-desktop…` als Standard zählt als keine). Die Suche läuft im Hintergrund, nie vor dem Verbinden mit Stream Deck (bis 15 s nach der Anmeldung möglich), und wiederholt sich bei jedem Öffnen der Seite, bis sie eine Distribution findet; dann kommt die WSL-Quelle der Zentrale dazu und die Seite zeigt „Set up in WSL“ (erst nach Windows) und „Remove from WSL“. Der Klick startet `wsl.exe -d <distro> --cd ~ -e sh -lc …`: `wslpath` übersetzt den Windows-Reporter, der Linux-`node` aus dem Login-`PATH` (`~/.profile`) führt `setup` aus (mit `--windows-home`, aus dem Pfad des Reporters) bzw. `setup --uninstall`. Node.js 20 oder neuer ist Pflicht (der Reporter wird für Node 20 gebaut; Exit 4 sonst); fehlt `node` im Login-`PATH` (Exit 127, z. B. `nvm` nur in `~/.bashrc`), sagt die Seite das. Das startet eine gestoppte Distribution, deshalb nur auf Klick, mit 60 s Zeitlimit.
- **Hooks und Statusline** in `~/.claude/settings.json` eintragen:
  - legt vorher ein Backup an (`settings.json.vibetribe-<datum>.bak`)
  - schreibt atomar (temporäre Datei, dann umbenennen), weil laufende Sessions die Datei überwachen
  - ändert beim zweiten Lauf nichts mehr
  - bestehende Hook-Arrays bleiben erhalten
  - eine bestehende Statusline wird übernommen (siehe 8.1)
  - Pfade in Befehlen stehen mit Schrägstrichen statt Backslashes
- **Windows zusätzlich:**
  - erzeugt den Token (`%USERPROFILE%\.vibetribe\token`)
  - prüft die Portbereiche (nicht umgesetzt; seit Plan 10 weicht die Zentrale selbst auf einen freien Port aus, §8.2)
  - legt, falls Tailscale aktiviert ist (nicht umgesetzt, Plan 5), nach UAC-Rückfrage die Firewall-Regel an (alternativ gibt es den `netsh`-Befehl zum Kopieren aus)
- **WSL zusätzlich:** prüft, ob `/mnt/c/.../.vibetribe/token` lesbar ist.
- **Mac zusätzlich** (nicht umgesetzt, Plan 5): `setup --hub <tailscale-url> --token <token>` (der Token wird von Windows übernommen) schreibt `~/.vibetribe/config.json` und installiert den launchd-Dienst für `vibetribe agent`.
- `vibetribe setup --uninstall` entfernt nur die eigenen Einträge und stellt die vorherige Statusline wieder her.
- Claude-Code-Plugins laden in WSL-Sessions von Claude Desktop nicht. Darum laufen die Hooks bewusst über `settings.json` und nicht als Claude-Code-Plugin.

## 9. Sprung zur Session

Die erste Spalte nennt die Art der Session. Seit Plan 7 ist das nicht mehr das Abzeichen: Eine Desktop-Session zeigt `WIN` oder `WSL`.

| Session | Mechanismus | Rückfall |
|---|---|---|
| Claude Desktop | `claude://claude.ai/epitaxy/<hostSessionId>` öffnen (Format der App selbst; Probe E bestätigt, auch für Sessions in WSL) | `claude://code/continue?session=<hostSessionId>`, sonst Claude-Desktop-Fenster nach vorne |
| CLI (`WIN`/`WSL`) | PowerShell-Skript mit UI Automation (`UIAutomationClient`): Windows-Terminal-Fenster und Tab (`TabItem`) über `WT_SESSION` bzw. Tab-Titel ermitteln und auswählen; für den Vordergrund `AttachThreadInput`, weil Windows `SetForegroundWindow` aus Hintergrundprozessen verweigert | Fenster nach vorne, das die Session wahrscheinlich enthält; Taste zeigt kurz „Tab?“ |
| `REM`, Remote Control | `claude://claude.ai/code/<bridgeSessionId>`: öffnet die Session direkt in Claude Desktop (Probe F); gilt für Remote-Sessions und für jede Session mit Remote Control ohne Desktop-ID | `https://claude.ai/code/<bridgeSessionId>` im Browser (beim ersten Mal ist eine Anmeldung nötig) |

- **Umsetzung (Plan 3d):** `jumpUrlFor(session)` (rein) wählt den Link: Desktop-Session (`entrypoint = claude-desktop`, `hostSessionId = local_…`) → `epitaxy`-Link; sonst eine `bridgeSessionId` → `code`-Link; sonst kein Sprungziel. Der Port `JumpOpener` öffnet ihn; unter Windows `rundll32.exe url.dll,FileProtocolHandler <Link>` über den absoluten Pfad (`%SystemRoot%\System32`), ohne Shell und nur nach Prüfung gegen ein strenges Muster (das SDK-`openUrl` kennt keine eigenen Schemata). Im Headless-Modus wird nur geloggt.
- `JumpResult` ist `opened | logged | failed` und erscheint im Plugin-Log und auf `/debug/keys` (die letzten 10 Sprünge, mit Titel).
- **Web-Seite der Extra-Taste (Plan 7):**
  - `https://claude.ai/settings/usage` geht wie `/debug` über das SDK-`openUrl`. Die Stream-Deck-App öffnet den Standardbrowser; wir starten keinen eigenen Prozess und keine Shell.
  - Geöffnet wird nur nach exaktem Vergleich mit der Liste erlaubter Seiten (`isAllowedWebUrl`).
  - `isJumpUrl` bleibt unverändert. Im Headless-Modus wird nur geloggt.
- **Grenzen unter Windows:** `opened` heißt nur, dass `rundll32` startete. Das Plugin ist ein Hintergrundprozess von `StreamDeck.exe`; die Vordergrund-Sperre von Windows kann Desktop nur in der Taskleiste blinken lassen. Den `claude://`-Handler registriert Claude Desktop als MSIX-Paket; die Registrierung gehört zum Paket und wird mit ihm aktualisiert, `rundll32` löst den Link darüber auf. Eine Prüfung beim Start gibt es seit Plan 10 nicht mehr: Sie las `HKCR\claude\shell\open\command` über `reg.exe`. Diesen Schlüssel fand sie nur, wenn Stream Deck aus WSL heraus startete, nie beim Start durch den Nutzer (Startmenü, Autostart; Plan 8 am Gerät). Sie meldete also einen Fehler, den es beim Springen nicht gab. Ein Sprung, der nicht startet, steht weiter als `(failed)` im Log; fehlt Claude Desktop, zeigt Windows seinen Dialog zur App-Auswahl.
- Während eines Sprungs zeigt die gedrückte Taste 2,5 s lang „Open…“ (Plan 8: Claude Desktop braucht etwa 2 s, bis die Session sichtbar ist, dazu 0,5 s Rand; der Flash kostet unabhängig von der Dauer zwei Bilder und endet sofort, wenn der Slot die Session wechselt). Ohne Sprungziel (z. B. CLI-Session im Terminal) zeigt sie 2 s lang „No link“; das Log nennt die Session.
- **Gesehen:** Ein Slot-Sprung, der nicht `failed` ist, markiert die Session als gesehen (§4.4 a). Die Inbox springt bei jedem Druck; als gesehen gilt erst die Session, auf der der Nutzer landet (5 s ohne weiteren Druck), nur mit Sprungziel und nicht, wenn ihr Sprung `failed` war. Bei der Landung wird nicht erneut gesprungen. Claude Desktop setzt beim Öffnen über den Link `lastFocusedAt` (§4.8); dieser Fokus der eigenen Inbox-Sprünge zählt nicht (bis 5 s nach dem Sprung), übersprungene Sessions bleiben also ungesehen.
- Die Rückfälle der Tabelle (`continue`-Link, Browser, Terminal-Tab) sind in v1 nicht umgesetzt; `WIN`/`WSL`-Sessions im Terminal haben kein Sprungziel.

## 10. Fehlerbehandlung

| Situation | Verhalten |
|---|---|
| Plugin bzw. Zentrale aus | Reporter verwirft Events mit Exit 0; dank `async` läuft Claude unverändert |
| Plugin-Neustart | Zustand aus Session-Dateien, dem Lebenszeichen des Mac-Agents (nicht umgesetzt, Plan 5) und `usage-cache.json` wiederhergestellt; `done_unseen` lokaler Sessions geht verloren; ungelesene REM-Durchgänge erscheinen einmal neu (4.5) |
| WSL-Distro gestoppt | WSL-Quelle „inaktiv“, keine Abfrage, kein Fehler |
| Kein WSL oder keine Standard-Distribution (Plan 14) | keine WSL-Quelle (Status-Zeile WSL `off`), keine WSL-Knöpfe im Property Inspector; beim nächsten Öffnen der Seite wird erneut gesucht |
| Hooks fehlen oder sind veraltet (§8.4) | Status-Taste „Setup“ (nach „Port in use“); der Property Inspector bietet die Einrichtung an |
| WSL fährt während einer Abfrage herunter | Lesefehler auf `\\wsl.localhost` werden als „inaktiv“ gewertet, die Sessions dabei nicht entfernt; nach 3 Fehlversuchen in Folge wird die Quelle für 30 s pausiert |
| Mac nicht erreichbar (nicht umgesetzt, Plan 5) | Mac-Sessions nach 90 s `no_signal`, nach weiteren 2 min entfernt; Status-Kachel: REM-Zeile `down` (`off`, wenn nicht konfiguriert) |
| Remote-Liste nicht erreichbar (429, 5xx, Netz, Anmeldung, unerwartete Antwort) | Pause verdoppelt sich bis 5 min; REM-Sessions nach 90 s `no_signal`, nach 210 s entfernt; Status-Kachel: REM-Zeile `down` (`off`, wenn nicht konfiguriert) |
| Mac-Agent ohne Verbindung zur Zentrale (nicht umgesetzt, Plan 5) | puffert Events (8.1), sendet nach Wiederverbindung zuerst ein vollständiges Lebenszeichen |
| Usage-Endpunkt 429 | Backoff bis 30 min, Anzeige `As of 14:32` |
| Usage-Endpunkt 401 | Anzeige `Sign in` (Anmeldung abgelaufen); erneute Abfrage erst nach Änderung der Anmeldedatei |
| Port belegt (`EADDRINUSE`/`EACCES`) | nächster freier Ersatzport (§8.2), Logzeile `hub listening on 127.0.0.1:<Port> (<abgelehnte Ports mit Code>)`, Port-Datei. Ist keiner frei: Status-Kachel rot mit „Port in use“, eine Logzeile mit den geprüften Ports, alle 5 s ein neuer Versuch; `background.json` wird bis dahin nicht geschrieben (4.6) |
| Request ohne Token, mit falschem Host oder mit `Origin` | 401 bzw. 403, im Debug-Log gezählt |
| Fehlerhaftes Event | verwerfen, im Debug-Log zählen, Antwort 400 |
| Konfiguration von Claude Desktop fehlt oder ist anders geformt (§4.7) | keine Pins: Slot-Zuordnung wie ohne Pins, kein Fehler, keine Logzeile; die Spalte „Pin“ der Debug-Seite zeigt überall „–“ |
| Konfiguration von Claude Desktop gerade unlesbar (gesperrt, halb geschrieben) | die zuletzt gelesenen Pins bleiben bis zum nächsten Lesen (5 s), keine Logzeile |
| Session-Ordner oder -Datei von Claude Desktop fehlt, ist gesperrt oder halb geschrieben; `lastFocusedAt` fehlt oder ist keine Zahl (§4.8) | keine Wirkung: die Episode bleibt ungesehen, kein Fehler, keine Logzeile; die nächste Runde (5 s) liest erneut, eine unbekannte oder unlesbare Datei mit neuem Scan |
| `lastFocusedAt` liegt nach jetzt (Uhr zurückgestellt) | zählt nicht, bis die Uhr es erreicht |
| Eine undokumentierte Schnittstelle hat sich geändert (§11.3) | die stündliche Selbstprüfung schreibt einmal `drift: <name>: <detail>` und bei Rückkehr `drift resolved: <name>`; das Verhalten bleibt sonst gleich (fail-soft wie oben); `pnpm drift` nennt alle Abweichungen |

## 11. Debugging und Tests

### 11.1 Debugging

- **Debug-Seite** `http://127.0.0.1:<port>/debug` (Port aus der Logzeile `hub listening on …` bzw. aus `%USERPROFILE%\.vibetribe\port`, meist 43710):
  - Spiegel der Tasten mit genau den Bildern, die zuletzt per `setImage` gesendet wurden
  - Session-Tabelle mit Herkunft, Zustand, offenen Wartegründen, Episode und den letzten 20 Roh-Events; die Spalte „Pin“ nennt den Platz einer Session in der Pin-Liste von Claude Desktop (ab 1, sonst „–“; Plan 11), auch wenn „Prefer pinned sessions“ aus ist
  - Gesundheit der Quellen, Bildbudget (`setImage`/s) und Ergebnisse der Sprünge
- **`/debug/state.json`:** dieselben Daten maschinenlesbar, damit Claude per `curl` prüfen kann, was angezeigt wird.
- **Simulator** `vibetribe simulate <szenario>`: spielt Event-Folgen aus `fixtures/scenarios/*.jsonl` gegen die laufende Zentrale ab, z. B. `three-sessions-one-waiting`, `mac-offline`, `limits-near-cap`, `subagent-parallel-permission`, `esc-interrupt`, `done-with-background-jobs`.
- **Headless mit Remote-Sessions** (Plan 3d): `VIBETRIBE_REMOTE_FIXTURE=<json>` speist die Remote-Quelle aus einer Datei in der Form von `/v1/code/sessions` (rohe Ids `cse_…`, bei jeder Abfrage neu gelesen, echter Parser, der sie zu `session_…` normalisiert); Tastendrücke über stdin (`press <key-id>`, `long <key-id>`); Sprünge werden nur geloggt. Port 43799; 43710 und die Ersatzports (§8.2) verweigert er, eine Port-Datei schreibt er nie. `rundll32` wird im Headless-Modus und in Tests nie gestartet; Tests laden eine Wache, die Verbindungen zu und Bindungen an 43710 und die Ersatzports verweigert, auch in Node-Prozessen, die sie starten (`test/real-ports-guard.mjs`).
- **Logs** unter `%APPDATA%\vibetribe\logs\` mit Rotation (5 × 1 MB); nie im Plugin-Verzeichnis.
- **Keine Geheimnisse:** `state.json`, Debug-Seite und Logs enthalten nie OAuth-Token, Hub-Token oder Inhalte von Anmeldedateien.
- Debuggen des Plugin-Prozesses über den Node-Inspector im Entwicklungsmodus der Stream-Deck-CLI.

### 11.2 Tests (vitest)

- **`core`:**
  - Event-Folgen → Zustände, inklusive Reihenfolge-Vertauschung (`PreToolUse` nach `PermissionRequest`)
  - parallele Wartegründe bei Subagents
  - Abbruch per Esc über einen `idle`-Wechsel der Session-Datei
  - `throttled`
  - Hintergrund-Jobs: Momentaufnahme aus `Stop`, Zählung über Subagent-Events, Übergänge `done_unseen → background → idle`, 30-min-Absicherung
  - Priorität
  - Episoden ohne Duplikate und „gesehen“
  - Eskalationszeiten mit Fake-Clock
  - Bildbudget-Scheduler (≤ 10/s)
  - Lebenszeichen inklusive wiederverwendeter PIDs und maßgeblicher Mac-Liste
  - Slot-Zuordnung inklusive Überlauf und `/clear`-Reservierung
  - Tempo-Berechnung und Fensterwechsel
- **`render`:**
  - Jede Kachel in jedem Zustand wird gegen ein gespeichertes Referenz-SVG verglichen (Datei-Snapshot). resvg rendert deterministisch, also ergibt ein gleiches SVG ein gleiches PNG. Die PNG-Erzeugung ist separat getestet.
  - `pnpm gallery` erzeugt eine HTML-Galerie aller Zustände zur Sichtprüfung und zum Vergleich mit Claude Design.
  - resvg prüft das Layout, nicht die Darstellung auf dem Gerät. Deshalb gibt es einmalig einen Abgleich auf dem echten Deck bzw. dem Virtual Stream Deck (Probe I).
- **`reporter`:**
  - immer Exit 0
  - Timeout wird eingehalten
  - keine Ausgabe auf stdout in der Hook-Rolle
  - Statusline: paralleler Start, Ausgabe des vorherigen Befehls unverändert, Verhalten bei Abbruch
- **`setup`:** in temporären Verzeichnissen
  - Backup wird angelegt, Schreiben ist atomar
  - zweiter Lauf ändert nichts
  - fremde Hooks bleiben erhalten
  - Deinstallation entfernt nur die eigenen Einträge und stellt die Statusline wieder her
- **`plugin`:**
  - HTTP-Endpunkte: Host-Check, `Origin`-Ablehnung, Token-Pflicht, 400 bei fehlerhaften Events, sofortiges 202
  - Leser für Session-Dateien gegen Fixture-Verzeichnisse
  - Usage-Abfrage mit gemocktem Endpunkt (429-Backoff, 401, Cache)

### 11.3 Drift-Prüfungen und Live-Test (Plan 13)

- **Warum:** VibeTribe liest undokumentierte Schnittstellen: Claude Desktops Ordner, Konfiguration und Session-Dateien (§4.7, §4.8), die Session-Dateien von Claude Code (§4.3), `/v1/code/sessions` und `/api/oauth/usage` (§4.3, §7.1) und den Port-Block von WSL (§8.2). Sie ändern sich mit Updates ohne Ankündigung (2026-10-16: der WSL-Block lag über 43710; 2026-10-17: Desktop zog von `…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude` nach `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc`, Pins und „gesehen“ fielen still aus). Bruch wird gemeldet statt am Deck entdeckt.
- **`pnpm drift`** (in WSL): nur lesend, kein Modellaufruf. Je Annahme eine Zeile `<name>: ok (…)`, `<name>: changed: …` oder `<name>: skipped: …`; Exit 1, sobald eine Zeile `changed` ist, `skipped` heißt „gerade nicht prüfbar“ (gesperrt, keine lebende Session, Login abgelaufen, 401/429/Netz, keine Zentrale, Prozessliste von Windows nicht lesbar). Geprüft werden:
  - `desktop folder`, `desktop pins`, `desktop session files`: die erste vorhandene `claude_desktop_config.json`, die Liste `pinnedOrder` mit Einträgen `code:local_<uuid>`, Session-Dateien drei Ebenen unter `claude-code-sessions` mit numerischem `lastFocusedAt` (Anzahl, Alter des jüngsten);
  - `session files (Windows)`, `session files (WSL)`: jede `<pid>.json` eines gerade laufenden Prozesses mit `sessionId`, eigener pid und `procStart`; an lebenden Prozessen (Regel der Zentrale) ein bekannter `status` und bei Desktop-Sessions eine Desktop-Id. Lässt sich die Prozessliste von Windows nicht lesen, ist nur die Windows-Prüfung `skipped` (`process list unavailable`), die WSL-Prüfung läuft weiter;
  - `credentials`, `remote session list`, `usage`: die Form der Anmeldedatei; je eine GET-Abfrage wie die Zentrale; jeder Wert von `status`, `status_bucket`, `status_category`, `worker_status`, `connection_status` und `environment_kind` bekannt (`KNOWN_REMOTE_VALUES`), `unread` boolesch, mindestens ein String `connection_status`, `status` und `environment_kind` (sonst `no string <feld>`) und eine verwendbare Id für angezeigte Einträge (sonst `no usable id`; die Prüfung nutzt dieselbe Auswahl `isShownRemote` wie der Mapper); `five_hour`, `seven_day`, `extra_usage` lesbar und ein bekannter Grund für „Extra aus“;
  - `ports`: 43710 und die Ersatzports gegen den WSL-Block und die Ausschlussbereiche von Windows; Drift, wenn keiner frei ist oder mehr als ein Port blockiert ist;
  - `port file`, `hub sources`, `desktop ids in hub`, `pins in hub`: gegen `/health` und `/debug/state.json` der laufenden Zentrale (Port-Datei = Port der Zentrale, keine Quelle mit einer Antwort ohne erwartete Form – andere Ausfälle nur mit dem Namen der Quelle –, jede lebende Desktop-Session mit Desktop-Id, dieselben Pins wie Desktops Konfiguration);
  - `stream deck plugin`: der Plugin-Ordner von `pnpm plugin:deploy`.
  Die Prüfungen rufen die Parser und Mapper der Produktion; ein Format steht nur einmal im Code. Die Ausgabe nennt nur Zahlen, Alter und bekannte Wörter, nie Titel, Ids, Inhalte oder Tokens. Wann: nach jedem Update von Claude Desktop, Claude Code, Windows oder WSL und wenn Pins, „gesehen“ oder Sprünge still nicht mehr wirken.
- **Stündliche Selbstprüfung:** Die Zentrale führt beim Start und dann jede Stunde den Teil ohne Tokens und ohne WSL aus (`desktop folder`, `desktop pins`, `desktop session files`, `port file` gegen den gebundenen Port) und loggt nur Wechsel: `drift: <name>: <detail>` beim Wechsel nach `changed`, `drift resolved: <name>` beim Wechsel nach `ok`; `skipped` ändert nichts. Die API-Prüfungen bleiben dem `pnpm drift` (ihre Fehler zeigt die Zentrale schon als Quellen-Fehler), die Port-Prüfung ebenso (sie braucht WSL).
- **`pnpm e2e:live --spend-tokens`** (opt-in, ADR 0010; ohne den Schalter und mit `CI` verweigert es mit Exit 2): je Host mit CLI (Windows `claude.exe`; WSL, wenn ein `claude` im `PATH` liegt) ein Durchgang `claude -p --model haiku` mit einem Mini-Prompt im Wegwerf-Ordner, mit den Hooks der Nutzer-Einstellungen, ohne MCP, Skills und Transkript, höchstens 0,05 $. Die `init`-Nachricht der Ausgabe muss ein Haiku-Modell und keinen API-Schlüssel nennen (`apiKeySource` `none`), sonst ist die Zeile `<host> model` Drift; `ANTHROPIC_MODEL` und `ANTHROPIC_DEFAULT_HAIKU_MODEL` werden auf der WSL-Seite entfernt (ein aus WSL gestartetes `claude.exe` bekommt die Umgebung von Windows). Über `/debug/state.json` geprüft: `SessionStart`, `UserPromptSubmit`, `Stop` und `SessionEnd` kommen an; die Session steht nach dem Durchgang auf `done_unseen` (stdin bleibt bis dahin offen) und verschwindet nach dem Ende; ihre Session-Datei hat, falls der Druckmodus eine schreibt, ihre Form. Die Kosten werden gedruckt, der Prozess beendet, der Ordner gelöscht (ein Rest wird gemeldet). Wird der Lauf abgebrochen, bevor `claude` endet, bleibt die Session auf dem Deck, bis die Zentrale sie als beendet entfernt. Ein `need_input`-Durchgang ist im Druckmodus weder billig noch deterministisch und fehlt. Nie in `pnpm check`, Tests oder CI (verweigert mit `CI`), nur auf ausdrücklichen Wunsch des Nutzers.
- **Nur von Hand prüfbar** (Seiteneffekte): Sprung öffnet die richtige Session in Desktop und setzt `lastFocusedAt`; Klick in Desktop macht Done ruhig (§4.8); `claude://`-Handler über `rundll32`; Property Inspector „Prefer pinned sessions“; Kacheln, Atmen und Rahmen am Gerät; Freigabe und Frage in Desktop-Sessions; Token-Erneuerung über `claude -p /cost`; Extra-Taste öffnet die Usage-Seite.

## 12. Kachel-Vertrag für Claude Design

Das Aussehen der Kacheln entsteht in Claude Design. Dieser Abschnitt legt fest, was jede Kachel leisten muss.

- **Format:** 144×144 px; die Stream-Deck-App verkleinert auf 72 px. Mindestschrift 18 px (bei 144), Titel höchstens 2 Zeilen.
- **Typografie (Handoff v2, 2026-10-14):** compact: Titel 20 px (→ 18), Zustandswort 20 px (→ 18). Comfortable (Standard): Titel 22 px (→ 20 → 18) auf den Grundlinien 72/99, Zustandswort 20 px (18 neben dem ◑-Abzeichen oder wenn es nicht passt); reguläre Texte (Titel, Einheiten, Hinweise, Gewicht 400) tragen eine 0,7-px-Kontur in ihrer eigenen Farbe (`stroke-text`), damit sie auf dem LCD wie Halbfett wirken, ohne breiter zu laufen.
- **Rahmen (R12, bewusste Abweichung vom Handoff):** Die Gehäusekante des Stream Deck verdeckt die äußeren Pixel einer Taste. Deshalb liegt die Außenkante jedes Rahmens (dick, dünn, gestrichelt; beide Varianten, auch der Alarmrahmen der Status-Taste) bei 2 px statt bei 0–1 px; der äußere Eckenradius bleibt wie im Handoff. Comfortable dick: `x=5 y=5 134×134 rx=15`, Strich 6. Compact dick: Strich 7 statt 8 (`x=5.5 133×133 rx=14.5`), damit die Innenkante bei 9 px bleibt und Texte und Symbole ab x = 10 frei stehen. Tönung und Grund bleiben unverändert.
- **Technische Grenzen:**
  - keine SVG-Filter
  - keine Webfonts; nur verbreitete Systemschriften oder Text als Pfade
  - keine externen Ressourcen
- **Pflichtinhalte:**

| Kachel | Pflicht | Optional |
|---|---|---|
| Slot × 9 Zustände | Titel, Zustandssymbol, Zustandswort, Herkunfts-Abzeichen; Wartezeit-Uhr bei Episoden; Hintergrund-Abzeichen mit Anzahl, wenn Jobs laufen | Detailzeile (Tool, Subagent, Aufteilung der Hintergrund-Jobs) |
| Slot leer | — | dezente leere Kachel |
| Slot „Sprung läuft“ | Hinweis „…“ | — |
| Inbox | dringendste Session (Titel und Zustand), Zahl der wartenden Sessions | `+N` Sessions, die Aufmerksamkeit brauchen, ohne sichtbaren Slot (needs_permission/needs_input/error/done_unseen, ungesehen, §6.3; Done counts as attention, user decision 2026-10-14) |
| 5h / Woche | Ring in %, Tempo-Markierung, Reset-Countdown | Pfeil nach oben neben der Tempo-Zahl (vor Plan), `As of 14:32`, `Sign in` |
| Extra Usage | Betrag / Limit in Währung, Balken | `As of 14:32`, `Disabled` |
| Status | vier Quellen (WIN, WSL, REM, LIM) mit je vier Zuständen (`ok`, `stale`, `down`, `off`) | Hinweise `Port in use`, `Setup`, `No token` |

- **Farben:** final aus dem Claude-Design-Handoff, auf Basis von Okabe-Ito (`#0072B2`, `#E69F00`, `#D55E00`, `#009E73`, `#56B4E9`) auf dunklem Grund. Jede Zustandsfarbe braucht ein Symbol und ein Wort. Die Abzeichen sind farbneutral.
- **Animation als Parameter, nicht als GIF:** Atmen (nur `needs_*`; Periode 1,2 s, 4 Stufen 0,35 · 0,675 · 1 · 0,675 für Rahmen und Tönung; `done_unseen` atmet nie, R11), Arbeitszeichen (heller Punkt wandert alle 2 s, `tick` 0–2). Der Renderer erzeugt die einzelnen Bilder.
- **Übergabe:** Claude Design liefert pro Kacheltyp ein SVG oder Komponenten-Markup plus Design-Tokens. Seit Plan 6 ist `render` ein Port des Referenz-Renderers aus `docs/design/handoff-2026-10-13/` (Varianten comfortable – Standard – und compact, im Handoff `luftig` und `dicht`; Kacheltexte englisch); die 52 Referenz-SVGs je Variante (seit 2026-10-14 Handoff v2) sind byte-genaue Testvorlage, ausgenommen nur die Geometrie des Rahmens `vt-frame` (R12), die PNG-Galerie dient als Sichtabgleich.

## 13. Repo und Werkzeuge

- pnpm-Workspace, TypeScript (strict), Biome, vitest, Node 24
- `@elgato/streamdeck` 3.x, Manifest `SDKVersion` 3, Stream Deck ≥ 7.1
- Stream-Deck-CLI `@elgato/cli` als Dev-Abhängigkeit: `pnpm plugin:pack` baut, prüft (`streamdeck validate`) und packt nach `dist/dev.h2k.vibetribe.streamDeckPlugin`; dazu die Bilder für den Maker Console nach `dist/marketplace/` (Plan 14). `.sdignore` hält Logs und die SVG-Quelle des Icons aus dem Paket.
- Plugin-UUID `dev.h2k.vibetribe` (Domain h2k.dev)
- Lizenz MIT
- GitHub `h-mergel/vibetribe` (öffentlich)
- Der Reporter wird zu einer einzelnen `.mjs`-Datei gebündelt und von `setup` an einen festen Ort pro Host kopiert (`~/.vibetribe/reporter.mjs`). Es gibt keine globale npm-Installation. Das Plugin trägt dasselbe Bundle als Text in `bin/plugin.js` (§8.4).

## 14. Risiken und früh zu prüfende Annahmen

Diese Punkte werden als erste Aufgaben im Umsetzungsplan geprüft (Wegwerf-Tests, je 1–2 h). Die Ergebnisse fließen in die Spezifikation zurück, bevor die betroffenen Teile gebaut werden.

| # | Frage | Betrifft |
|---|---|---|
| A | **Hook-Latenz:** synchron vs. `async: true`, mit Shell vs. direktem `node`-Aufruf; unter Windows, in WSL, in Desktop-Sessions unter WSL. Lässt sich `node` dort per absolutem Pfad starten? | 8.1, Kriterium 5 |
| B | **Event-Reihenfolge und Subagents:** Kommt `PermissionRequest` vor dem zugehörigen `PreToolUse` an? Tragen Events aus Subagents `agent_id`/`tool_use_id`? Feuern `PermissionRequest` und `Elicitation` auch in Desktop-Sessions? Was passiert bei Esc? | 4.2 |
| C | **Hooks in Desktop-Sessions unter WSL:** Feuern die Hooks aus `~/.claude/settings.json` dort zuverlässig? | 4, 8 |
| D | **Tab-Zuordnung in Windows Terminal:** UI Automation über mehrere Fenster; ist `WT_SESSION` in WSL sichtbar (WSLENV); Tab-Titel nach Claudes eigener Titeländerung; `AttachThreadInput` für den Vordergrund | 9 |
| E | **Deep-Link `claude://code/continue`:** Öffnet er in der installierten Version von Claude Desktop die richtige Session, auch für Sessions in WSL? | 9 |
| F | **URL von Remote-Control-Sessions:** Wie wird aus `bridgeSessionId` die claude.ai/code-URL, und öffnet Claude Desktop sie? | 9 |
| G | **WSL-Abfragen:** Latenz von `\\wsl.localhost\…\proc\<pid>\stat`; Verhalten bei `wsl --shutdown`; startet der Zugriff eine gestoppte Distro trotz Prüfung per `wsl.exe -l --running`? Dauer von `Get-CimInstance` für 10 PIDs | 4.3 |
| H | **`setImage`-Durchsatz auf dem MK.2:** Ab welchem Tempo entstehen Verzögerungen oder Fehler in der Reihenfolge? | 5 |
| I | **Darstellung auf dem Gerät:** resvg-PNG vs. echtes Deck bzw. Virtual Stream Deck (Schriften, Strichstärken, Verkleinerung auf 72 px) | 11, 12 |
| J | **Tailscale:** (nicht umgesetzt, Plan 5) Bindung der Zentrale auf die Tailscale-IP, Firewall-Regel für das `node.exe` der Stream-Deck-App, Verbindung vom Mac-Agent | 8.2 |
| K | **Usage-Endpunkt:** Antwortform inklusive `extra_usage`, Verhalten mit den aufgeführten Headern, tatsächliche Rate-Limits | 7.1 |
| L | **Loopback-Absicherung:** CSRF-Test aus dem Browser gegen die Zentrale (muss abgelehnt werden) | 8.2 |
| M | **Hintergrund-Jobs:** Welche Arten enthält `Stop.background_tasks[]` (Shell, Agent, Monitor, Workflow) und mit welchen Feldern? Welche Events feuern, wenn ein Job endet, während die Session ruht? Kommt die Liste auch bei Sessions in Claude Desktop an? | 4.6 |

**Ergebnisse von Plan 1** (Details unter `docs/research/probes/`):

| # | Ergebnis |
|---|---|
| A | bestätigt: direkter `node`-Aufruf, `async`; WSL 32 ms, Windows 68 ms pro Aufruf (`a-hook-latency.md`) |
| B | geändert (§4.1, §4.2): Reihenfolge PreToolUse → PermissionRequest; PermissionRequest ohne `tool_use_id`, mit `agent_id`; Ablehnen/Stoppen ohne Hook (`b-c-m-hook-events.md`) |
| C | bestätigt, geändert (§4.1): Hooks feuern in Desktop unter WSL und Windows; die Hook-Umgebung liefert PID, Herkunft und Desktop-ID |
| D | zurückgestellt: Der Nutzer öffnet Sessions nicht im Terminal; der Sprung läuft über Desktop. Probe vor Plan 4, falls Terminal-Unterstützung gebraucht wird |
| E | geändert (§9): `claude://claude.ai/epitaxy/<hostSessionId>` und `claude://code/continue` funktionieren (`e-f-links.md`) |
| F | geändert (§9): `claude://claude.ai/code/<bridgeSessionId>` öffnet Remote-Control-Sessions in Desktop |
| G | geändert (§4.3): procStart = Feld 22 bzw. FILETIME exakt; Get-CimInstance zu teuer pro Abfrage; Test mit gestoppter Distro nicht durchgeführt (`g-liveness.md`) |
| H | bestätigt: MK.2 verarbeitet 30 Bilder/s; Budget bleibt bei 10/s (Elgato-Richtwert, eine Konstante) (`h-i-l-plugin.md`) |
| I | bestätigt: SVG-Data-URLs funktionieren, Spiegel und Gerät stimmen Bild für Bild überein (`h-i-l-plugin.md`) |
| L | Gerät bestätigt: Nach Seitenwechsel kehren dieselben Sessions auf dieselben Tasten zurück (§6.3); Browser-CSRF-Test nicht wiederholt (`h-i-l-plugin.md`) |
| Q3 | geändert: `streamdeck://plugins/restart/dev.h2k.vibetribe` lädt das Plugin ohne Entwicklermodus nicht neu; nach jedem Deploy App vollständig neu starten (`h-i-l-plugin.md`) |
| J | offen: in Plan 5 (braucht den Mac) |
| J2 | geändert: Remote-Sessions sind ohne Mac-Agent über `GET /v1/code/sessions` (OAuth) sichtbar; umgesetzt in Plan 3d, Abfrage alle 20 s gemessen (`j2-remote-sessions-api.md`, `j2b-remote-sessions-rate.md`) |
| K | geändert (§7.1): Antwortform und Mapping; Token-Erneuerung über das CLI nötig (`k-usage-endpoint.md`) |
| M | geändert (§4.6): `shell`/`subagent`, Momentaufnahmen aus Stop und SubagentStop, Job-Ende = automatischer Durchgang |
