import { describe, expect, it, vi } from "vitest";
import {
  credentialPaths,
  isProcessAlive,
  windowsCreationTimes,
  wslReadStat,
  wslUser,
} from "../src/sessions/ports";

const errno = (code: string) => Object.assign(new Error(code), { code });

describe("isProcessAlive (injected kill)", () => {
  it("EPERM means alive, ESRCH means gone, success means alive", () => {
    expect(
      isProcessAlive(1, () => {
        throw errno("EPERM");
      }),
    ).toBe(true);
    expect(
      isProcessAlive(1, () => {
        throw errno("ESRCH");
      }),
    ).toBe(false);
    expect(isProcessAlive(1, () => true)).toBe(true);
  });
});

describe("windowsCreationTimes", () => {
  it("builds only digits into the CIM filter (pids are truncated)", async () => {
    const calls: { file: string; args: string[] }[] = [];
    const out = await windowsCreationTimes([1.7, 42], async (file, args) => {
      calls.push({ file, args });
      return '[{"ProcessId":42,"CreationDate":"\\/Date(5)\\/"}]';
    });
    expect(out).toEqual(new Map([[42, 5]]));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("powershell.exe");
    expect(calls[0]?.args.join(" ")).toContain('-Filter "ProcessId=1 OR ProcessId=42"');
  });

  it("does not run anything for no pids", async () => {
    const run = vi.fn(async () => "");
    expect(await windowsCreationTimes([], run)).toEqual(new Map());
    expect(run).not.toHaveBeenCalled();
  });
});

describe("wslReadStat (injected read)", () => {
  it("returns null for ENOENT and ESRCH, rethrows everything else", async () => {
    const reading = (code: string) =>
      wslReadStat("Ubuntu", async () => {
        throw errno(code);
      });
    expect(await reading("ENOENT")(7)).toBeNull();
    expect(await reading("ESRCH")(7)).toBeNull();
    await expect(reading("EIO")(7)).rejects.toThrow("EIO");
  });

  it("reads /proc/<pid>/stat of the distro", async () => {
    const paths: string[] = [];
    const stat = wslReadStat("Ubuntu", async (p) => {
      paths.push(p);
      return "1 (x) S";
    });
    expect(await stat(7)).toBe("1 (x) S");
    expect(paths).toEqual(["\\\\wsl.localhost\\Ubuntu\\proc\\7\\stat"]);
  });
});

describe("wslUser never boots the distro", () => {
  it("returns null without exec when the distro is stopped, even with an override", async () => {
    const exec = vi.fn(async () => "h2k\n");
    const user = wslUser("Ubuntu", async () => false, {
      env: { VIBETRIBE_WSL_USER: "forced" },
      exec,
    });
    expect(await user()).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("returns the override while running, without exec", async () => {
    const exec = vi.fn(async () => "x");
    const user = wslUser("Ubuntu", async () => true, {
      env: { VIBETRIBE_WSL_USER: "forced" },
      exec,
    });
    expect(await user()).toBe("forced");
    expect(exec).not.toHaveBeenCalled();
  });

  it("returns null for a cached user once the distro stops", async () => {
    let running = true;
    const exec = vi.fn(async () => "h2k\n");
    const user = wslUser("Ubuntu", async () => running, { env: {}, exec });
    expect(await user()).toBe("h2k");
    expect(await user()).toBe("h2k");
    expect(exec).toHaveBeenCalledTimes(1);
    running = false;
    expect(await user()).toBeNull();
  });

  it("backs off 60 s after a failed lookup", async () => {
    let t = 1_000;
    const exec = vi.fn(async () => {
      throw new Error("fail");
    });
    const user = wslUser("Ubuntu", async () => true, { env: {}, exec, now: () => t });
    expect(await user()).toBeNull();
    t += 59_000;
    expect(await user()).toBeNull();
    expect(exec).toHaveBeenCalledTimes(1);
    t += 2_000;
    expect(await user()).toBeNull();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("runs wsl.exe -d <distro> whoami asynchronously", async () => {
    const calls: [string, string[]][] = [];
    const user = wslUser("Ubuntu", async () => true, {
      env: {},
      exec: async (f, a) => {
        calls.push([f, a]);
        return "h2k\r\n";
      },
    });
    expect(await user()).toBe("h2k");
    expect(calls).toEqual([["wsl.exe", ["-d", "Ubuntu", "whoami"]]]);
  });
});

describe("credentialPaths", () => {
  const home = "C:\\Users\\H";
  const winPath = "C:\\Users\\H\\.claude\\.credentials.json";
  const wsl = (running: boolean, user: () => Promise<string | null>) => ({
    distro: "Ubuntu",
    isRunning: async () => running,
    user,
  });

  it("returns only the Windows path without WSL", async () => {
    expect(await credentialPaths(home, null)).toEqual([winPath]);
  });

  it("returns only the Windows path while WSL is not running and never asks for the user", async () => {
    const user = vi.fn(async () => "h2k");
    expect(await credentialPaths(home, wsl(false, user))).toEqual([winPath]);
    expect(user).not.toHaveBeenCalled();
  });

  it("adds the WSL path when running and the user is known", async () => {
    expect(
      await credentialPaths(
        home,
        wsl(true, async () => "h2k"),
      ),
    ).toEqual([winPath, "\\\\wsl.localhost\\Ubuntu\\home\\h2k\\.claude\\.credentials.json"]);
  });

  it("returns only the Windows path when running but the user is unknown", async () => {
    expect(
      await credentialPaths(
        home,
        wsl(true, async () => null),
      ),
    ).toEqual([winPath]);
  });
});
