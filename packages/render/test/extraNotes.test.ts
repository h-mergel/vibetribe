import { describe, expect, it } from "vitest";
import { VARIANTS } from "../src/model";
import { render } from "../src/render";

const tile = (note: string) =>
  ({ kind: "extra", used: null, limit: null, ratio: null, note }) as const;

describe.each(VARIANTS)("extra tile inactive notes (%s)", (variant) => {
  const disabled = render(tile("Disabled"), { variant });

  it.each(["No credit", "Limit hit", "Inactive"])(
    "%s shows the note in the off styling without a percentage",
    (note) => {
      const svg = render(tile(note), { variant });
      expect(svg).toContain(`>${note}</text>`);
      expect(svg).toContain(">off</text>");
      expect(svg).not.toContain("vt-pct");
      // identical to the "Disabled" tile apart from the note text: same off styling
      expect(svg.replace(`>${note}</text>`, ">Disabled</text>")).toBe(disabled);
    },
  );

  it("a ratio is not drawn while inactive", () => {
    const svg = render({ ...tile("No credit"), ratio: 0.5 }, { variant });
    expect(svg).not.toContain("vt-pct");
    expect(svg).not.toContain('vt-bar"');
  });
});
