import { describe, expect, it } from "vitest";
import { changed, ok, skipped } from "../src/doctor/check";
import { checkSessionFiles, type ProcessCheck, type SessionFileText } from "../src/doctor/sessions";

const DESKTOP_ID = "local_0a1b2c3d-0000-4000-8000-00000000000a";
const NAME = "session files (WSL)";

/** `<pid>.json` as Claude Code writes it (procStart = pid × 10), with fields replaced or removed. */
const file = (pid: number, fields: Record<string, unknown> = {}): SessionFileText => ({
  name: `${pid}.json`,
  text: JSON.stringify({
    pid,
    sessionId: `s${pid}`,
    cwd: "/p",
    procStart: String(pid * 10),
    status: "idle",
    entrypoint: "cli",
    ...fields,
  }),
});

/** These pids run, each started at pid × 10. */
const running =
  (...pids: number[]): ProcessCheck =>
  async (asked) =>
    new Map(
      asked.filter((p) => pids.includes(p)).map((p) => [p, (s: string) => s === String(p * 10)]),
    );
const every: ProcessCheck = async (asked) =>
  new Map(asked.map((p) => [p, (s: string) => s === String(p * 10)]));
const check = (entries: SessionFileText[], processes = every) =>
  checkSessionFiles(NAME, entries, processes);

describe("checkSessionFiles", () => {
  it("checks only the files of running processes and ignores other entries", async () => {
    const asked: number[] = [];
    const processes: ProcessCheck = async (pids) => {
      asked.push(...pids);
      return running(1, 3)(pids);
    };
    const entries = [
      file(1, { entrypoint: "claude-desktop", hostSessionId: DESKTOP_ID }),
      file(2, { entrypoint: "claude-desktop" }),
      file(3, { entrypoint: "claude-desktop", procStart: "999" }),
      { name: "1.0a1b.key", text: "" },
    ];
    expect(await check(entries, processes)).toEqual(ok(NAME, "1 live of 3 files"));
    expect(asked).toEqual([1, 2, 3]);
  });

  it("ignores broken files whose process has ended", async () => {
    const entries = [file(1), { name: "2.json", text: "{" }, file(3, { procStart: undefined })];
    expect(await check(entries, running(1))).toEqual(ok(NAME, "1 live of 3 files"));
  });

  it("cannot check the live fields while no session runs", async () => {
    expect(await check([file(1), file(2)], running())).toEqual(
      skipped(NAME, "no live session among 2 files"),
    );
  });

  it.each([
    [
      "a file without its pid",
      [file(1), { name: "2.json", text: JSON.stringify({ sessionId: "s", procStart: "20" }) }],
      "files of running pids without sessionId or their pid: 1",
    ],
    [
      "a file naming another pid",
      [{ name: "3.json", text: file(4).text }],
      "files of running pids without sessionId or their pid: 1",
    ],
    [
      "a file without procStart",
      [file(1, { procStart: undefined })],
      "files of running pids without procStart: 1",
    ],
    [
      "a status the parser does not know",
      [file(1, { status: "paused" })],
      'unknown status "paused"',
    ],
    [
      "a status that is no plain word",
      [file(1, { status: "C:\\Users\\me" })],
      "unknown status a non-word value",
    ],
    [
      "a live Claude Desktop session without its Desktop id",
      [
        file(1, { entrypoint: "claude-desktop" }),
        file(2, { entrypoint: "claude-desktop", hostSessionId: "x" }),
      ],
      "live Claude Desktop sessions without a Desktop id: 2",
    ],
  ])("calls %s drift", async (_name, entries, detail) => {
    expect(await check(entries)).toEqual(changed(NAME, detail));
  });
});
