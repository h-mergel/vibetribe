# Proben B, C, M – Hook-Events, Desktop-Sessions, Hintergrund-Jobs

## Frage

- **B:** Event-Reihenfolge und Subagents. Kommt `PermissionRequest` vor dem zugehörigen `PreToolUse` an? Tragen Events aus Subagents `agent_id`/`tool_use_id`? Feuern `PermissionRequest` und `Elicitation` auch in Desktop-Sessions? Was passiert bei Esc?
- **C:** Feuern die Hooks aus `~/.claude/settings.json` in Desktop-Sessions unter WSL zuverlässig?
- **M:** Welche Arten enthält `Stop.background_tasks[]`, mit welchen Feldern? Welche Events feuern, wenn ein Job endet, während die Session ruht? Kommt die Liste auch bei Desktop-Sessions an?

## Methode

- **Recorder:** Wegwerf-Recorder (`probes/hook-recorder`), asynchron, ohne Shell (`command` = absoluter Node-Pfad plus `args`), eingetragen in `~/.claude/settings.json` unter WSL und unter Windows. Er schwärzt Freitext per Positivliste. Parallel liefen Watcher für die Session-Dateien.
- **Umgebung:** Claude Desktop (Code-Tab) unter Windows 11, Claude Code 2.1.295 (Desktop-Remote-CLI in WSL), Windows-CLI 2.1.287.
- **Passive Phase:** rund 2.200 Events aus den laufenden Desktop-Sessions des Nutzers.
- **Gezielte Phase:** zwei Desktop-Test-Sessions, eine auf `/tmp/vt-probe` (WSL), eine auf `C:\Temp\vt-probe` (Windows), im Modus „Manuell“ (`default`). Die Prompts kamen per Session-Nachricht. Szenarien: S1–S11, S15, W1–W2 (siehe Plan 1).
- **Desktop-Sessions unter WSL:** Desktop startet sie über `~/.claude/remote/srv/<hash>/server`. Das CLI liegt unter `~/.claude/remote/ccd-cli/<version>` (`--output-format stream-json --permission-prompt-tool=stdio`), nicht im PATH. Ein Terminal-CLI unter WSL nutzt der Nutzer nicht.

## Ergebnis

### C – Hooks in Desktop-Sessions

- **C1:** Hooks aus `~/.claude/settings.json` feuern in Desktop-Sessions unter **WSL und Windows**. Beobachtet wurden `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop` und `SessionEnd`.
- **C2:** Die Umgebung jedes Hook-Prozesses enthält unter anderem:
  - `CLAUDE_CODE_ENTRYPOINT=claude-desktop`
  - `CLAUDE_CODE_HOST_SESSION_ID` (= Desktop-ID `local_…`)
  - `CLAUDE_CODE_SESSION_ID`
  - `CLAUDE_PID`
  - `CLAUDE_PROJECT_DIR`
  - `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`
  - `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`

  `WT_SESSION` fehlt, weil kein Terminal beteiligt ist. Der Reporter kann PID, Herkunft und Desktop-ID also direkt aus der Umgebung lesen.
- **Workspace-Vertrauen:** Hooks feuern erst, nachdem der Ordner als vertrauenswürdig bestätigt wurde.

### B – Reihenfolge, Freigaben, Abbruch

- **B1:** `PreToolUse` kommt vor `PermissionRequest`. Abstand 7–48 ms in allen Fällen (5 von 5).
- **B2:**
  - `PreToolUse` und `PostToolUse` tragen `tool_use_id`, **`PermissionRequest` nicht**.
  - Events aus Subagents tragen `agent_id`, auch `PermissionRequest`.
  - `Notification` trägt **keine** `agent_id`.
  - Beispiel S7 mit zwei parallelen Subagents: zwei `PermissionRequest` mit `agent_id` a1 bzw. a2, danach zwei anonyme `Notification permission_prompt`.
- **B3:**
  - **Erlauben:** `PermissionRequest` → `PostToolUse` → `Stop`.
  - **Ablehnen (S3):** **kein** `PostToolUseFailure` und **kein** `Stop`. Der Durchgang endet, und das Modell antwortet nicht mehr. Nur die Session-Datei wechselt `waiting` → `idle`.
  - **Stopp während der Antwort (S5c):** **kein** `Stop`, Session-Datei `busy` → `idle`.
  - **Plan ablehnen (S10):** wie Ablehnen, kein `Stop`.
