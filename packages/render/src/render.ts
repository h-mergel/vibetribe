import * as comfortable from "./comfortable";
import * as compact from "./compact";
import type { RenderOptions, Tile, Variant } from "./model";
import { empty } from "./shared";

export const DEFAULT_VARIANT: Variant = "comfortable";

const RENDERERS = { comfortable, compact } as const;

/**
 * One tile as a complete 144 x 144 SVG string, like `VibeTribe.render(model, { variant })` of the
 * Claude Design reference renderer. Pure; throws only on malformed input.
 */
export function render(tile: Tile, options: RenderOptions = {}): string {
  const v = RENDERERS[options.variant ?? DEFAULT_VARIANT];
  switch (tile.kind) {
    case "slot":
      return v.slot(tile);
    case "empty":
      return empty();
    case "inbox":
      return v.inbox(tile);
    case "limit":
      return v.limit(tile);
    case "extra":
      return v.extra(tile);
    case "status":
      return v.status(tile);
  }
}
