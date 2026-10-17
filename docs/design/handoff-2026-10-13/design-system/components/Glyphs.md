Die Pfad-Symbole aller Zustände, Gesundheitswerte und Hilfszeichen. `VibeTribe.glyph(name, color, {x, y, size, filled, tick, id})`.

- Gezeichnet in einer 28-px-Box; andere Größen (20, 18, 15) entstehen durch Umrechnen der Koordinaten, nicht per `scale()`, weil nur translate/rotate erlaubt sind.
- Zustände: `diamond`, `bubble`, `octagon`, `check` (je Kontur oder gefüllt), `hourglass`, `dots`, `pie`, `dash`, `unplugged`. Hilfszeichen: `tray`, `arrowUp`, `hcheck`, `hclock`, `hcross`, `hdash`.
- Gefüllt heißt ungesehen: Silhouette in Zustandsfarbe, Zeichen ausgespart in `on-accent`.
- Keine Textzeichen als Symbole (`! ? × ✓ ◑ ∅` fehlen in manchen Fallback-Schriften).
