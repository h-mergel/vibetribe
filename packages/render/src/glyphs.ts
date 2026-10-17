import { n } from "./svg";
import { C, type GlyphName, STROKE } from "./theme";

/**
 * State and health symbols as paths in a 28 x 28 box (reference renderer). Other sizes scale the
 * coordinates themselves: the tile contract allows no scale() transform, only translate.
 */

interface ClosedGlyph {
  shape: string;
  outline: string;
  outlineStroke?: number;
  mark: string;
}

const CLOSED: Record<"diamond" | "bubble" | "octagon" | "check", ClosedGlyph> = {
  diamond: {
    shape: '<polygon points="14,0.5 27.5,14 14,27.5 0.5,14"/>',
    outline: '<polygon points="14,2.5 25.5,14 14,25.5 2.5,14"/>',
    mark: '<line x1="14" y1="7.5" x2="14" y2="15.2"/><circle cx="14" cy="19.6" r="2.1" data-fill="1"/>',
  },
  bubble: {
    shape:
      '<path d="M6 0.5 H22 A5 5 0 0 1 27 5.5 V19.5 A5 5 0 0 1 22 24.5 H11.5 L6 27.8 V24.5 A5 5 0 0 1 1 19.5 V5.5 A5 5 0 0 1 6 0.5 Z"/>',
    outline:
      '<path d="M6 1.8 H22 A3.7 3.7 0 0 1 25.7 5.5 V19.5 A3.7 3.7 0 0 1 22 23.2 H11.2 L7.2 26.6 V23.2 H6 A3.7 3.7 0 0 1 2.3 19.5 V5.5 A3.7 3.7 0 0 1 6 1.8 Z"/>',
    outlineStroke: 2.6,
    mark: '<path d="M11.1 10.2 A2.9 2.9 0 1 1 15.3 12.8 C14.4 13.3 14 13.8 14 15"/><circle cx="14" cy="18.4" r="1.75" data-fill="1"/>',
  },
  octagon: {
    shape:
      '<polygon points="8.6,0.5 19.4,0.5 27.5,8.6 27.5,19.4 19.4,27.5 8.6,27.5 0.5,19.4 0.5,8.6"/>',
    outline:
      '<polygon points="9.3,2.2 18.7,2.2 25.8,9.3 25.8,18.7 18.7,25.8 9.3,25.8 2.2,18.7 2.2,9.3"/>',
    mark: '<line x1="9.6" y1="9.6" x2="18.4" y2="18.4"/><line x1="18.4" y1="9.6" x2="9.6" y2="18.4"/>',
  },
  check: {
    shape: '<circle cx="14" cy="14" r="13.5"/>',
    outline: '<circle cx="14" cy="14" r="11.8"/>',
    mark: '<path d="M8 14.4 L12.2 18.6 L20.2 9.8"/>',
  },
};

/** Filled = unseen: silhouette in the accent, mark cut out in `ground`; else outline and mark in the accent. */
function closedGlyph(name: keyof typeof CLOSED, color: string, filled: boolean): string {
  const g = CLOSED[name];
  const ink = filled ? C.ground : color;
  const mark = g.mark
    .replace(/<(line|path)/g, `<$1 fill="none" stroke="${ink}" stroke-width="${STROKE.glyph}"`)
    .replace(/<circle([^>]*) data-fill="1"/g, `<circle$1 fill="${ink}"`);
  if (filled) return `<g fill="${color}">${g.shape}</g>${mark}`;
  return `<g fill="none" stroke="${color}" stroke-width="${g.outlineStroke ?? STROKE.glyph}">${g.outline}</g>${mark}`;
}

