import { describe, expect, it } from "vitest";
import { parseDesktopPins, readDesktopPins } from "../src/pins/desktop";

const config = (pinnedOrder: unknown): string =>
  JSON.stringify({ preferences: { epitaxyPrefs: { "dframe-local-slice": { pinnedOrder } } } });
const A = "local_0a1b2c3d-0000-4000-8000-00000000000a";
const B = "local_0a1b2c3d-0000-4000-8000-00000000000b";
const missing = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });

describe("parseDesktopPins", () => {
  it("takes the pinned Code sessions in sidebar order", () => {
    expect(parseDesktopPins(config([`code:${B}`, `code:${A}`]))).toEqual([B, A]);
  });

  it("skips other entries, malformed ids and repeats", () => {
    const order = [`code:${A}`, "cowork:x", `code:${A}`, "code:local_", `code:${B}!`, 7, null, A];
    expect(parseDesktopPins(config([...order, `code:${B}`]))).toEqual([A, B]);
  });

  it("calls a half-written file unreadable for now, not empty", () => {
    expect(parseDesktopPins(config([`code:${A}`]).slice(0, 40))).toBeNull();
  });

  it.each([
    ["null", "null"],
    ["no preferences", "{}"],
    ["preferences not an object", '{"preferences":[]}'],
    ["no slice", '{"preferences":{"epitaxyPrefs":{}}}'],
    ["pinnedOrder not a list", config(`code:${A}`)],
  ])("yields no pins for a changed shape (%s)", (_name, text) => {
    expect(parseDesktopPins(text)).toEqual([]);
  });
});

describe("readDesktopPins", () => {
  it("reads the first file that exists", async () => {
    const asked: string[] = [];
    const pins = await readDesktopPins(["msix", "classic"], async (path) => {
      asked.push(path);
      if (path === "msix") throw missing;
      return config([`code:${A}`]);
    });
    expect(pins).toEqual([A]);
    expect(asked).toEqual(["msix", "classic"]);
  });

  it("stops at a file that exists but cannot be read or parsed right now", async () => {
    const asked: string[] = [];
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    const unreadable = await readDesktopPins(["msix", "classic"], async (path) => {
      asked.push(path);
      throw busy;
    });
    expect(unreadable).toBeNull();
    expect(asked).toEqual(["msix"]);
    expect(await readDesktopPins(["msix", "classic"], async () => "{")).toBeNull();
  });

  it("yields no pins when no file exists", async () => {
    const none = await readDesktopPins(["msix", "classic"], async () => {
      throw missing;
    });
    expect(none).toEqual([]);
  });
});
