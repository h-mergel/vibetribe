# Probe G – Kosten und Verlässlichkeit der Lebenszeichen-Prüfung

## Frage

- Wie lange dauert das Lesen von `\\wsl.localhost\…\proc\<pid>\stat`, wie verhält es sich bei `wsl --shutdown`, und startet der Zugriff eine gestoppte Distro trotz der Prüfung per `wsl.exe -l --running`?
- Wie lange dauert `Get-CimInstance` für 10 PIDs?

## Methode

- `probes/liveness/bench.mjs` (Windows-Node, WSL lief).
- Vergleich von `/proc/<pid>/stat` Feld 22 mit `procStart` lebender Sessions (`procstart-check`).

## Ergebnis

- **`wsl.exe -l --running --quiet`** (UTF-16-Ausgabe) dauert 74 ms und liefert `["Ubuntu","docker-desktop"]`.
  - Docker Desktop hält die WSL-VM ohnehin am Laufen. Eine Prüfung allein auf `vmmemWSL` genügt deshalb nicht, es muss die Distro geprüft werden.
- **`readdir` des WSL-Session-Ordners** über `\\wsl.localhost` dauert 10 ms bei 612 Dateien, die meisten davon Leichen.
- **`/proc/<pid>/stat` lesen** dauert über `\\wsl.localhost` rund 18 ms pro PID, inklusive JSON-Lesen.
- **WSL-Startzeit:**
  - Feld 22 (Clock-Ticks, `CLK_TCK` = 100) ist **identisch** mit `procStart` der Session-Datei (pid 497651: 921344 = 921344).
  - Alte Dateien mit wiederverwendeten PIDs fallen sofort auf, z. B. pid 713: 6900 ≠ 587.
- **Windows-Startzeit:**
  - `procStart` ist eine FILETIME (100 ns seit 1601): `134360984898638759 / 1e4 − 11644473600000 = 1791624889863.9 ms` entspricht `CreationDate /Date(1791624889863)/`, also exakt.
  - `Get-CimInstance` für 5 PIDs per `powershell.exe` dauert aber **1417 ms**, fast nur PowerShell-Start.
- **Nicht durchgeführt:** Test mit gestoppter Distro (`wsl --terminate`). Er hätte alle Desktop-Sessions des Nutzers unter WSL abgebrochen. Weil die VM wegen Docker ohnehin läuft, ist der Fall selten. Die Spec verlangt die Prüfung per `wsl -l --running` vor jedem Zugriff ohnehin.

## Folge für die Spec

- **§4.3 Windows:** Kein PowerShell-Aufruf pro Abfrage. Ob ein Prozess noch existiert, prüft das Plugin per `process.kill(pid, 0)` (kostenlos). Die Startzeit prüft es nur für neue oder geänderte PIDs, gebündelt über einen einzigen dauerhaft laufenden PowerShell-Kindprozess.
- **§4.3 WSL:** `procStart` gegen `/proc/<pid>/stat` Feld 22, gleiche Einheit, bestätigt.
- **§4.3:** Die Session-Ordner enthalten Hunderte Leichen. Gelesen werden nur Dateien, deren PID lebt.
