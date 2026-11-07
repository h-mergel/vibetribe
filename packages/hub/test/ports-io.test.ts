import { describe, expect, it, vi } from "vitest";
import {
  credentialPaths,
  isProcessAlive,
  windowsCreationTimes,
  wslHome,
  wslReadStat,
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

describe("wslHome never boots the distro", () => {
  it("returns null without exec when the distro is stopped, even with an override", async () => {
    const exec = vi.fn(async () => "/home/h2k\n");
    const home = wslHome("Ubuntu", async () => false, {
      env: { VIBETRIBE_WSL_USER: "forced" },
      exec,
    });
    expect(await home()).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("asks for the home of the override user", async () => {
    const exec = vi.fn(async (_file: string, _args: string[]) => "/srv/forced\n");
    const home = wslHome("Ubuntu", async () => true, {
      env: { VIBETRIBE_WSL_USER: "forced" },
      exec,
    });
    expect(await home()).toBe("/srv/forced");
    expect(exec).toHaveBeenCalledWith("wsl.exe", [
      "-d",
      "Ubuntu",
      "-u",
      "forced",
      "-e",
      "printenv",
      "HOME",
    ]);
  });

  it("returns null for a cached home once the distro stops", async () => {
    let running = true;
    const exec = vi.fn(async () => "/home/h2k\n");
    const home = wslHome("Ubuntu", async () => running, { env: {}, exec });
    expect(await home()).toBe("/home/h2k");
    expect(await home()).toBe("/home/h2k");
    expect(exec).toHaveBeenCalledTimes(1);
    running = false;
    expect(await home()).toBeNull();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("looks up again after the distro stopped: the default user may have changed", async () => {
    let running = true;
    const answers = ["/home/old\n", "/home/new\n"];
    const exec = vi.fn(async () => answers.shift() ?? "");
    const home = wslHome("Ubuntu", async () => running, { env: {}, exec });
    expect(await home()).toBe("/home/old");
    running = false;
    await home();
    running = true;
    expect(await home()).toBe("/home/new");
  });

  it("a failed lookup does not hold back the first lookup after a restart", async () => {
    let running = true;
    const exec = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("booting"))
      .mockResolvedValue("/home/h\n");
    const home = wslHome("Ubuntu", async () => running, { env: {}, exec, now: () => 1_000 });
    expect(await home()).toBeNull();
    running = false;
    await home();
    running = true;
    expect(await home()).toBe("/home/h");
  });

  it("backs off 60 s after a failed lookup", async () => {
    let t = 1_000;
    const exec = vi.fn(async () => {
      throw new Error("fail");
    });
    const home = wslHome("Ubuntu", async () => true, { env: {}, exec, now: () => t });
    expect(await home()).toBeNull();
    t += 59_000;
    expect(await home()).toBeNull();
    expect(exec).toHaveBeenCalledTimes(1);
    t += 2_000;
    expect(await home()).toBeNull();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("asks wsl.exe for HOME without a shell", async () => {
    const calls: [string, string[]][] = [];
    const home = wslHome("Ubuntu", async () => true, {
      env: {},
      exec: async (f, a) => {
        calls.push([f, a]);
        return "/root\r\n";
      },
    });
    expect(await home()).toBe("/root");
    expect(calls).toEqual([["wsl.exe", ["-d", "Ubuntu", "-e", "printenv", "HOME"]]]);
  });

  it.each(["", "not/absolute", "C:\\Users\\x", "/home/../etc"])(
    "treats the unusable HOME %j as unknown",
    async (value) => {
      const home = wslHome("Ubuntu", async () => true, { env: {}, exec: async () => value });
      expect(await home()).toBeNull();
    },
  );
});

describe("credentialPaths", () => {
  const home = "C:\\Users\\H";
  const winPath = "C:\\Users\\H\\.claude\\.credentials.json";
  const wsl = (running: boolean, wslHomeDir: () => Promise<string | null>) => ({
    distro: "Ubuntu",
    isRunning: async () => running,
    home: wslHomeDir,
  });

  it("returns only the Windows path without WSL", async () => {
    expect(await credentialPaths(home, null)).toEqual([winPath]);
  });

  it("returns only the Windows path while WSL is not running and never asks for the home", async () => {
    const lookup = vi.fn(async () => "/home/h2k");
    expect(await credentialPaths(home, wsl(false, lookup))).toEqual([winPath]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("adds the WSL path when running and the home is known", async () => {
    expect(
      await credentialPaths(
        home,
        wsl(true, async () => "/home/h2k"),
      ),
    ).toEqual([winPath, "\\\\wsl.localhost\\Ubuntu\\home\\h2k\\.claude\\.credentials.json"]);
  });

  it("returns only the Windows path when running but the home is unknown", async () => {
    expect(
      await credentialPaths(
        home,
        wsl(true, async () => null),
      ),
    ).toEqual([winPath]);
  });
});
