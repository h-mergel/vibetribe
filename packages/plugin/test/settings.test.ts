import { describe, expect, it, vi } from "vitest";
import {
  followPreferPinned,
  PREFER_PINNED_DEFAULT,
  PREFER_PINNED_KEY,
  preferPinnedOf,
} from "../src/settings";

describe("preferPinnedOf", () => {
  it("is on by default and follows a saved boolean", () => {
    expect(PREFER_PINNED_DEFAULT).toBe(true);
    expect(preferPinnedOf({ [PREFER_PINNED_KEY]: false })).toBe(false);
    expect(preferPinnedOf({ [PREFER_PINNED_KEY]: true })).toBe(true);
  });

  it.each([undefined, null, {}, { preferPinned: "false" }, { preferPinned: 0 }, [false]])(
    "falls back to the default for %j",
    (settings) => {
      expect(preferPinnedOf(settings)).toBe(true);
    },
  );
});

describe("followPreferPinned", () => {
  it("applies the saved setting, then every change from the property inspector", async () => {
    const listeners: ((ev: { settings: unknown }) => void)[] = [];
    const applied: boolean[] = [];
    followPreferPinned(
      {
        getGlobalSettings: async () => ({ preferPinned: false }),
        onDidReceiveGlobalSettings: (l) => listeners.push(l),
      },
      (on) => applied.push(on),
      () => {},
    );
    await vi.waitFor(() => expect(applied).toEqual([false]));
    listeners[0]?.({ settings: { preferPinned: true } });
    expect(applied).toEqual([false, true]);
  });

  it("logs a failed read and applies the default", async () => {
    const applied: boolean[] = [];
    const lines: string[] = [];
    followPreferPinned(
      {
        getGlobalSettings: async () => {
          throw new Error("not connected");
        },
        onDidReceiveGlobalSettings: () => {},
      },
      (on) => applied.push(on),
      (l) => lines.push(l),
    );
    await vi.waitFor(() =>
      expect(lines).toEqual(["global settings not read: Error: not connected"]),
    );
    expect(applied).toEqual([true]);
  });
});
