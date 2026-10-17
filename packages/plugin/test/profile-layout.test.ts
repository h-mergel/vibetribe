import { describe, expect, it } from "vitest";
import {
  actionsOf,
  applyLayout,
  checkPage,
  checkProfile,
  describePage,
  imagesOf,
  type Layout,
  parseLayout,
} from "../scripts/profile-layout";
import { before, foreign, MISCHFORM, NAMES, page, page2 } from "./profile-fixture";

const ids = (() => {
  let n = 0;
  return () => `new-${++n}`;
})();

describe("applyLayout", () => {
  const result = applyLayout(before(), page2(), MISCHFORM, NAMES, ids);
  const p1 = actionsOf(result.page1);
  const p2 = actionsOf(result.page2);

  it("lays out page 1 as decided and keeps foreign keys byte for byte", () => {
    expect(describePage(result.page1).map((l) => l.split("  ")[1])).toEqual([
      "com.example.apps.action",
      "dev.h2k.vibetribe.limit-5h",
      "dev.h2k.vibetribe.limit-week",
      "dev.h2k.vibetribe.inbox",
      "dev.h2k.vibetribe.status",
      "dev.h2k.vibetribe.extra",
      "dev.h2k.vibetribe.slot",
      "dev.h2k.vibetribe.slot",
      "dev.h2k.vibetribe.slot",
      "dev.h2k.vibetribe.slot",
      "com.example.spotify.action",
      "dev.h2k.vibetribe.slot",
      "dev.h2k.vibetribe.slot",
      "com.example.mic.action",
      "com.example.next.action",
    ]);
    expect(p1["0,2"]).toEqual(foreign("spotify"));
    expect(p1["3,2"]).toEqual(foreign("mic"));
    expect(result.page1.Icon).toBe("");
    expect(result.page1.Controllers[0]?.Type).toBe("Keypad");
  });

  it("reuses our keys (same ActionID and settings) before it creates new ones", () => {
    expect(p1["3,0"]?.ActionID).toBe("a-inbox");
    expect(["1,1", "2,1", "3,1", "4,1"].map((p) => p1[p]?.ActionID)).toEqual([
      "a-s1",
      "a-s2",
      "a-s3",
      "a-s4",
    ]);
    expect(p1["0,1"]).toMatchObject({
      UUID: "dev.h2k.vibetribe.extra",
      Name: "Extra Usage",
      Settings: {},
      Plugin: { UUID: "dev.h2k.vibetribe" },
    });
    const fresh = ["0,1", "1,2", "2,2"].map((p) => p1[p]?.ActionID);
    expect(new Set(fresh).size).toBe(3);
    for (const id of fresh) expect(id).toMatch(/^new-/);
    expect(result.created).toBe(3);
  });

  it("gives new keys the minimal States, not the template key's title", () => {
    const first = before();
    const tpl = actionsOf(first)["1,0"];
    if (tpl) tpl.States = [{ Title: "custom" }];
    const r = applyLayout(first, page2(), MISCHFORM, NAMES, ids);
    for (const p of ["0,1", "1,2", "2,2"]) expect(actionsOf(r.page1)[p]?.States).toEqual([{}]);
    expect(actionsOf(r.page1)["3,0"]?.States).toEqual([{ Title: "custom" }]);
  });

  it("moves the media keys to the free places of page 2 and lists their images", () => {
    expect(p2["0,0"]).toEqual(foreign("back"));
    expect([p2["1,0"], p2["2,0"], p2["3,0"]]).toEqual([
      foreign("media1"),
      foreign("media2"),
      foreign("media3"),
    ]);
    expect(result.images).toEqual(["MEDIA1.png", "MEDIA2.png", "MEDIA3.png"]);
  });

  it("does not change its inputs", () => {
    const b = before();
    const p = page2();
    applyLayout(b, p, MISCHFORM, NAMES, ids);
    expect(b).toEqual(before());
    expect(p).toEqual(page2());
  });
});

