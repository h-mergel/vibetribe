import { describe, expect, it } from "vitest";
import { renderDebugHtml } from "../src/http/debug";
import { type DeckMirror, renderKeysHtml, renderKeysSection } from "../src/http/keys";
import { Hub } from "../src/hub";

const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>a&b</text></svg>')}`;
const mirror: DeckMirror = {
  at: 1_000,
  sentLastSecond: 4,
  pending: 1,
  keys: [
    { id: "k1", role: "inbox", slot: null, device: "mk2", row: 0, column: 0, image, sentAt: 900 },
    {
      id: "k2",
      role: "slot",
      slot: 0,
      device: "mk2",
      row: 1,
      column: 0,
      image: null,
      sentAt: null,
    },
    {
      id: "k3",
      role: "slot",
      slot: 1,
      device: "mk2",
      row: 1,
      column: 4,
      image: "https://evil.example/x.svg",
      sentAt: 950,
    },
  ],
};

describe("renderKeysSection", () => {
  it("places keys by coordinates, embeds only data URLs and numbers slots from 1", () => {
    const html = renderKeysSection(mirror, "Europe/Berlin");
    expect(html).toContain("grid-template-columns:repeat(5,72px)");
    expect(html).toContain('style="grid-row:1;grid-column:1"');
    expect(html).toContain(`<img src="${image.replace(/&/g, "&amp;")}"`);
    expect(html).toContain("slot 1<br>–");
    expect(html).toContain("slot 2");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("Images/s: 4 · pending: 1");
  });

  it("explains a missing deck", () => {
    expect(renderKeysSection(null)).toContain("No deck connected");
  });
});

describe("escaping and bounds", () => {
  const hostile: DeckMirror = {
    at: 1,
    sentLastSecond: 0,
    pending: 0,
    keys: [
      {
        id: "h1",
        role: "<script>",
        slot: null,
        device: '<b>"x"</b>',
        row: 0,
        column: 0,
        image: `data:image/svg+xml;utf8,<svg a="1" b='2'>&</svg>`,
        sentAt: null,
      },
    ],
  };

  it("escapes role, device and image so no markup from them reaches the page", () => {
    const html = renderKeysSection(hostile);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
    expect(html).toContain(
      'src="data:image/svg+xml;utf8,&lt;svg a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;&lt;/svg&gt;"',
    );
    expect(html).toContain("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('"><script');
    expect(html).not.toContain('<b>"x"</b>');
  });

  it("renders a non-image data URL as a blank tile", () => {
    const html = renderKeysSection({
      ...hostile,
      keys: [
        {
          id: "p",
          role: "slot",
          slot: 0,
          device: "d",
          row: 0,
          column: 0,
          image: "data:text/html,<img src=x onerror=alert(1)>",
          sentAt: null,
        },
      ],
    });
    expect(html).not.toContain("<img");
    expect(html).toContain('<div class="blank"></div>');
  });

  it("clamps grid coordinates and counters to bounded integers", () => {
    const html = renderKeysSection({
      at: Number.NaN,
      sentLastSecond: -4.7,
      pending: 1e12,
      keys: [
        {
          id: "b",
          role: "slot",
          slot: 0,
          device: "d",
          row: 1e9,
          column: 1e9,
          image: null,
          sentAt: Number.POSITIVE_INFINITY,
        },
        {
          id: "n",
          role: "slot",
          slot: 1,
          device: "d",
          row: Number.NaN,
          column: 2.9,
          image: null,
          sentAt: null,
        },
      ],
    });
    expect(html).toContain("grid-row:16;grid-column:16");
    expect(html).toContain("repeat(16,72px)");
    expect(html).toContain("grid-row:1;grid-column:3");
    expect(html).not.toContain("1000000000");
    expect(html).toContain("Images/s: 0 · pending: 1000000");
  });

  it("shows that the mirror is unavailable when the supplier failed", () => {
    expect(renderKeysSection("failed")).toContain("Mirror unavailable");
    expect(renderKeysHtml("failed")).toContain("Mirror unavailable");
    expect(renderDebugHtml(new Hub().state(0), undefined, "failed")).toContain(
      "Mirror unavailable",
    );
  });
});

describe("renderKeysHtml and the debug page", () => {
  it("renders a refreshing page", () => {
    const html = renderKeysHtml(mirror);
    expect(html).toContain('http-equiv="refresh" content="1"');
    expect(html).toContain("<h2>Keys</h2>");
  });

  it("the debug page links to the mirror and shows it inline", () => {
    const html = renderDebugHtml(new Hub().state(0), "Europe/Berlin", mirror);
    expect(html).toContain('href="/debug/keys"');
    expect(html).toContain("inbox<br>");
    expect(renderDebugHtml(new Hub().state(0))).toContain("No deck connected");
  });
});
