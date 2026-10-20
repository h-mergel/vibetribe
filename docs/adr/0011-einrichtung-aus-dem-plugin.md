# 0011 – Einrichtung aus dem Plugin, Node-Kopie als Hook-Laufzeit, WSL per Klick

- Status: akzeptiert (2026-10-18), ergänzt 0002 und 0005

## Kontext
- VibeTribe soll kostenlos im Elgato Marketplace erscheinen (Nutzer, 2026-10-18). Ein Marketplace-Nutzer bekommt nur das Paket `.streamDeckPlugin`: kein Repo, kein pnpm, oft kein Node.js, kein Terminal unter Windows. Bisher richtete `reporter.mjs setup` die Hooks von Hand ein, unter Windows und in WSL, mit dem `node` des Nutzers (`process.execPath`).
- Neue Plugins müssen DRM-tauglich sein (seit 2026-01-19): Die Dateien des Plugins sind unveränderlich und möglicherweise verschlüsselt, das Manifest wird zur Laufzeit nicht gelesen.
- Stream Deck bringt sein eigenes Node mit: `%APPDATA%\Elgato\StreamDeck\NodeJS\<version>\node.exe` (gemessen 2026-10-18: `24.13.1` für das Plugin, daneben `20.20.0`, Liste in `NodeJS\manifest.json`). Der Ordner trägt die Version; mit einem Update der App kommt ein neuer Ordner, ob alte bleiben, ist nicht zugesagt.
- In WSL läuft der Reporter als Linux-Prozess (Statusline-Weiche, Host-Erkennung über `WSL_DISTRO_NAME`). Ein Windows-`node.exe` über Interop wäre dort ein Windows-Prozess: falscher Host, die bisherige Statusline liefe in der falschen Shell.

## Entscheidung
- **Einrichtung nur auf Klick:** Der Property Inspector jeder VibeTribe-Aktion zeigt „Claude Code hooks“ mit „Set up hooks“ / „Update hooks“ / „Remove hooks“. Ohne diesen Klick ändert das Plugin `~/.claude/settings.json` nie. Das Plugin ruft dafür die Setup-Funktionen des Reporters (`@vibetribe/reporter/setup`: `install`, `uninstall`, `setupState`) im eigenen Prozess auf; es gibt keine zweite Kopie der Logik. Die Status-Taste zeigt „Setup“, solange die Hooks fehlen oder veraltet sind (Quelle `setup` der Zentrale).
- **Hook-Laufzeit = Kopie von Stream Decks Node:** Die Einrichtung kopiert das laufende `node.exe` (Stream Decks) nach `%USERPROFILE%\.vibetribe\node-<version>.exe` (`process.versions.node`); die Hooks und die Statusline rufen diese Kopie. Eine vorhandene Kopie derselben Version wird nie ersetzt, weil Windows eine `.exe` sperrt, solange ein Hook sie ausführt (während Claude Code läuft, fast immer). Andere Kopien löscht die Einrichtung danach, soweit sie nicht gesperrt sind; die Kopie, die die bisherigen Einstellungen nennen, bleibt, weil laufende Sessions sie noch nutzen. Nach einem Update gibt es bis zum nächsten Update also bis zu zwei Kopien.
- **Reporter im Plugin-Code:** Das Bundle des Reporters ist als Text in `bin/plugin.js` eingebaut und wird bei der Einrichtung nach `%USERPROFILE%\.vibetribe\reporter.mjs` geschrieben. Das Plugin liest nie seinen eigenen Ordner.
- **Zuverlässiger Start:** Die Suche nach der WSL-Distribution blockiert nie das Verbinden mit Stream Deck; sie läuft im Hintergrund (bis 15 s), bei jedem Öffnen der Seite erneut, bis sie etwas findet. Die WSL-Quelle kommt dann zur laufenden Zentrale dazu.
- **Token beim Start:** Das Plugin legt `%USERPROFILE%\.vibetribe\token` beim Start an, falls er fehlt (wie schon die Port-Datei). So nimmt die Zentrale Events an, sobald die Hooks eingerichtet sind, ohne Neustart.
- **WSL per zweitem Klick:** Das Plugin findet die Standard-Distribution über `wsl.exe -l -v` (Zeile mit `*`, unabhängig von der Sprache; `VIBETRIBE_WSL_DISTRO` hat Vorrang) und zeigt dann „Set up in WSL“ / „Remove from WSL“. Der Klick startet `wsl.exe -d <distro> --cd ~ -e sh -lc …` mit dem Linux-`node` (20 oder neuer, aus dem Login-`PATH`) der Distribution und dem Reporter aus `%USERPROFILE%\.vibetribe` (über `wslpath`). Ohne `node` in WSL erklärt der Property Inspector, was fehlt. Ohne WSL gibt es weder die WSL-Quelle noch die WSL-Knöpfe.

