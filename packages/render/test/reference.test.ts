import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFERENCE_SAMPLES } from "../scripts/reference-samples";
import { VARIANTS, type Variant } from "../src/model";
import { render } from "../src/render";

/** The Claude Design handoff (v2): 52 reference SVGs per variant, rendered by the reference renderer. */
const REFERENCE = join(import.meta.dirname, "../../../docs/design/handoff-2026-10-13/reference");
/** The handoff is external data and keeps its own folder names. */
const HANDOFF_FOLDER: Record<Variant, string> = { comfortable: "luftig", compact: "dicht" };

/**
 * Frame inset, a deliberate deviation from the handoff. The hardware bezel hides the outer
 * pixels, so our frames sit 2 px further in (frameInset.test.ts checks the geometry). Only the
 * geometry attributes of the `vt-frame` element are blanked out on both sides; its colour,
 * opacity and dashes and every other element stay byte-identical.
 */
const FRAME = /<rect id="vt-frame"[^>]*\/>/;
const GEOMETRY = / (x|y|width|height|rx|stroke-width)="[^"]*"/g;
const withoutFrameGeometry = (svg: string): string =>
  svg.replace(FRAME, (el) => el.replace(GEOMETRY, ' $1="*"'));

describe.each(VARIANTS)("reference SVGs (%s)", (variant) => {
  it.each(Object.entries(REFERENCE_SAMPLES))(
    "%s is byte-identical apart from the frame inset",
    (name, tile) => {
      const expected = readFileSync(
        join(REFERENCE, HANDOFF_FOLDER[variant], `${name}.svg`),
        "utf8",
      );
      expect(withoutFrameGeometry(render(tile, { variant }))).toBe(withoutFrameGeometry(expected));
    },
  );

  it("covers every reference file", () => {
    expect(Object.keys(REFERENCE_SAMPLES)).toHaveLength(52);
  });
});
