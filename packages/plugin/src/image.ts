const PREFIX = "data:image/svg+xml,";

/** With the u flag only unpaired surrogates match \p{Surrogate} (same effect as String#toWellFormed, which the tsconfig lib lacks). */
const LONE_SURROGATE = /\p{Surrogate}/gu;

/**
 * The form the Stream Deck keys guide documents for SVG images. The app rasterizes the SVG
 * itself, so no resvg ships in the plugin. Lone surrogates (which encodeURIComponent rejects) are
 * replaced by U+FFFD first, so this never throws.
 */
export function svgDataUrl(svg: string): string {
  return `${PREFIX}${encodeURIComponent(svg.replace(LONE_SURROGATE, "�"))}`;
}
