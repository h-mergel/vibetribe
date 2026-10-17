import { describe, expect, it } from "vitest";
import { KEY_ROLES } from "../src/deck/keys";
import { ACTION_UUIDS, PLUGIN_UUID } from "../src/ids";

describe("ACTION_UUIDS", () => {
  it("has one UUID per role, all in the plugin namespace", () => {
    expect(PLUGIN_UUID).toBe("dev.h2k.vibetribe");
    expect(Object.keys(ACTION_UUIDS).sort()).toEqual([...KEY_ROLES].sort());
    for (const uuid of Object.values(ACTION_UUIDS))
      expect(uuid).toMatch(/^dev\.h2k\.vibetribe\.[a-z0-9-]+$/);
  });

  it("are unique", () => {
    const values = Object.values(ACTION_UUIDS);
    expect(new Set(values).size).toBe(values.length);
  });
});