describe("applyLayout refuses unsafe layouts", () => {
  const without = (place: string): Layout => {
    const page1 = { ...MISCHFORM.page1 };
    delete page1[place];
    return { ...MISCHFORM, page1 };
  };

  it("when a foreign key would be lost", () => {
    expect(() => applyLayout(before(), page2(), without("4,2"), NAMES, ids)).toThrow(/lost: 4,2/);
  });

  it("when a key is used twice or a VibeTribe key would move to page 2", () => {
    const twice = { ...MISCHFORM, page1: { ...MISCHFORM.page1, "0,0": { keep: "3,2" } } };
    expect(() => applyLayout(before(), page2(), twice, NAMES, ids)).toThrow(/used twice/);
    const moved = { ...MISCHFORM, toPage2: [...MISCHFORM.toPage2, "1,0"] };
    expect(() => applyLayout(before(), page2(), moved, NAMES, ids)).toThrow(/VibeTribe key/);
  });

  it("when page 2 is full or nothing of ours is there to copy", () => {
    const full = page(
      Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`${i % 5},${Math.floor(i / 5)}`, foreign(`x${i}`)]),
      ),
    );
    expect(() => applyLayout(before(), full, MISCHFORM, NAMES, ids)).toThrow(/no free place/);
    const foreignOnly = page({ "0,0": foreign("apps") });
    const layout: Layout = {
      page1: { "0,0": { keep: "0,0" }, "1,0": { role: "slot" } },
      toPage2: [],
    };
    expect(() => applyLayout(foreignOnly, page2(), layout, NAMES, ids)).toThrow(/no VibeTribe key/);
  });

  it("when a moved key refers to an image anywhere but States[].Image", () => {
    for (const nest of [
      { Resources: { icon: "Images/x.png" } },
      { Actions: { a: { Image: "Images/x.png" } } },
      { States: [{ Image: "Images/ok.png", Other: "Images\\y.png" }] },
    ]) {
      const first = before();
      const media = actionsOf(first)["0,2"];
      if (media) Object.assign(media, nest);
      expect(() => applyLayout(first, page2(), MISCHFORM, NAMES, ids)).toThrow(/nested image/);
    }
  });

  it("when a moved key's image is not a plain Images/<file>", () => {
    for (const bad of ["../x.png", "C:\\x.png", "/abs/x.png", "Images/../x.png"]) {
      const first = before();
      const media = actionsOf(first)["0,2"];
      if (media) media.States = [{ Image: bad }];
      expect(() => applyLayout(first, page2(), MISCHFORM, NAMES, ids)).toThrow(/Images\/<file>/);
    }
  });
});

describe("parseLayout", () => {
  it("accepts the Mischform", () => {
    expect(parseLayout(JSON.parse(JSON.stringify(MISCHFORM)))).toEqual(MISCHFORM);
  });

  it.each([
    [{ page1: {}, toPage2: [], extra: 1 }, /unknown field extra/],
    [{ page1: { "5,0": { keep: "0,0" } }, toPage2: [] }, /unknown place 5,0/],
    [{ page1: { "0,0": { role: "extraa" } }, toPage2: [] }, /must be/],
    [{ page1: { "0,0": { keep: "9,9" } }, toPage2: [] }, /must be/],
    [{ page1: { "0,0": { keep: "0,0", role: "slot" } }, toPage2: [] }, /must be/],
    [{ page1: {}, toPage2: ["0,3"] }, /toPage2/],
    [[], /not an object/],
  ])("refuses %j", (raw, message) => {
    expect(() => parseLayout(raw)).toThrow(message);
  });
});

describe("checkPage and checkProfile", () => {
  it("accept the fixture's page and an MK.2 profile", () => {
    expect(checkPage(before(), "p")).toEqual(before());
    expect(
      checkProfile({ Device: { Model: "20GBL9901" }, Pages: { Pages: ["a", "b"] } }, "x"),
    ).toEqual({ model: "20GBL9901", pages: ["a", "b"] });
  });

  it.each([
    [{}, /one controller/],
    [{ Controllers: [{ Type: "Keypad" }, { Type: "Keypad" }] }, /one controller/],
    [{ Controllers: [{ Type: "Encoder", Actions: {} }] }, /not a Keypad/],
    [{ Controllers: [{ Type: "Keypad", Actions: { "5,0": { UUID: "u" } } }] }, /not a place/],
    [{ Controllers: [{ Type: "Keypad", Actions: { "0,0": { Name: "x" } } }] }, /no UUID/],
  ])("checkPage refuses %j", (raw, message) => {
    expect(() => checkPage(raw, "p")).toThrow(message);
  });

  it("checkProfile refuses other devices and a missing page list", () => {
    expect(() =>
      checkProfile({ Device: { Model: "20GAT9901" }, Pages: { Pages: [] } }, "x"),
    ).toThrow(/not an MK.2/);
    expect(() => checkProfile({ Device: { Model: "20GBL9901" } }, "x")).toThrow(/page list/);
  });

  it("imagesOf ignores empty images and returns file names", () => {
    expect(imagesOf(foreign("next", false))).toEqual([]);
    expect(imagesOf(foreign("media1"))).toEqual(["MEDIA1.png"]);
  });
});
