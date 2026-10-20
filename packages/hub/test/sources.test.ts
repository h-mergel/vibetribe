import { describe, expect, it } from "vitest";
import {
  type DirPort,
  WindowsSessionSource,
  WslSessionSource,
  type WslSourcePorts,
} from "../src/sessions/sources";

const errno = (code: string) => Object.assign(new Error(code), { code });

function fakeFs(files: Record<string, string>): DirPort & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: async (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(dir))
        .map((p) => p.slice(dir.length + 1)),
    read: async (path) => {
      reads.push(path);
      const v = files[path];
      if (v === undefined) throw errno("ENOENT");
      return v;
    },
  };
}
const sessionJson = (pid: number, sid: string, procStart: string, status = "idle") =>
  JSON.stringify({
    pid,
    sessionId: sid,
    cwd: "C:/p",
    procStart,
    status,
    entrypoint: "claude-desktop",
    name: sid,
  });

describe("WindowsSessionSource", () => {
  const dir = "C:\\Users\\H\\.claude\\sessions";
  const FT_A = "134360984898638759"; // 1791624889863 ms

  it("returns only live sessions whose start time matches, reads only live pid files", async () => {
    const fs = fakeFs({
      [`${dir}\\100.json`]: sessionJson(100, "a", FT_A),
      [`${dir}\\200.json`]: sessionJson(200, "dead", FT_A),
      [`${dir}\\300.json`]: sessionJson(300, "recycled", FT_A),
      [`${dir}\\100.abc.key`]: "secret",
    });
    const cimCalls: number[][] = [];
    const src = new WindowsSessionSource({
      dir,
      fs,
      isAlive: (pid) => pid !== 200,
      creationTimes: async (pids) => {
        cimCalls.push(pids);
        return new Map(pids.map((p) => [p, p === 100 ? 1_791_624_889_863 : 1_000]));
      },
    });
    const snap = await src.scan(5);
    expect(snap).toMatchObject({ host: "win", hostKind: "windows", at: 5 });
    expect(snap?.sessions.map((s) => s.sessionId)).toEqual(["a"]);
    expect(fs.reads.some((p) => p.endsWith(".key") || p.endsWith("200.json"))).toBe(false);
    await src.scan(6);
    // verified pids are cached; the mismatching pid is re-queried (pid-reuse invalidation)
    expect(cimCalls).toEqual([[100, 300], [300]]);
  });

  it("skips broken and vanished files without failing the snapshot", async () => {
    const fs = fakeFs({
      [`${dir}\\100.json`]: '{"pid":100,',
      [`${dir}\\101.json`]: sessionJson(101, "ok", FT_A),
    });
    const list = fs.list;
    fs.list = async (d) => [...(await list(d)), "102.json"]; // listed, then gone before the read
    const src = new WindowsSessionSource({
      dir,
      fs,
      isAlive: () => true,
      creationTimes: async (p) => new Map(p.map((x) => [x, 1_791_624_889_863])),
    });
    expect((await src.scan(1))?.sessions.map((s) => s.sessionId)).toEqual(["ok"]);
  });

  it("throws on unexpected read errors instead of reporting sessions as gone", async () => {
    const fs: DirPort = {
      list: async () => ["100.json"],
      read: async () => {
        throw errno("EIO");
      },
    };
    const src = new WindowsSessionSource({
      dir,
      fs,
      isAlive: () => true,
      creationTimes: async (p) => new Map(p.map((x) => [x, 1])),
    });
    await expect(src.scan(1)).rejects.toMatchObject({ code: "EIO" });
  });
});

