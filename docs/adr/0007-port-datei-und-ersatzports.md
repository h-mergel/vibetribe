# 0007 – Ersatzports und Port-Datei der Zentrale, keine Handler-Prüfung beim Start

- Status: akzeptiert (2026-10-16)

## Kontext
- WSL reserviert beim Mirrored-Netzwerk mit jedem Start einen Block von 4096 Ports auch auf der Windows-Seite (`/proc/sys/net/ipv4/ip_local_port_range`). Der Block ist unsichtbar (kein Prozess in `netstat`) und wandert zwischen WSL-Starts (gemessen 44620–48715, am 2026-10-16 40525–44620). Liegt 43710 darin, bindet die Zentrale im Plugin nicht (`EADDRINUSE`): keine Hooks, keine Debug-Seite, Status-Taste „Port in use“. ADR 0005 setzte den festen Port 43710 voraus.
- Nach einem Neustart von Stream Deck hält die alte Instanz den Port manchmal noch; die Zentrale versuchte das Binden nie erneut.
- Claude Desktop ist ein MSIX-Paket. Die Handler-Prüfung beim Start (ADR 0006) las `HKCR\claude\shell\open\command`. Den Schlüssel fand `reg.exe` nur beim Start von Stream Deck aus WSL heraus, nie beim Start durch den Nutzer; die Sprünge gingen trotzdem, weil `rundll32` `claude://` über die Paketregistrierung auflöst.

## Entscheidung
- Die Zentrale versucht zuerst 43710, dann die Ersatzports 37710, 31710, 25710 (`FALLBACK_PORTS`): unter dem dynamischen Bereich von Windows (49152–65535) und je 6000 auseinander, ein WSL-Block trifft höchstens einen. Bindet keiner, versucht sie es alle 5 s erneut.
- Den gebundenen Port schreibt sie atomar nach `%USERPROFILE%\.vibetribe\port`, neben den Token. Die Reporter lesen ihn dort (in WSL über `/mnt/c`), sonst gilt 43710; ein ausdrücklicher `hubUrl` gewinnt. Die Port-Datei ist neben der Event-Hülle der zweite Vertrag zwischen Reporter und Zentrale und steht wie sie in `packages/protocol` (`DEFAULT_PORT`, `PORT_FILE`, `parsePortNumber`).
- Die Handler-Prüfung beim Start entfällt.

## Alternativen
- Das MSIX-Paket erkennen (`Get-AppxPackage` oder AppX-Schlüssel) und nur bei Paketen ohne Registrierung warnen: eine zweite Probe für eine Registrierung, die Windows mit dem Paket pflegt. Verworfen.
- Die Portbereiche in `setup` prüfen und einen freien Port fest eintragen: Der WSL-Block wandert nach dem Setup weiter, ein fester Port fällt beim nächsten WSL-Start wieder hinein. Verworfen.

## Konsequenzen
- `hub.mjs` versucht nur den ersten Port und endet mit Exit 2, wenn er belegt ist. Plugin und `hub.mjs` laufen nie gleichzeitig: Liegt das Plugin auf einem Ersatzport und ist 43710 frei, startet `hub.mjs` und überschreibt die Port-Datei.
- Eine Änderung am Reporter wirkt erst, wenn seine Kopie `~/.vibetribe/reporter.mjs` je Host ersetzt ist; Setup und `settings.json` bleiben unverändert.
- Tests laden eine Wache (`test/real-ports-guard.mjs`), die Verbindungen zu und Bindungen an diese vier Ports verweigert, auch in Node-Prozessen, die sie starten.
