import { describe, expect, it } from "vitest";
import {
  comparePlacement,
  defaultMk2Layout,
  KEY_ROLES,
  type KeyPlacement,
  KeyRegistry,
} from "../src/deck/keys";

const slotKeys = (r: KeyRegistry) => r.all().filter((k) => k.role === "slot");

const key = (id: string, row: number, column: number, device = "d1"): KeyPlacement => ({
  id,
  role: "slot",
  device,
  row,
  column,
});

describe("KeyRegistry", () => {
  it("lists keys in reading order per device, indexes follow first sight", () => {
    const r = new KeyRegistry();
    r.add(key("b", 1, 2));
    r.add(key("a", 1, 0));
    r.add(key("c", 2, 0));
    r.add({ id: "inbox", role: "inbox", device: "d1", row: 0, column: 0 });
    r.add(key("z", 0, 0, "d0"));
    expect(r.all().map((k) => k.id)).toEqual(["z", "inbox", "a", "b", "c"]);
    expect(slotKeys(r).map((k) => k.id)).toEqual(["z", "a", "b", "c"]);
    expect(r.slotIndexOf("b")).toBe(0);
    expect(r.slotIndexOf("a")).toBe(1);
    expect(r.slotIndexOf("z")).toBe(3);
    expect(r.slotIndexOf("inbox")).toBe(-1);
    expect(r.slotIndexOf("nope")).toBe(-1);
  });

  it("does not renumber existing keys when a key appears at an earlier position", () => {
    const r = new KeyRegistry();
    r.add(key("a", 1, 0));
    r.add(key("c", 1, 2));
    r.add(key("b", 1, 1));
    expect([r.slotIndexOf("a"), r.slotIndexOf("c"), r.slotIndexOf("b")]).toEqual([0, 1, 2]);
    expect(slotKeys(r).map((k) => k.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves page A's indexes unchanged when page B is first seen later", () => {
    const r = new KeyRegistry();
    r.add(key("a1", 1, 0));
    r.add(key("a2", 1, 1));
    r.remove("a1", 0);
    r.remove("a2", 0);
    r.add(key("b0", 0, 0));
    r.add(key("b1", 0, 1));
    expect([r.slotIndexOf("a1"), r.slotIndexOf("a2")]).toEqual([0, 1]);
    expect([r.slotIndexOf("b0"), r.slotIndexOf("b1")]).toEqual([2, 3]);
    r.add(key("a1", 1, 0));
    expect(r.slotIndexOf("a1")).toBe(0);
  });

  it("keeps the index of a moved key (same id, new coordinates)", () => {
    const r = new KeyRegistry();
    r.add(key("a", 1, 0));
    r.add(key("b", 1, 1));
    expect(r.add(key("a", 0, 4))).toBe(true);
    expect(r.slotIndexOf("a")).toBe(0);
    expect(r.slotIndexOf("b")).toBe(1);
    expect(r.get("a")).toMatchObject({ row: 0, column: 4 });
    expect(r.slotCount).toBe(2);
    expect(r.all()).toHaveLength(2);
  });

  it("keeps the index of a key that disappears and reappears, and copies placements", () => {
    const r = new KeyRegistry();
    const p = key("a", 1, 0);
    r.add(p);
    r.add(key("b", 1, 1));
    p.column = 9;
    expect(r.get("a")?.column).toBe(0);
    r.remove("a", 0);
    expect(r.slotIndexOf("b")).toBe(1);
    expect(r.slotIndexOf("a")).toBe(0);
    expect(r.slotCount).toBe(2);
    expect(slotKeys(r).map((k) => k.id)).toEqual(["b"]);
    expect(r.all()).toHaveLength(1);
    r.add(key("a", 1, 0));
    expect(r.slotIndexOf("a")).toBe(0);
    expect(r.slotCount).toBe(2);
  });

  it("orders two devices deterministically and numbers by first sight across them", () => {
    const r = new KeyRegistry();
    r.add(key("y", 0, 0, "dev-b"));
    r.add(key("x", 0, 0, "dev-a"));
    r.add(key("x2", 0, 1, "dev-a"));
    expect(slotKeys(r).map((k) => k.id)).toEqual(["x", "x2", "y"]);
    expect([r.slotIndexOf("y"), r.slotIndexOf("x"), r.slotIndexOf("x2")]).toEqual([0, 1, 2]);
    expect(comparePlacement(key("p", 0, 0, "B"), key("q", 0, 0, "a"))).toBeLessThan(0);
    expect(comparePlacement(key("p", 0, 0), key("p", 0, 0))).toBe(0);
  });

  it.each([
    ["NaN row", { row: Number.NaN }],
    ["undefined column", { column: undefined }],
    ["fractional row", { row: 1.5 }],
    ["infinite column", { column: Number.POSITIVE_INFINITY }],
  ])("rejects a placement with %s", (_name, bad) => {
    const r = new KeyRegistry();
    const p = { ...key("a", 0, 0), ...bad } as unknown as KeyPlacement;
    expect(r.add(p)).toBe(false);
    expect(r.all()).toHaveLength(0);
    expect(r.slotCount).toBe(0);
    expect(r.slotIndexOf("a")).toBe(-1);
    expect(r.add(key("b", 0, 0))).toBe(true);
    expect(r.slotIndexOf("b")).toBe(0);
  });

  it("does not move or drop a known key on an invalid re-add", () => {
    const r = new KeyRegistry();
    r.add(key("a", 1, 1));
    expect(r.add({ ...key("a", 0, 0), row: Number.NaN })).toBe(false);
    expect(r.get("a")).toMatchObject({ row: 1, column: 1 });
  });

  it("reports visibility per index, ascending", () => {
    const r = new KeyRegistry();
    r.add(key("a", 1, 0));
    r.add(key("b", 1, 1));
    r.add(key("c", 1, 2));
    r.add({ id: "inbox", role: "inbox", device: "d1", row: 0, column: 0 });
    r.remove("b", 0);
    expect(r.visibleSlotIndexes()).toEqual([0, 2]);
    expect(r.isVisibleIndex(0)).toBe(true);
    expect(r.isVisibleIndex(1)).toBe(false);
    expect(r.isVisibleIndex(7)).toBe(false);
  });

  it("forgets an invisible index and gives it to the next new slot key; visible ones are refused", () => {
    const r = new KeyRegistry();
    r.add(key("a", 1, 0));
    r.add(key("b", 1, 1));
    r.remove("a", 0);
    expect(r.forgetIndex(1)).toBe(false);
    expect(r.forgetIndex(99)).toBe(false);
    expect(r.forgetIndex(0)).toBe(true);
    expect(r.slotIndexOf("a")).toBe(-1);
    expect(r.slotCount).toBe(2);
    // back after a long page switch: the lowest released index, so the count stays bounded
    r.add(key("a", 1, 0));
    expect(r.slotIndexOf("a")).toBe(0);
    expect(r.slotCount).toBe(2);
    expect(r.slotIndexOf("b")).toBe(1);
    r.add(key("c", 1, 2));
    expect(r.slotIndexOf("c")).toBe(2);
  });
});

describe("defaultMk2Layout", () => {
  it("is the spec §6.1 layout: top row roles, ten slots below", () => {
    const keys = defaultMk2Layout();
    expect(keys).toHaveLength(15);
    expect(keys.slice(0, 5).map((k) => k.role)).toEqual([
      "inbox",
      "limit5h",
      "limitWeek",
      "extra",
      "status",
    ]);
    expect(keys.filter((k) => k.role === "slot")).toHaveLength(10);
    expect(keys[14]).toEqual({ id: "mk2:2:4", role: "slot", device: "mk2", row: 2, column: 4 });
    expect(new Set(keys.map((k) => k.role))).toEqual(new Set(KEY_ROLES));
  });

  it("is row-major with the top row ids and columns", () => {
    const keys = defaultMk2Layout();
    expect(keys.map((k) => k.id)).toEqual(
      [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((column) => `mk2:${row}:${column}`)),
    );
    expect(keys.slice(0, 5).map((k) => [k.id, k.row, k.column])).toEqual([
      ["mk2:0:0", 0, 0],
      ["mk2:0:1", 0, 1],
      ["mk2:0:2", 0, 2],
      ["mk2:0:3", 0, 3],
      ["mk2:0:4", 0, 4],
    ]);
    expect(keys.slice(5, 10).map((k) => k.id)).toEqual([0, 1, 2, 3, 4].map((c) => `mk2:1:${c}`));
    const r = new KeyRegistry();
    for (const k of keys) r.add(k);
    expect(slotKeys(r).map((k) => r.slotIndexOf(k.id))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("uses a custom device argument for device and ids", () => {
    const keys = defaultMk2Layout("deck-2");
    expect(keys.every((k) => k.device === "deck-2")).toBe(true);
    expect(keys[0]?.id).toBe("deck-2:0:0");
    expect(keys[14]?.id).toBe("deck-2:2:4");
  });
});
