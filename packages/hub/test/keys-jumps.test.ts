import { describe, expect, it } from "vitest";
import { type DeckMirror, type JumpRecord, renderKeysSection } from "../src/http/keys";

const base: DeckMirror = { at: 0, sentLastSecond: 0, pending: 0, keys: [] };

describe("jump log on /debug/keys", () => {
  it("shows the latest ten jumps newest first with title and id, escaped, 'no target' for no link", () => {
    const jumps: JumpRecord[] = Array.from({ length: 12 }, (_, i) => ({
      at: i * 1_000,
      session: `win/s${i}`,
      title: `Title ${i}`,
      url: i === 11 ? null : `claude://claude.ai/code/session_0${i}`,
      result: i === 11 ? "no_target" : "opened",
    }));
    jumps[10] = {
      at: 10_000,
      session: "<b>x</b>",
      title: "<i>t</i>",
      url: "claude://a",
      result: "logged",
    };
    const html = renderKeysSection({ ...base, jumps }, "UTC");
    expect(html).toContain("<h3>Jumps</h3>");
    expect(html).toContain("<td>Title 11 (win/s11)</td>");
    expect(html).toContain("&lt;i&gt;t&lt;/i&gt; (&lt;b&gt;x&lt;/b&gt;)");
    expect(html).toContain("<td>no target</td><td>no_target</td>");
    expect(html).not.toContain("(win/s1)");
    expect(html.indexOf("win/s11")).toBeLessThan(html.indexOf("win/s9"));
  });

  it("shows no jump section without jumps", () => {
    expect(renderKeysSection(base)).not.toContain("Jumps");
    expect(renderKeysSection({ ...base, jumps: [] })).not.toContain("Jumps");
  });
});