function body(name: GlyphName, color: string, filled: boolean, tick: number): string {
  const sw = STROKE.glyph;
  switch (name) {
    case "diamond":
    case "bubble":
    case "octagon":
    case "check":
      return closedGlyph(name, color, filled);
    case "hourglass":
      return (
        `<path d="M5 2 H23 M5 26 H23" stroke="${color}" stroke-width="${sw}" fill="none"/>` +
        `<path d="M7.5 3.5 H20.5 C20.5 9 15.5 11.5 15.5 14 C15.5 16.5 20.5 19 20.5 24.5 H7.5 C7.5 19 12.5 16.5 12.5 14 C12.5 11.5 7.5 9 7.5 3.5 Z" fill="none" stroke="${color}" stroke-width="2.6"/>` +
        `<polygon points="9.6,23.6 18.4,23.6 14,18.6" fill="${color}"/>`
      );
    case "dots": {
      const t = tick % 3;
      let d = "";
      for (let i = 0; i < 3; i++)
        d += `<circle cx="${4 + i * 10}" cy="14" r="${i === t ? 4.2 : 3.4}" fill="${color}" fill-opacity="${i === t ? 1 : 0.4}"/>`;
      return `<g id="vt-work-tick" data-tick="${t}">${d}</g>`;
    }
    case "pie":
      return (
        `<circle cx="14" cy="14" r="11.8" fill="none" stroke="${color}" stroke-width="${sw}"/>` +
        `<path d="M14 6 A8 8 0 0 1 14 22 Z" fill="${color}"/>`
      );
    case "dash":
      return `<rect x="3" y="11" width="22" height="6" rx="3" fill="${color}"/>`;
    case "unplugged":
      return (
        `<circle cx="14" cy="14" r="11.8" fill="none" stroke="${color}" stroke-width="${sw}"/>` +
        `<line x1="5.6" y1="22.4" x2="22.4" y2="5.6" stroke="${color}" stroke-width="${sw}"/>`
      );
    case "tray":
      return (
        `<path d="M2 15 L6.5 3.5 H21.5 L26 15 V23 A2.5 2.5 0 0 1 23.5 25.5 H4.5 A2.5 2.5 0 0 1 2 23 Z" fill="none" stroke="${color}" stroke-width="2.8"/>` +
        `<path d="M2 15 H9.5 L11.5 18.5 H16.5 L18.5 15 H26" fill="none" stroke="${color}" stroke-width="2.8"/>`
      );
    case "hcheck":
      return `<path d="M7 14.5 L12 19.5 L21.5 9" fill="none" stroke="${color}" stroke-width="3.6"/>`;
    case "hclock":
      return `<circle cx="14" cy="14" r="10" fill="none" stroke="${color}" stroke-width="3.2"/><path d="M14 8.5 V14 H18.5" fill="none" stroke="${color}" stroke-width="3"/>`;
    case "hcross":
      return `<line x1="8" y1="8" x2="20" y2="20" stroke="${color}" stroke-width="3.6"/><line x1="20" y1="8" x2="8" y2="20" stroke="${color}" stroke-width="3.6"/>`;
    case "hdash":
      return `<line x1="8" y1="14" x2="20" y2="14" stroke="${color}" stroke-width="3.2"/>`;
    case "arrowUp":
      return `<polygon points="14,3 25,17 18,17 18,25 10,25 10,17 3,17" fill="${color}"/>`;
  }
}

/** Scales the numbers of a path; arc radii scale, arc rotation and flags do not. */
function scalePath(d: string, k: number): string {
  const out: string[] = [];
  let cmd = "";
  let idx = 0;
  for (const t of d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? []) {
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      idx = 0;
      out.push(t);
      continue;
    }
    const v = Number.parseFloat(t);
    let scale = true;
    if (cmd === "A" || cmd === "a") {
      const j = idx % 7;
      scale = !(j === 2 || j === 3 || j === 4);
    }
    out.push(String(scale ? n(v * k) : v));
    idx++;
  }
  return out.join(" ");
}

function scaleSvg(svg: string, k: number): string {
  return svg
    .replace(/ d="([^"]*)"/g, (_, d: string) => ` d="${scalePath(d, k)}"`)
    .replace(
      / points="([^"]*)"/g,
      (_, p: string) =>
        ` points="${p.replace(/-?\d*\.?\d+/g, (x) => String(n(Number.parseFloat(x) * k)))}"`,
    )
    .replace(
      / (cx|cy|r|x|y|x1|y1|x2|y2|width|height|rx|stroke-width)="(-?[\d.]+)"/g,
      (_, a: string, v: string) => ` ${a}="${n(Number.parseFloat(v) * k)}"`,
    );
}

export interface GlyphOptions {
  id?: string;
  x?: number;
  y?: number;
  /** box size in px, default 28 */
  size?: number;
  filled?: boolean;
  /** working dots: which of the three is lit */
  tick?: number;
}

/** `<g id data-glyph transform="translate(x y)">` around the symbol. */
export function glyph(name: GlyphName, color: string, o: GlyphOptions = {}): string {
  let svg = body(name, color, o.filled ?? false, o.tick ?? 0);
  const k = (o.size ?? 28) / 28;
  if (k !== 1) svg = scaleSvg(svg, k);
  return `<g id="${o.id ?? "vt-glyph"}" data-glyph="${name}" transform="translate(${n(o.x ?? 0)} ${n(o.y ?? 0)})">${svg}</g>`;
}
