Die Eskalation wartender Sessions: Atmen (A), ruhig dringend (B), Erinnerung (C), gesehen (D). Ändert nur `level` und `frame` des Slots.

- Atemstufen je 1,2-s-Periode bei 4 Bildern/s: `breath-1…4` = 0,35 / 0,675 / 1 / 0,675 (`VibeTribe.breathLevel(i)`).
- `level` setzt `stroke-opacity` von `vt-frame` und `fill-opacity` von `vt-tint` (0,12 × level). Sonst nichts.
- Höchstens 2 Tasten atmen: zuerst die neuesten Episoden in ihren ersten 30 s, danach die Erinnerung (C) der ältesten ungesehenen, alle 60 s für 12 Bilder. Alle anderen zeigen B. `VibeTribe.escalation(episodes, now)` liefert die Phase je Episode.
- Eine neue Episode startet bei A. `error`, `done_unseen`, `throttled`, `background` atmen nie; `error` und `done_unseen` stehen ungesehen statisch mit dickem Rahmen (wie Phase B).