describe("WslSessionSource", () => {
  const dir = "\\\\wsl.localhost\\Ubuntu\\home\\h2k\\.claude\\sessions";
  const stat = (start: string) => `1 (claude) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 0 0`;

  function ports(over: Partial<WslSourcePorts> = {}): WslSourcePorts & { statCalls: number[] } {
    const statCalls: number[] = [];
    const stats: Record<number, string> = { 497651: stat("921344"), 713: stat("6900") };
    return {
      statCalls,
      distro: "Ubuntu",
      fs: fakeFs({
        [`${dir}\\497651.json`]: sessionJson(497651, "live", "921344"),
        [`${dir}\\713.json`]: sessionJson(713, "recycled", "587"),
        [`${dir}\\999.json`]: sessionJson(999, "dead", "1"),
      }),
      isRunning: async () => true,
      user: async () => "h2k",
      listProc: async () => ["1", "713", "497651", "self", "cpuinfo"],
      readStat: async (pid) => {
        statCalls.push(pid);
        return stats[pid] ?? null;
      },
      ...over,
    };
  }

  it("returns null without touching files or resolving the user when the distro is not running", async () => {
    let userCalls = 0;
    const p = ports({
      isRunning: async () => false,
      user: async () => {
        userCalls++;
        return "h2k";
      },
    });
    expect(await new WslSessionSource(p).scan(1)).toEqual({ inactive: "distro not running" });
    expect((p.fs as ReturnType<typeof fakeFs>).reads).toEqual([]);
    expect(userCalls).toBe(0);
  });

  it("reports an unknown user as the inactive reason", async () => {
    expect(await new WslSessionSource(ports({ user: async () => null })).scan(1)).toEqual({
      inactive: "WSL user unknown",
    });
  });

  it("keeps sessions whose /proc start time equals procStart and only probes live pids", async () => {
    const p = ports();
    const snap = await new WslSessionSource(p).scan(9);
    expect(snap).toMatchObject({ host: "wsl:Ubuntu", hostKind: "wsl", at: 9 });
    expect(
      (snap as { sessions: { sessionId: string }[] }).sessions.map((s) => s.sessionId),
    ).toEqual(["live"]);
    expect(p.statCalls).toEqual([497651, 713]); // 999 is not in /proc: never probed
    expect((p.fs as ReturnType<typeof fakeFs>).reads.some((r) => r.endsWith("999.json"))).toBe(
      false,
    );
  });

  it.each([
    [
      "listing the session dir",
      { fs: { list: async () => Promise.reject(errno("EIO")), read: async () => "" } },
    ],
    ["listing /proc", { listProc: async () => Promise.reject(errno("EIO")) }],
    ["reading a stat file", { readStat: async () => Promise.reject(errno("EIO")) }],
  ] as [string, Partial<WslSourcePorts>][])(
    "is inactive with the error as reason when %s fails, e.g. distro shutting down",
    async (_n, over) => {
      expect(await new WslSessionSource(ports(over)).scan(1)).toEqual({
        inactive: expect.stringContaining("EIO"),
      });
    },
  );

  it("names the error code of a permission failure in the inactive reason", async () => {
    const listProc = async () => Promise.reject(errno("EACCES"));
    const r = await new WslSessionSource(ports({ listProc })).scan(1);
    expect(r).toEqual({ inactive: expect.stringContaining("EACCES") });
  });

  it("is inactive when reading a session file fails with something other than ENOENT", async () => {
    const fs: DirPort = {
      list: async () => ["497651.json"],
      read: async () => {
        throw errno("EIO");
      },
    };
    expect(await new WslSessionSource(ports({ fs })).scan(1)).toEqual({
      inactive: expect.stringContaining("EIO"),
    });
  });
});

