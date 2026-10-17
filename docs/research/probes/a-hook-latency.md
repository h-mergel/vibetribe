# Probe A – Hook-Latenz und Aufrufform

## Frage

Wie teuer ist ein Hook-Aufruf (synchron vs. `async: true`, Shell vs. direkter `node`-Aufruf) unter Windows, WSL und in Desktop-Sessions unter WSL? Lässt sich `node` dort per absolutem Pfad starten?

## Methode

- `probes/hook-latency/bench.mjs` mit je 20 Aufrufen des installierten Recorders.
- Beobachtet wurde außerdem, ob Claude Code die Eintragsform `command` plus `args` mit `async: true` akzeptiert. Indikator: Events aus den laufenden Sessions direkt nach der Installation.

## Ergebnis

| Umgebung | Variante | Median | p90 |
|---|---|---|---|
| WSL (Node 24.19) | direkt (`command` + `args`) | 32 ms | 50 ms |
| WSL | `sh -c` | 32 ms | 40 ms |
| Windows (Node 24) | direkt | 68 ms | 80 ms |
| Windows | Git Bash (`C:\dev\tools\Git\bin\bash.exe`) | 111 ms | 142 ms |
| Windows | PowerShell | 437 ms | 550 ms |

- Die direkte Form mit `async: true` wird akzeptiert. Events aus Desktop-Sessions unter WSL und Windows kamen sofort, mit absolutem Node-Pfad und ohne Shell.
- Der Vergleich „Lesedurchgang synchron mit Shell vs. asynchron direkt“ (Plan 1, Task 3, Step 3) **entfiel**. Der Nutzer arbeitet nur über Claude Desktop, und die Zahlen oben zeigen den Unterschied ausreichend.
- Achtung: Ein `bash.exe` im PATH unter Windows ist der WSL-Launcher (`system32`), nicht Git Bash.

## Folge für die Spec

Keine Änderung. Spec §8.1 (asynchron, direkter `node`-Aufruf, `SessionEnd` synchron) ist bestätigt. Pro Hook entstehen 30–70 ms Prozesskosten, die Claude dank `async` nicht abwarten muss.
