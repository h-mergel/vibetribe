Die „Next“-Taste: zählt wartende Sessions und springt per Druck zur dringendsten. In der luftigen Variante zeigt sie keinen Titel (der steht auf dem Slot), sondern nur Zustandssymbol, Wort und Wartezeit der nächsten Session, dazu „next“. `VibeTribe.inbox(model)`.

**Der Renderer liefert:** `waiting`, `top` (`{title, state, wait?}` oder `null`; `wait` in Sekunden), optional `overflow`, beim Durchschalten `cycle: {index, total}`.

| Element | Position | Stil | id |
|---|---|---|---|
| Ablage-Symbol | Box 28 @ (10,10) | `ink`; leer `ink-faint` | `vt-glyph` |
| Zahl | x 46, Grundlinie 36 | `count` 34/700 | `vt-count` |
| Position „/3“ | hinter der Zahl | `unit` 20/700, `ink-muted` | `vt-count-of` |
| Überlauf +N | Pille rechts oben, Höhe 26 | `meta-strong`, Kontur `line` | `vt-overflow` |
| Trennlinie / Segmente | y 47–51 | `track`; beim Durchschalten n Segmente, aktuelles `ink` | `vt-divider`, `vt-cycle` |
| Eintrag | Symbol 20 @ (10,61), Wort x 38 / 78 | gefülltes Zustandssymbol, `meta-strong` in Zustandsfarbe | `vt-top-glyph`, `vt-top-word` |
| Eintrag-Titel | Grundlinien 104 / 127 | `title`, 2 Zeilen | `vt-top-title-1/2` |
| Leer | Haken-Kontur + „All clear“ | `state-done`, `meta`/`ink-muted` | `vt-calm`, `vt-calm-text` |

- Durchschalten (5 s): `waiting` bleibt, `cycle.index` zählt hoch, `top` wechselt. Zahl und Segmente zeigen „Eintrag 2 von 3“ doppelt, als Text und als Form.
- Leer ist eine Bestätigung, kein Fehler: kein Rahmen, keine Warnfarbe.
- Langer Druck quittiert alle `done_unseen`; die Kachel braucht dafür keinen eigenen Zustand.

- Wozu, wenn alle Sessions sichtbar sind: eine feste Taste für „was ist als Nächstes dran“, ohne acht Kacheln zu scannen, und der einzige Ort für Sessions über die acht Slots hinaus (`+N`).
