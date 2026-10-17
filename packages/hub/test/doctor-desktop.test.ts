import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changed, formatResult, hasDrift, ok, skipped } from "../src/doctor/check";
import { checkDesktop } from "../src/doctor/desktop";
import type { DirPort } from "../src/sessions/sources";

const H = join("/", "home", "u");
const data = join(H, "Local", "Claude-Data", "claude_x");
const msix = join(H, "Local", "Packages", "Claude_x", "LocalCache", "Roaming", "Claude");
const A = "local_0a1b2c3d-0000-4000-8000-00000000000a";
const B = "local_0a1b2c3d-0000-4000-8000-00000000000b";
const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;
const errno = (code: string) => Object.assign(new Error(code), { code });
const config = (pinnedOrder: unknown): string =>
  JSON.stringify({ preferences: { epitaxyPrefs: { "dframe-local-slice": { pinnedOrder } } } });
const session = (lastFocusedAt: unknown): string =>
  JSON.stringify({ sessionId: "x", lastFocusedAt });

type Entries = Record<string, string[] | string | Error>;

/** Directories are entry lists, files are texts or the error reading them throws; the rest is missing. */
function fakeFs(entries: Entries): DirPort {
  return {
    list: async (dir) => {
      const e = entries[dir];
      if (Array.isArray(e)) return e;
      throw errno("ENOENT");
    },
    read: async (path) => {
      const e = entries[path];
      if (typeof e === "string") return e;
      throw e instanceof Error ? e : errno("ENOENT");
    },
  };
}

/** Claude-Data with a config and one account folder holding these session files. */
function desktop(
  configText: string | Error,
  sessions: Record<string, string | Error> = {},
): Entries {
  const root = join(data, "claude-code-sessions");
  const account = join(root, "ws", "acct");
  const files = Object.entries(sessions).map(([id, text]) => [join(account, `${id}.json`), text]);
  return {
    [join(data, "claude_desktop_config.json")]: configText,
    [root]: ["ws"],
    [join(root, "ws")]: ["acct"],
    [account]: [...Object.keys(sessions).map((id) => `${id}.json`), "deleted_x", "backlog"],
    ...Object.fromEntries(files),
  };
}

const run = (entries: Entries) =>
  checkDesktop({ dirs: [data, msix], home: H, fs: fakeFs(entries), now: NOW });

describe("formatResult", () => {
  it("prints one line per assumption", () => {
    expect(formatResult(ok("ports", "43710 free"))).toBe("ports: ok (43710 free)");
    expect(formatResult(ok("ports"))).toBe("ports: ok");
    expect(formatResult(changed("desktop pins", "no list"))).toBe("desktop pins: changed: no list");
    expect(formatResult(skipped("usage", "login expired"))).toBe("usage: skipped: login expired");
  });

  it("counts only a changed assumption as drift", () => {
    expect(hasDrift([ok("a"), skipped("b", "no hub running")])).toBe(false);
    expect(hasDrift([ok("a"), changed("b", "moved")])).toBe(true);
  });
});

describe("checkDesktop", () => {
  it("names the folder of the config, counts the pins and the session files with lastFocusedAt", async () => {
    const sessions = { [A]: session(NOW - HOUR), [B]: session(undefined) };
    expect(await run(desktop(config([`code:${A}`, `code:${B}`]), sessions))).toEqual([
      ok("desktop folder", join("Local", "Claude-Data", "claude_x")),
      ok("desktop pins", "2 pinned"),
      ok("desktop session files", "2 files, 1 with lastFocusedAt, newest 1.0 h ago"),
    ]);
  });

  it("finds the config in an older folder when the newest one has none", async () => {
    const results = await run({ [join(msix, "claude_desktop_config.json")]: config([]) });
    expect(results.slice(0, 2)).toEqual([
      ok(
        "desktop folder",
        join("Local", "Packages", "Claude_x", "LocalCache", "Roaming", "Claude"),
      ),
      ok("desktop pins", "0 pinned"),
    ]);
  });

  it("calls a missing config and missing session files drift", async () => {
    expect(await run({})).toEqual([
      changed("desktop folder", "no claude_desktop_config.json in 2 known folders"),
      skipped("desktop pins", "no config"),
      changed(
        "desktop session files",
        "no local_<uuid>.json in claude-code-sessions/<workspace>/<account>/",
      ),
    ]);
  });

  it.each([
    [
      "without a pin list",
      '{"preferences":{}}',
      changed(
        "desktop pins",
        'no list at preferences.epitaxyPrefs["dframe-local-slice"].pinnedOrder',
      ),
    ],
    [
      "with entries of another form",
      config([`code:${A}`, "code:x", 7]),
      changed("desktop pins", "2 of 3 entries unusable"),
    ],
    [
      "that is half written",
      config([`code:${A}`]).slice(0, 30),
      skipped("desktop pins", "config is being written"),
    ],
  ])("checks the pins of a config %s", async (_name, text, pins) => {
    expect((await run(desktop(text, { [A]: session(NOW) })))[1]).toEqual(pins);
  });

  it("skips folder and pins while the config is locked", async () => {
    expect((await run(desktop(errno("EBUSY"), { [A]: session(NOW) }))).slice(0, 2)).toEqual([
      skipped("desktop folder", "config unreadable right now (EBUSY)"),
      skipped("desktop pins", "config unreadable right now (EBUSY)"),
    ]);
  });

  it("calls session files without a numeric lastFocusedAt drift; an unreadable one does not count", async () => {
    const sessions = { [A]: session(String(NOW)), [B]: errno("EBUSY") };
    expect((await run(desktop(config([]), sessions)))[2]).toEqual(
      changed("desktop session files", "none of 2 files has a numeric lastFocusedAt"),
    );
  });
});