- **B4:** `Notification` mit `notification_type: permission_prompt` kommt etwa 8,2–8,3 s nach `PermissionRequest`, aber nur, wenn die Freigabe noch offen ist. Bei Freigabe innerhalb von 2,3 s (S2b) kam keine. Kein `idle_prompt` innerhalb von 80 s nach einem fertigen Durchgang (S11).
- **B5:**
  - **AskUserQuestion (S4):** `PreToolUse AskUserQuestion` → **`PermissionRequest AskUserQuestion`** → `Notification permission_prompt`. **Kein `Elicitation`.** Die Session-Datei sagt `waitingFor: "input needed"`.
  - **Plan-Freigabe (S10):** `PreToolUse ExitPlanMode` → `PermissionRequest ExitPlanMode` → `Notification permission_prompt`. Die Session-Datei sagt `waitingFor: "permission prompt"`.
- **B6:** Die Hook-`session_id` ist identisch mit `sessionId` in `~/.claude/sessions/<pid>.json`. Die Datei enthält `hostSessionId` = Desktop-ID und `name` = Titel aus der Seitenleiste.
- **B7:** `UserPromptSubmit` hat für echte und automatische Durchgänge dieselbe Struktur: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`, `prompt`, `session_title`. Unterscheidbar nur am **Prompt-Anfang**:
  - automatisch nach einem Job-Ende: `<task-notification>` (im Transcript `origin.kind = "task-notification"`)
  - Nachricht einer anderen Session: `Another Claude session sent a message:` (`origin.kind = "peer"`)
- **B8:**
  - `--resume` und `/clear` sind in Desktop nicht anwendbar, also nicht geprüft.
  - Archivieren einer Session: `SessionEnd` mit `reason: "other"`, die Session-Datei wird gelöscht.
  - `permission_mode` steht in jedem Event (`auto`, `default`, `plan`). Im Modus `auto` gibt es keine `PermissionRequest`.
  - Reine Lesebefehle (`ls`) und das Anlegen einer Datei im eigenen Arbeitsordner (Windows, W2) laufen ohne Freigabe.

### M – Hintergrund-Jobs

- **M1:** `Stop.background_tasks[]` hat Einträge der Form:
  - `{ id, type: "shell", status: "running", description, command }`
  - `{ id, type: "subagent", status: "running", description, agent_type }`

  `SubagentStop` liefert **ebenfalls** die vollständige Liste der Session.
- **M2:** Endet ein Job, während die Session ruht, startet Claude **einen automatischen Durchgang**: `UserPromptSubmit` (Prompt beginnt mit `<task-notification>`) → `Stop` mit der aktualisierten Liste. Ein `TaskCompleted`-Event gab es nicht. Hintergrund-Agents können erneut `SubagentStart` mit derselben `agent_id` auslösen, wenn sie aufgeweckt werden.
- **M3:** Die Liste kommt auch bei Desktop-Sessions an, unter WSL und Windows.

## Folge für die Spec

- **§4.1 / §8.1 / §8.3:** Der Reporter liest aus der Hook-Umgebung `CLAUDE_PID`, `CLAUDE_CODE_ENTRYPOINT` und `CLAUDE_CODE_HOST_SESSION_ID` und sendet sie in der Hülle mit (`session.pid`, `source.entrypoint`, `session.hostSessionId`). Die Session-Datei bleibt Lebenszeichen und Quelle für `name`, `status` und `waitingFor`.
- **§4.2 Normalisierung:**
  - `PermissionRequest` → `wait_start` mit `waitId: null`, `toolName`, `agentId`. Bei `toolName` ∈ {`AskUserQuestion`, `ExitPlanMode`} mit `reason: input`, sonst `permission`.
  - `Notification permission_prompt` → nur dann ein anonymer Wartegrund, wenn noch kein Wartegrund offen ist. Sonst verwerfen, denn es ist ein Duplikat einer Freigabe, die schon erfasst ist.
  - `Elicitation`/`ElicitationResult` bleiben eingetragen, sind aber in Desktop nicht beobachtet.
- **§4.2 Grundsatz (bestätigt und verschärft):** Ablehnen, Stoppen und Plan-Ablehnen erzeugen kein Hook-Event. **Die Session-Datei ist für das Ende von Wartezuständen und Durchgängen zwingend.** Abfrage-Intervall 1–2 s statt 5 s für bekannte Sessions in `waiting`/`busy`.
- **§4.5:** Automatische Durchgänge erkennt der Reporter lokal am Prompt-Anfang (`<task-notification>`, `Another Claude session sent a message:`) und sendet nur `auto: true/false`, nie den Text.
- **§4.6:** `background_tasks` aus `Stop` **und** `SubagentStop` sind maßgebliche Momentaufnahmen. Arten: `shell` → `shell`, `subagent` → `agent`, sonst `other`.
- **§8.1 Event-Liste:** `TaskCreated`/`TaskCompleted`, `Elicitation`/`ElicitationResult` und `PreCompact` sind bei Desktop unbeobachtet. Sie bleiben (harmlos), werden aber nicht vorausgesetzt.