## Alternativen
- **Stream Decks Node direkt als Hook-Laufzeit:** kein Kopieren, aber der Pfad trägt die Version und wechselt mit App-Updates; danach scheiterte jeder Hook, bis der Nutzer erneut einrichtet. Verworfen.
- **Pfad bei jedem Plugin-Start neu eintragen:** ändert `settings.json` ohne Klick (gegen die Vorgabe des Nutzers) und hilft nicht zwischen Update und Start. Verworfen.
- **Laufzeit von Claude Code:** Das native `claude.exe` enthält kein aufrufbares Node; Bun über `BUN_BE_BUN` ist undokumentiert. Verworfen.
- **Windows-`node.exe` über Interop für WSL:** falscher Host und falsche Shell für die Statusline (siehe Kontext). Verworfen.
- **Nur eine Befehlszeile zum Kopieren für WSL:** braucht trotzdem `node` in WSL und ein Terminal; der Klick tut dasselbe ohne Tippfehler. Verworfen, die Fehlermeldung nennt, dass Node.js 20 oder neuer in WSL nötig ist.
- **Reporter als Datei im Plugin-Ordner (`bin/reporter.mjs`) kopieren:** unter DRM womöglich verschlüsselt. Verworfen.

## Konsequenzen
- Jede Kopie belegt etwa 90 MB in `%USERPROFILE%\.vibetribe`; sie wird nicht mit Stream Deck aktualisiert, bis der Nutzer erneut einrichtet. Sie läuft nur den Reporter.
- Eine neue Plugin-Version mit geändertem Reporter zeigt „Setup“, bis der Nutzer „Update hooks“ klickt (`setupState` = `outdated`).
- Wer das Plugin deinstalliert, ohne vorher „Remove hooks“ zu klicken, behält die Hooks; sie bleiben harmlos (fail-open) und lassen sich ohne Repo entfernen (README, „Uninstall“: die Kopie `node-<version>.exe` mit `reporter.mjs setup --uninstall`).
- In WSL braucht die Einrichtung Node.js 20 oder neuer im Login-`PATH` (`~/.profile`); ältere Pakete aus `apt` (Ubuntu 22.04: 12, 24.04: 18) und `nvm`/`fnm` nur in `~/.bashrc` reichen nicht, die Seite sagt das. Der Reporter wird für Node 20 gebaut und lief am 2026-10-18 auf 20.20.0 und 24.
- Das SDK (`@elgato/streamdeck` 3.0.2) schreibt sein eigenes Log nach `<Plugin-Ordner>/logs`; das lässt sich im SDK nicht umstellen. Es sind erzeugte Dateien, keine ausgelieferten; ob DRM das zulässt, zeigt die DRM-Fassung aus dem Maker Console vor der Freigabe.
- Das Plugin hängt jetzt am Paket `@vibetribe/reporter` (nur dessen Setup-Teil); der Reporter selbst bleibt eigenständig.