describe("WindowsSessionSource carry-forward and caches", () => {
  const dir = "C:\\Users\\H\\.claude\\sessions";
  const FT_A = "134360984898638759"; // 1791624889863 ms
  const FT_B = "134360984908638759"; // FT_A + 1000 ms
  const MS_A = 1_791_624_889_863;
  const key = `${dir}\\100.json`;

  function make(
    files: Record<string, string>,
    over: Partial<ConstructorParameters<typeof WindowsSessionSource>[0]> = {},
  ) {
    const fs = fakeFs(files);
    const src = new WindowsSessionSource({
      dir,
      fs,
      isAlive: () => true,
      creationTimes: async (pids) => new Map(pids.map((p) => [p, MS_A])),
      ...over,
    });
    return { fs, src };
  }
  const ids = (s: unknown) =>
    (s as { sessions: { sessionId: string }[] } | null)?.sessions.map((x) => x.sessionId);

  it("carries the last good info forward when the file is truncated in a later scan", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    const { src } = make(files);
    expect(ids(await src.scan(1))).toEqual(["a"]);
    files[key] = '{"pid":100,"sessionId":"a",';
    expect(ids(await src.scan(2))).toEqual(["a"]);
  });

  it("carries the last good info forward when the file read throws ENOENT", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    const { fs, src } = make(files);
    expect(ids(await src.scan(1))).toEqual(["a"]);
    fs.read = async () => {
      throw errno("ENOENT");
    };
    expect(ids(await src.scan(2))).toEqual(["a"]);
  });

  it("omits a file that is unparseable on first sight", async () => {
    const { src } = make({ [key]: '{"pid":100,' });
    expect(ids(await src.scan(1))).toEqual([]);
  });

  it("omits a file whose inner pid mismatches its name, or carries the last good info forward", async () => {
    const first = make({ [key]: sessionJson(101, "x", FT_A) });
    expect(ids(await first.src.scan(1))).toEqual([]);

    const files = { [key]: sessionJson(100, "a", FT_A) };
    const second = make(files);
    expect(ids(await second.src.scan(1))).toEqual(["a"]);
    files[key] = sessionJson(101, "x", FT_A);
    expect(ids(await second.src.scan(2))).toEqual(["a"]);
  });

  it("returns an empty snapshot when the sessions dir does not exist", async () => {
    const fs: DirPort = {
      list: async () => {
        throw errno("ENOENT");
      },
      read: async () => "",
    };
    const src = new WindowsSessionSource({
      dir,
      fs,
      isAlive: () => true,
      creationTimes: async () => new Map(),
    });
    expect(await src.scan(1)).toMatchObject({ host: "win", at: 1, sessions: [] });
  });

  it("does not hide a non-ENOENT failure listing the sessions dir", async () => {
    const fs: DirPort = {
      list: async () => {
        throw errno("EIO");
      },
      read: async () => "",
    };
    const src = new WindowsSessionSource({
      dir,
      fs,
      isAlive: () => true,
      creationTimes: async () => new Map(),
    });
    await expect(src.scan(1)).rejects.toMatchObject({ code: "EIO" });
  });

  it("excludes a live pid without a creation time and re-queries it only after 60 s", async () => {
    let calls = 0;
    const { src } = make(
      { [key]: sessionJson(100, "a", FT_A) },
      {
        creationTimes: async () => {
          calls++;
          return new Map();
        },
      },
    );
    expect(ids(await src.scan(0))).toEqual([]);
    expect(calls).toBe(1);
    expect(ids(await src.scan(30_000))).toEqual([]);
    expect(calls).toBe(1);
    await src.scan(60_000);
    expect(calls).toBe(2);
  });

  it("drops cache entries of dead pids so a reappearing pid is queried again", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    let alive = true;
    let ms = MS_A;
    let calls = 0;
    const { src } = make(files, {
      isAlive: () => alive,
      creationTimes: async (pids) => {
        calls++;
        return new Map(pids.map((p) => [p, ms]));
      },
    });
    expect(ids(await src.scan(1))).toEqual(["a"]);
    alive = false;
    expect(ids(await src.scan(2))).toEqual([]);
    alive = true;
    ms = MS_A + 1000;
    files[key] = sessionJson(100, "b", FT_B);
    expect(ids(await src.scan(3))).toEqual(["b"]);
    expect(calls).toBe(2);
  });

  it("invalidates the creation-time cache on a procStart mismatch and re-queries next scan", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    let ms = MS_A;
    let calls = 0;
    const { src } = make(files, {
      creationTimes: async (pids) => {
        calls++;
        return new Map(pids.map((p) => [p, ms]));
      },
    });
    expect(ids(await src.scan(1))).toEqual(["a"]);
    files[key] = sessionJson(100, "b", FT_B); // pid reused: new process, new procStart
    ms = MS_A + 1000;
    expect(ids(await src.scan(2))).toEqual([]); // excluded this round, not carried forward
    expect(ids(await src.scan(3))).toEqual(["b"]);
    expect(calls).toBe(2);
  });

  it("never inherits a dead session when a reused pid has no creation time", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    let ms = MS_A;
    let resolvable = true;
    const { src } = make(files, {
      creationTimes: async (pids) => (resolvable ? new Map(pids.map((p) => [p, ms])) : new Map()),
    });
    expect(ids(await src.scan(1))).toEqual(["a"]);
    files[key] = sessionJson(100, "b", FT_B);
    ms = MS_A + 1000;
    expect(ids(await src.scan(2))).toEqual([]); // pid reuse detected
    resolvable = false;
    expect(ids(await src.scan(3))).toEqual([]);
  });

  it("drops last-good info of a dead pid so a reappearing pid cannot inherit it", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    let alive = true;
    const { src } = make(files, { isAlive: () => alive });
    expect(ids(await src.scan(1))).toEqual(["a"]);
    alive = false;
    expect(ids(await src.scan(2))).toEqual([]);
    alive = true;
    files[key] = '{"pid":100,';
    expect(ids(await src.scan(3))).toEqual([]);
  });

  it("accepts a 1 ms creation-time difference and rejects 2 ms", async () => {
    const files = { [key]: sessionJson(100, "a", FT_A) };
    const one = make(files, { creationTimes: async (p) => new Map(p.map((x) => [x, MS_A + 1])) });
    expect(ids(await one.src.scan(1))).toEqual(["a"]);
    const two = make(files, { creationTimes: async (p) => new Map(p.map((x) => [x, MS_A + 2])) });
    expect(ids(await two.src.scan(1))).toEqual([]);
  });
});

