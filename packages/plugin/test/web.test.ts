import { describe, expect, it } from "vitest";
import { isAllowedWebUrl, openWebPage, USAGE_SETTINGS_URL } from "../src/web";

describe("allow-listed web pages (Extra key)", () => {
  it("opens exactly the usage settings page through the surface", () => {
    const urls: string[] = [];
    const lines: string[] = [];
    const opened = openWebPage({ openUrl: (u) => urls.push(u) }, USAGE_SETTINGS_URL, (l) =>
      lines.push(l),
    );
    expect(USAGE_SETTINGS_URL).toBe("https://claude.ai/settings/usage");
    expect(opened).toBe(true);
    expect(urls).toEqual(["https://claude.ai/settings/usage"]);
    expect(lines).toEqual([]);
  });

  it("refuses every other URL, also near misses, and logs it", () => {
    for (const url of [
      "https://claude.ai/settings/billing",
      "https://claude.ai/settings/usage?next=evil",
      "https://claude.ai/settings/usage/",
      "http://claude.ai/settings/usage",
      "https://claude.ai.evil.example/settings/usage",
      "claude://claude.ai/code/session_01",
      "",
    ]) {
      const urls: string[] = [];
      const lines: string[] = [];
      expect(isAllowedWebUrl(url)).toBe(false);
      expect(openWebPage({ openUrl: (u) => urls.push(u) }, url, (l) => lines.push(l))).toBe(false);
      expect(urls).toEqual([]);
      expect(lines[0]).toMatch(/^open refused: /);
    }
  });
});
