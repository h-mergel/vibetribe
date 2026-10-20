import { Hub, SETUP_SOURCE } from "@vibetribe/hub";
import type { SetupState } from "@vibetribe/reporter/setup";
import { describe, expect, it } from "vitest";
import { requestOf, SetupController, type SetupView } from "../src/setup/controller";
import type { SetupResult } from "../src/setup/windows";
import type { WslMode } from "../src/setup/wsl";

/** Lets the background lookup of WSL finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** `distros`: what each lookup of WSL answers, in turn (the last one repeats). */
function controller(o: { state?: SetupState; distros?: (string | null)[] } = {}) {
  let state: SetupState = o.state ?? "missing";
  let unreadable = false;
  const distros = o.distros ?? ["Debian"];
  let lookups = 0;
  const views: SetupView[] = [];
  const calls: string[] = [];
  const found: string[] = [];
  const hub = new Hub();
  let releaseWsl: (r: SetupResult) => void = () => {};
  const c = new SetupController({
    windows: {
      state: () => {
        if (unreadable) throw new Error("EACCES");
        return state;
      },
      install: () => {
        calls.push("install");
        state = "installed";
        return { ok: true, text: "installed" };
      },
      uninstall: () => {
        calls.push("uninstall");
        state = "missing";
        return { ok: true, text: "removed" };
      },
    },
    findDistro: async () => distros[Math.min(lookups++, distros.length - 1)] ?? null,
    wslFound: (distro) => found.push(distro),
    wsl: (distro: string, mode: WslMode) => {
      calls.push(`wsl ${distro} ${mode}`);
      return new Promise((resolve) => {
        releaseWsl = resolve;
      });
    },
    publish: (v) => views.push(v),
    hub,
    now: () => 5,
    log: () => {},
  });
  return {
    c,
    views,
    calls,
    found,
    hub,
    lookups: () => lookups,
    release: (r: SetupResult) => releaseWsl(r),
    breakState: () => {
      unreadable = true;
    },
  };
}

describe("requestOf", () => {
  it("knows exactly the five requests of the property inspector", () => {
    for (const r of ["refresh", "install", "remove", "install-wsl", "remove-wsl"])
      expect(requestOf({ setup: r })).toBe(r);
    expect(requestOf({ setup: "rm -rf" })).toBeNull();
    expect(requestOf("install")).toBeNull();
    expect(requestOf(null)).toBeNull();
  });
});

describe("SetupController", () => {
  it("marks missing hooks on the hub and shows the state, then the WSL distribution once found", async () => {
    const { c, views, hub, found } = controller();
    c.refresh();
    expect(hub.state(5).sources[SETUP_SOURCE]?.error).toBe("Claude Code hooks not set up");
    expect(views.at(-1)).toEqual({ windows: "missing", wsl: null, busy: false, message: null });
    await settle();
    expect(views.at(-1)).toEqual({ windows: "missing", wsl: "Debian", busy: false, message: null });
    expect(found).toEqual(["Debian"]);
  });

  it("looks for WSL again on the next refresh until it is found, and then never again", async () => {
    const { c, views, found, lookups } = controller({ distros: [null, "Debian"] });
    c.refresh();
    await settle();
    expect(views.at(-1)?.wsl).toBeNull();
    c.refresh();
    c.refresh();
    await settle();
    expect(views.at(-1)?.wsl).toBe("Debian");
    c.refresh();
    await settle();
    expect(found).toEqual(["Debian"]);
    expect(lookups()).toBe(2);
  });

  it("calls outdated hooks an update and clears the mark once installed", async () => {
    const { c, hub } = controller({ state: "outdated" });
    c.refresh();
    expect(hub.state(5).sources[SETUP_SOURCE]?.error).toBe("Claude Code hooks need an update");
    await c.handle({ setup: "install" });
    expect(hub.state(5).sources[SETUP_SOURCE]).toEqual({ health: "ok", lastAt: 5, error: null });
  });

  it("installs and removes on Windows, showing each result", async () => {
    const { c, views, calls } = controller();
    c.refresh();
    await settle();
    await c.handle({ setup: "install" });
    expect(views.at(-1)).toEqual({
      windows: "installed",
      wsl: "Debian",
      busy: false,
      message: { ok: true, text: "installed" },
    });
    await c.handle({ setup: "remove" });
    expect(calls).toEqual(["install", "uninstall"]);
    expect(views.at(-1)?.windows).toBe("missing");
  });

  it("sets up WSL only after Windows, and ignores clicks while a step runs", async () => {
    const { c, views, calls, release } = controller();
    c.refresh();
    await settle();
    await c.handle({ setup: "install-wsl" });
    expect(views.at(-1)?.message).toEqual({ ok: false, text: "Set up Windows first." });
    expect(calls).toEqual([]);
    await c.handle({ setup: "install" });
    const running = c.handle({ setup: "install-wsl" });
    expect(views.at(-1)?.busy).toBe(true);
    await c.handle({ setup: "remove" });
    await settle();
    release({ ok: true, text: "in WSL" });
    await running;
    expect(calls).toEqual(["install", "wsl Debian install"]);
    expect(views.at(-1)).toMatchObject({ busy: false, message: { ok: true, text: "in WSL" } });
  });

  it("offers no WSL step without a distribution", async () => {
    const { c, views, calls } = controller({ state: "installed", distros: [null] });
    c.refresh();
    await settle();
    await c.handle({ setup: "remove-wsl" });
    expect(calls).toEqual([]);
    expect(views.at(-1)).toMatchObject({
      wsl: null,
      message: { ok: false, text: "WSL was not found." },
    });
  });

  it("refresh clears the last message", async () => {
    const { c, views } = controller();
    await c.handle({ setup: "install" });
    await c.handle({ setup: "refresh" });
    expect(views.at(-1)?.message).toBeNull();
  });

  it("counts a state that cannot be read as missing", () => {
    const { c, views, hub, breakState } = controller({ state: "installed" });
    c.refresh();
    expect(views.at(-1)?.windows).toBe("installed");
    breakState();
    c.refresh();
    expect(views.at(-1)?.windows).toBe("missing");
    expect(hub.state(5).sources[SETUP_SOURCE]?.error).toBe("Claude Code hooks not set up");
  });
});
