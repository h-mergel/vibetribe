import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopFocus, parseLastFocusedAt } from "../src/focus/desktop";
import type { DirPort } from "../src/sessions/sources";

const A = "local_0a1b2c3d-0000-4000-8000-00000000000a";
const B = "local_0a1b2c3d-0000-4000-8000-00000000000b";
const C = "local_0a1b2c3d-0000-4000-8000-00000000000c";
const file = (lastFocusedAt: unknown): string => JSON.stringify({ sessionId: "x", lastFocusedAt });

/** A file system of directories (entry names) and files (text); counts every call. */
function fakeFs(dirs: Record<string, string[]>, files: Record<string, string>) {
  const calls = { list: 0, read: [] as string[] };
  const fs: DirPort = {
    list: async (dir) => {
      calls.list++;
      const names = dirs[dir];
      if (names === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return names;
    },
    read: async (path) => {
      calls.read.push(path);
      const text = files[path];
      if (text === undefined) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      return text;
    },
  };
  return { fs, calls };
}

const root = join("L", "Claude", "claude-code-sessions");
const account = join(root, "ws", "acct");
const at = (id: string): string => join(account, `${id}.json`);

describe("parseLastFocusedAt", () => {
  it("takes the number Claude Desktop wrote", () => {
    expect(parseLastFocusedAt(file(1_760_000_000_000))).toBe(1_760_000_000_000);
  });

  it.each([
    ["absent", JSON.stringify({ sessionId: "x" })],
    ["a string", file("1760000000000")],
    ["null", file(null)],
    ["no object", "[1]"],
    ["half written", file(1_760_000_000_000).slice(0, 20)],
  ])("knows no focus when it is %s", (_name, text) => {
    expect(parseLastFocusedAt(text)).toBeNull();
  });
});

describe("DesktopFocus", () => {
  it("reads only the files of the ids asked for and scans the folders only for an unknown id", async () => {
    const { fs, calls } = fakeFs(
      {
        [root]: ["ws"],
        [join(root, "ws")]: ["acct"],
        [account]: [`${A}.json`, `${B}.json`, "deleted_x", "archived-sessions.idx", "backlog"],
      },
      { [at(A)]: file(1_000), [at(B)]: file(2_000) },
    );
    const focus = new DesktopFocus([root], fs);
    expect(await focus.focusedAt([A])).toEqual(new Map([[A, 1_000]]));
    expect(calls.read).toEqual([at(A)]);
    const scans = calls.list;
    expect(await focus.focusedAt([B, A])).toEqual(
      new Map([
        [B, 2_000],
        [A, 1_000],
      ]),
    );
    expect(calls.list).toBe(scans);
    // an id without a file scans again, every time it is asked for
    expect(await focus.focusedAt([C])).toEqual(new Map());
    expect(calls.list).toBe(2 * scans);
    expect(calls.read).toEqual([at(A), at(B), at(A)]);
  });

  it("scans every root and skips the ones that do not exist", async () => {
    const classic = join("A", "Claude", "claude-code-sessions");
    const { fs } = fakeFs(
      {
        [classic]: ["ws"],
        [join(classic, "ws")]: ["acct"],
        [join(classic, "ws", "acct")]: [`${A}.json`],
      },
      { [join(classic, "ws", "acct", `${A}.json`)]: file(1_000) },
    );
    expect(await new DesktopFocus([root, classic], fs).focusedAt([A])).toEqual(
      new Map([[A, 1_000]]),
    );
  });

  it("leaves out a file it cannot read or parse right now and finds it again with the next scan", async () => {
    const files: Record<string, string> = { [at(B)]: "{" };
    const { fs, calls } = fakeFs(
      {
        [root]: ["ws"],
        [join(root, "ws")]: ["acct"],
        [account]: [`${A}.json`, `${B}.json`],
      },
      files,
    );
    const focus = new DesktopFocus([root], fs);
    expect(await focus.focusedAt([A, B])).toEqual(new Map());
    const scans = calls.list;
    files[at(A)] = file(1_000);
    files[at(B)] = file(2_000);
    expect(await focus.focusedAt([A, B])).toEqual(
      new Map([
        [A, 1_000],
        [B, 2_000],
      ]),
    );
    // A was unreadable and dropped out; B was only half written and stayed known
    expect(calls.list).toBe(2 * scans);
  });

  it("knows nothing without any folder and never throws", async () => {
    const { fs } = fakeFs({}, {});
    expect(await new DesktopFocus([root], fs).focusedAt([A])).toEqual(new Map());
  });
});
