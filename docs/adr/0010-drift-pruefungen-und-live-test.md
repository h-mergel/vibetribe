# 0010 – Drift-Prüfungen und ein Live-Test auf Haiku

- Status: akzeptiert (2026-10-17)

## Kontext
- VibeTribe hängt an undokumentierten Schnittstellen (ADR 0003, 0006, 0007, 0008, 0009). Zwei brachen innerhalb von zwei Tagen still: der wandernde Port-Block von WSL (2026-10-16) und Claude Desktops neuer Datenordner (2026-10-17). Beide fielen erst am Deck auf.
- Bisher galt ohne Ausnahme: VibeTribe startet nie einen Modellaufruf (Token-Erneuerung nur über `claude -p /cost`, Spec §7.1).

## Entscheidung
- `pnpm drift` prüft jede Annahme über diese Schnittstellen nur lesend und ohne Modellaufruf, mit den Parsern und Mappern der Produktion; Exit 1 bei Drift; nie Titel, Ids, Inhalte oder Tokens in der Ausgabe.
- Die Zentrale prüft beim Start und stündlich den Teil ohne Tokens und ohne WSL und loggt nur Wechsel.
- `pnpm e2e:live --spend-tokens` ist die einzige Ausnahme von „kein Modellaufruf“ (Nutzer, 2026-10-17: Haiku für Tests freigegeben): nur mit diesem Schalter, Haiku, Mini-Prompt, höchstens 0,05 $ je Host, nur auf ausdrücklichen Wunsch, nie in Tests, CI, Zentrale oder Plugin. Die Token-Erneuerung bleibt bei `/cost`.

## Alternativen
- **Nur Prüfungen ohne Modellaufruf:** Ob die Hooks im echten Ablauf ankommen und das Deck Done zeigt, sieht nur ein echter Durchgang. Verworfen.
- **Live-Test in `pnpm check` oder CI:** kostet bei jedem Lauf und braucht das echte Profil. Verworfen.
- **Eigene Kopie der Formate in `pnpm drift`:** liefe auseinander; `pnpm drift` ruft die Parser der Produktion. Verworfen.
- **Alle Prüfungen stündlich in der Zentrale:** Die API-Prüfungen bräuchten zusätzliche Abfragen mit dem Token, die Port-Prüfung WSL; API-Fehler zeigt die Zentrale ohnehin als Quellen-Fehler. Verworfen.

## Konsequenzen
- Nach Updates von Claude Desktop, Claude Code, Windows oder WSL einmal `pnpm drift`; ein `changed` nennt, was sich bewegt hat.
- Ein neuer Wert der Remote-Liste gilt als Drift, bis er in `KNOWN_REMOTE_VALUES` steht.
- Ein Lauf von `pnpm e2e:live` kostet Tokens und zeigt einige Sekunden eine Session `vibetribe-e2e-…` als Done auf dem Deck.
- Was nur mit Seiteneffekten prüfbar ist (Sprung, `claude://`-Handler, Property Inspector, Kacheln am Gerät), bleibt eine Prüfung von Hand.
