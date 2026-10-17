import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createLoggingOpener,
  createRundll32Opener,
  rundll32Path,
  type SpawnFn,
} from "../src/jump/opener";
import { isJumpUrl, jumpUrlFor } from "../src/jump/target";
import { view } from "./helpers";

const DESKTOP = "local_7b1f1a36-0c2d-4e5f-8a9b-0c1d2e3f4a5b";

describe("jumpUrlFor", () => {
  it("opens a Desktop session by its Desktop id, also when it has Remote Control", () => {
    const v = view({ entrypoint: "claude-desktop", hostSessionId: DESKTOP });
    expect(jumpUrlFor(v)).toBe(`claude://claude.ai/epitaxy/${DESKTOP}`);
    const both = view({ hostSessionId: DESKTOP, bridgeSessionId: "session_01Abc" });
    expect(jumpUrlFor(both)).toBe(`claude://claude.ai/epitaxy/${DESKTOP}`);
  });

  it("opens remote and Remote Control sessions by their bridge id", () => {
    const remote = view({
      hostKind: "remote",
      badge: "REM",
      entrypoint: null,
      bridgeSessionId: "session_01Abc",
    });
    expect(jumpUrlFor(remote)).toBe("claude://claude.ai/code/session_01Abc");
    const cli = view({
      entrypoint: "cli",
      hostSessionId: DESKTOP,
      bridgeSessionId: "session_01Abc",
    });
    expect(jumpUrlFor(cli)).toBe("claude://claude.ai/code/session_01Abc");
  });

  it("has no target for a CLI session without ids, a hook-only session or malformed ids", () => {
    expect(jumpUrlFor(view({ entrypoint: "cli" }))).toBeNull();
    expect(jumpUrlFor(view({ entrypoint: null }))).toBeNull();
    expect(jumpUrlFor(view({ hostSessionId: "local_x&calc" }))).toBeNull();
    expect(jumpUrlFor(view({ hostSessionId: "local_../../x" }))).toBeNull();
    expect(jumpUrlFor(view({ bridgeSessionId: "session_01 x" }))).toBeNull();
    expect(jumpUrlFor(view({ hostSessionId: "cse_123" }))).toBeNull();
  });
});

describe("isJumpUrl", () => {
  it("accepts exactly the two claude link forms", () => {
    expect(isJumpUrl(`claude://claude.ai/epitaxy/${DESKTOP}`)).toBe(true);
    expect(isJumpUrl("claude://claude.ai/code/session_01Abc")).toBe(true);
  });

  it.each([
    "https://claude.ai/code/session_01Abc",
    "claude://evil.example/code/session_01Abc",
    "CLAUDE://claude.ai/code/session_01Abc",
    "claude://claude.ai/code/session_01Abc?x=1",
    "claude://claude.ai/code/session_01Abc/../x",
    'claude://claude.ai/code/session_01Abc" & calc',
    "claude://claude.ai/code/session_01Abc\n",
    "claude://claude.ai/epitaxy/local_",
    "claude://claude.ai/code/continue?session=local_x",
    "",
  ])("rejects %j", (url) => {
    expect(isJumpUrl(url)).toBe(false);
  });
});

describe("rundll32Path", () => {
  it("uses SystemRoot only when it is a plain drive path", () => {
    expect(rundll32Path({})).toBe("C:\\Windows\\System32\\rundll32.exe");
    expect(rundll32Path({ SystemRoot: "D:\\Windows" })).toBe("D:\\Windows\\System32\\rundll32.exe");
    expect(rundll32Path({ SystemRoot: 'C:\\x" & calc' })).toBe(
      "C:\\Windows\\System32\\rundll32.exe",
    );
    expect(rundll32Path({ SystemRoot: "\\\\server\\share" })).toBe(
      "C:\\Windows\\System32\\rundll32.exe",
    );
  });

  it("refuses a SystemRoot that climbs out with ..", () => {
    expect(rundll32Path({ SystemRoot: "C:\\Windows\\..\\Users\\x" })).toBe(
      "C:\\Windows\\System32\\rundll32.exe",
    );
  });
});

class FakeChild extends EventEmitter {
  unrefs = 0;
  unref(): void {
    this.unrefs++;
  }
}

function spawner(behave: (child: FakeChild) => void) {
  const calls: { file: string; args: string[]; options: unknown }[] = [];
  const children: FakeChild[] = [];
  const spawnFn: SpawnFn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new FakeChild();
    children.push(child);
    queueMicrotask(() => behave(child));
    return child;
  };
  return { spawnFn, calls, children };
}

describe("createRundll32Opener", () => {
  const url = "claude://claude.ai/code/session_01Abc";

  it("starts rundll32 by absolute path without a shell and reports opened once it spawned", async () => {
    const { spawnFn, calls, children } = spawner((c) => c.emit("spawn"));
    const opener = createRundll32Opener(() => {}, spawnFn, "C:\\Windows\\System32\\rundll32.exe");
    expect(await opener.open(url)).toBe("opened");
    expect(calls).toEqual([
      {
        file: "C:\\Windows\\System32\\rundll32.exe",
        args: ["url.dll,FileProtocolHandler", url],
        options: { detached: true, stdio: "ignore", windowsHide: true, shell: false },
      },
    ]);
    expect(children[0]?.unrefs).toBe(1);
  });

  it("reports failed and logs when the process cannot start or spawn throws", async () => {
    const lines: string[] = [];
    const failing = spawner((c) => c.emit("error", new Error("ENOENT")));
    expect(await createRundll32Opener((l) => lines.push(l), failing.spawnFn).open(url)).toBe(
      "failed",
    );
    const throwing: SpawnFn = () => {
      throw new Error("EPERM");
    };
    expect(await createRundll32Opener((l) => lines.push(l), throwing).open(url)).toBe("failed");
    expect(lines).toEqual(["jump failed: Error: ENOENT", "jump failed: Error: EPERM"]);
  });

  it("never starts a process for anything but a claude link", async () => {
    const lines: string[] = [];
    const { spawnFn, calls } = spawner((c) => c.emit("spawn"));
    const opener = createRundll32Opener((l) => lines.push(l), spawnFn);
    expect(await opener.open("https://evil.example")).toBe("failed");
    expect(await opener.open("claude://claude.ai/code/session_01Abc & calc")).toBe("failed");
    expect(calls).toEqual([]);
    expect(lines[0]).toBe('jump refused: "https://evil.example" is not a claude link');
  });
});

describe("createLoggingOpener", () => {
  it("logs the link and starts nothing", async () => {
    const lines: string[] = [];
    expect(await createLoggingOpener((l) => lines.push(l)).open("claude://x")).toBe("logged");
    expect(lines).toEqual(["jump (headless, not opened): claude://x"]);
  });
});
