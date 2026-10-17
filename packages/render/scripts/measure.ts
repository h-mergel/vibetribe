import { VARIANTS } from "../src/model";
import { boxOf } from "../src/png";
import { render } from "../src/render";
import { S, SAFE } from "../src/theme";
import { layoutIssues, place } from "./measure-lib";
import { GALLERY_SAMPLES } from "./samples";

/**
 * Renders every gallery sample in both variants, measures each text and symbol with resvg and
 * fails when one leaves the safe area, a text is below 18 px or two elements overlap.
 * Boxes depend on the installed DejaVu Sans: a local check (`pnpm tiles:measure`), not a CI test.
 */
let issues = 0;
for (const variant of VARIANTS) {
  for (const [name, tile] of GALLERY_SAMPLES) {
    const found = layoutIssues(place(render(tile, { variant }), boxOf));
    for (const issue of found) console.log(`FAIL ${variant} ${name}: ${issue}`);
    issues += found.length;
  }
}
const tiles = GALLERY_SAMPLES.length;
console.log(
  issues === 0
    ? `tiles:measure: ${tiles} tiles x ${VARIANTS.length} variants, all texts inside [${SAFE.min}, ${SAFE.max}], none below ${S.min} px, no overlaps`
    : `tiles:measure: ${issues} issue(s)`,
);
process.exit(issues === 0 ? 0 : 1);
