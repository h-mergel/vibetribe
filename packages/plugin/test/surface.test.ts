import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSdkSurface, type SdkAction } from "../src/sdk/surface";

interface FakeAction {
  isKey(): boolean;
  setImage(image: string): Promise<void>;
  showAlert?(): Promise<void>;
}

function setup(o: {
  action?: FakeAction | undefined;
  openUrl?: (url: string) => Promise<void>;
  getThrows?: boolean;
  switchToProfile?: (device: string, profile?: string) => Promise<void>;
}) {
  const lines: string[] = [];
  const sd = {
    actions: {
      getActionById: (_id: string) => {
        if (o.getThrows) throw new Error("boom");
        return o.action as unknown as SdkAction | undefined;
      },
    },
    system: { openUrl: o.openUrl ?? (async () => {}) },
    profiles: { switchToProfile: o.switchToProfile ?? (async () => {}) },
  };
  return { surface: createSdkSurface(sd, (l) => lines.push(l)), lines };
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => {
  unhandled.push(e);
};
beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe("createSdkSurface", () => {
  it("hands the image to a visible key and reports true", () => {
    const sent: string[] = [];
    const { surface } = setup({
      action: {
        isKey: () => true,
        setImage: async (i) => {
          sent.push(i);
        },
      },
    });
    expect(surface.setImage("k", "img")).toBe(true);
    expect(sent).toEqual(["img"]);
  });

  it("returns false and logs when the action is not visible", () => {
    const { surface, lines } = setup({ action: undefined });
    expect(surface.setImage("k", "img")).toBe(false);
    expect(lines).toEqual(["setImage k dropped: action not visible"]);
  });

  it("returns false and does not call setImage on an action that is not a key", () => {
    const setImage = vi.fn(async () => {});
    const { surface, lines } = setup({ action: { isKey: () => false, setImage } });
    expect(surface.setImage("k", "img")).toBe(false);
    expect(setImage).not.toHaveBeenCalled();
    expect(lines[0]).toContain("dropped: action not visible");
  });

  it("logs a rejected setImage without an unhandled rejection", async () => {
    const { surface, lines } = setup({
      action: { isKey: () => true, setImage: () => Promise.reject(new Error("nope")) },
    });
    expect(surface.setImage("k", "img")).toBe(true);
    await flush();
    expect(lines).toEqual(["setImage k rejected: Error: nope"]);
    expect(unhandled).toEqual([]);
  });

  it("returns false and logs when the SDK throws synchronously", () => {
    const { surface, lines } = setup({ getThrows: true });
    expect(surface.setImage("k", "img")).toBe(false);
    expect(lines).toEqual(["setImage k failed: Error: boom"]);
  });

  it("opens urls, logs a rejection and survives a synchronous throw", async () => {
    const opened: string[] = [];
    const ok = setup({
      openUrl: async (u) => {
        opened.push(u);
      },
    });
    ok.surface.openUrl("http://x");
    expect(opened).toEqual(["http://x"]);

    const rejected = setup({ openUrl: () => Promise.reject(new Error("no browser")) });
    rejected.surface.openUrl("http://x");
    await flush();
    expect(rejected.lines).toEqual(["openUrl rejected: Error: no browser"]);
    expect(unhandled).toEqual([]);

    const thrown = setup({
      openUrl: () => {
        throw new Error("sync");
      },
    });
    expect(() => thrown.surface.openUrl("http://x")).not.toThrow();
    expect(thrown.lines).toEqual(["openUrl failed: Error: sync"]);
  });

  it("switches the profile of the device; without a name, back to the previous one", () => {
    const calls: [string, string | undefined][] = [];
    const { surface } = setup({
      switchToProfile: async (device, profile) => {
        calls.push([device, profile]);
      },
    });
    surface.switchProfile("k", "dev1", "profiles/X");
    surface.switchProfile("k", "dev1");
    expect(calls).toEqual([
      ["dev1", "profiles/X"],
      ["dev1", undefined],
    ]);
  });

  it("a refused switch is logged and alerts on the pressed key, sync or async", async () => {
    const showAlert = vi.fn(async () => {});
    const action = { isKey: () => true, setImage: async () => {}, showAlert };
    const rejected = setup({ action, switchToProfile: () => Promise.reject(new Error("no")) });
    rejected.surface.switchProfile("k", "dev1", "p");
    await flush();
    expect(rejected.lines).toEqual(["switchProfile p rejected: Error: no"]);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);

    const thrown = setup({
      action,
      switchToProfile: () => {
        throw new Error("sync");
      },
    });
    expect(() => thrown.surface.switchProfile("k", "dev1")).not.toThrow();
    expect(thrown.lines).toEqual(["switchProfile previous failed: Error: sync"]);
    expect(showAlert).toHaveBeenCalledTimes(2);
  });

  it("shows the alert on a key; a hidden key or a rejection is only logged", async () => {
    const showAlert = vi.fn(async () => {});
    const ok = setup({ action: { isKey: () => true, setImage: async () => {}, showAlert } });
    ok.surface.showAlert("k");
    expect(showAlert).toHaveBeenCalledTimes(1);

    const hidden = setup({ action: undefined });
    hidden.surface.showAlert("k");
    expect(hidden.lines).toEqual(["showAlert k dropped: action not visible"]);

    const rejected = setup({
      action: {
        isKey: () => true,
        setImage: async () => {},
        showAlert: () => Promise.reject(new Error("nope")),
      },
    });
    rejected.surface.showAlert("k");
    await flush();
    expect(rejected.lines).toEqual(["showAlert k rejected: Error: nope"]);
    expect(unhandled).toEqual([]);
  });
});