describe("WslSessionSource carry-forward", () => {
  const dir = "\\\\wsl.localhost\\Ubuntu\\home\\h2k\\.claude\\sessions";
  const stat = (start: string) => `1 (claude) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 ${start} 0 0`;

  function ports(over: Partial<WslSourcePorts> = {}): WslSourcePorts {
    return {
      distro: "Ubuntu",
      fs: fakeFs({ [`${dir}\\497651.json`]: sessionJson(497651, "live", "921344") }),
      isRunning: async () => true,
      user: async () => "h2k",
      listProc: async () => ["497651"],
      readStat: async () => stat("921344"),
      ...over,
    };
  }
  const ids = (s: unknown) =>
    (s as { sessions: { sessionId: string }[] } | null)?.sessions.map((x) => x.sessionId);

  it("carries a known session forward when its file read throws ENOENT mid-scan", async () => {
    const p = ports();
    const src = new WslSessionSource(p);
    expect(ids(await src.scan(1))).toEqual(["live"]);
    p.fs.read = async () => {
      throw errno("ENOENT");
    };
    expect(ids(await src.scan(2))).toEqual(["live"]);
  });

  it("carries a known session forward when its file is truncated", async () => {
    const p = ports();
    const src = new WslSessionSource(p);
    expect(ids(await src.scan(1))).toEqual(["live"]);
    p.fs.read = async () => '{"pid":497651,"sess';
    expect(ids(await src.scan(2))).toEqual(["live"]);
  });

  it("omits an unreadable session that was never seen good", async () => {
    const p = ports();
    p.fs.read = async () => {
      throw errno("ENOENT");
    };
    expect(ids(await new WslSessionSource(p).scan(1))).toEqual([]);
  });

  it("a process gone before its stat read (readStat null) is omitted, not carried forward", async () => {
    let gone = false;
    const p = ports({ readStat: async () => (gone ? null : stat("921344")) });
    const src = new WslSessionSource(p);
    expect(ids(await src.scan(1))).toEqual(["live"]);
    gone = true;
    expect(ids(await src.scan(2))).toEqual([]);
  });

  it("does not carry forward when the process start time changed (pid reuse)", async () => {
    let start = "921344";
    const p = ports({ readStat: async () => stat(start) });
    const src = new WslSessionSource(p);
    expect(ids(await src.scan(1))).toEqual(["live"]);
    start = "999999";
    p.fs.read = async () => {
      throw errno("ENOENT");
    };
    expect(ids(await src.scan(2))).toEqual([]);
  });
});
