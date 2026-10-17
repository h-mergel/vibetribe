import { describe, expect, it } from "vitest";
import { detectGitBash, detectWindowsHome, type Exec, isWsl } from "../src/setup/detect";

const throwing: Exec = () => {
  throw new Error("boom");
};

describe("detectGitBash", () => {
  const exists = (known: string[]) => (p: string) => known.includes(p);

  it("derives bash.exe from the first git.exe whose bin\\bash.exe exists", () => {
    const exec: Exec = (file, args) => {
      expect([file, args]).toEqual(["where.exe", ["git"]]);
      return "C:\\odd\\mingw64\\bin\\git.exe\r\nC:\\dev\\Git\\cmd\\git.exe\r\n";
    };
    const bash = detectGitBash({
      platform: "win32",
      env: {},
      exists: exists(["C:\\dev\\Git\\bin\\bash.exe"]),
      exec,
    });
    expect(bash).toBe("C:\\dev\\Git\\bin\\bash.exe");
  });

  it("prefers CLAUDE_CODE_GIT_BASH_PATH when it exists", () => {
    const bash = detectGitBash({
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: "D:\\bash.exe" },
      exists: exists(["D:\\bash.exe"]),
      exec: throwing,
    });
    expect(bash).toBe("D:\\bash.exe");
  });

  it("ignores CLAUDE_CODE_GIT_BASH_PATH when it does not exist", () => {
    const bash = detectGitBash({
      platform: "win32",
      env: { CLAUDE_CODE_GIT_BASH_PATH: "D:\\gone.exe" },
      exists: exists([]),
      exec: () => "C:\\dev\\Git\\cmd\\git.exe",
    });
    expect(bash).toBeNull();
  });

  it("returns null when where.exe fails, finds nothing or the platform is not Windows", () => {
    const base = { env: {}, exists: exists(["C:\\dev\\Git\\bin\\bash.exe"]) };
    expect(detectGitBash({ ...base, platform: "win32", exec: throwing })).toBeNull();
    expect(detectGitBash({ ...base, platform: "win32", exec: () => "" })).toBeNull();
    expect(
      detectGitBash({ ...base, platform: "linux", exec: () => "C:\\dev\\Git\\cmd\\git.exe" }),
    ).toBeNull();
  });
});

describe("detectWindowsHome", () => {
  const env = { WSL_DISTRO_NAME: "Ubuntu" };

  it("trims cmd.exe and wslpath output", () => {
    const calls: string[] = [];
    const exec: Exec = (file, args) => {
      calls.push(file);
      if (file === "cmd.exe") return "C:\\Users\\Heinrich\r\n";
      expect(args).toEqual(["-u", "C:\\Users\\Heinrich"]);
      return "/mnt/c/Users/Heinrich\n";
    };
    expect(detectWindowsHome({ platform: "linux", env, exec })).toBe("/mnt/c/Users/Heinrich");
    expect(calls).toEqual(["cmd.exe", "wslpath"]);
  });

  it("returns null on failure, empty or unexpanded output, or outside WSL", () => {
    expect(detectWindowsHome({ platform: "linux", env, exec: throwing })).toBeNull();
    expect(detectWindowsHome({ platform: "linux", env, exec: () => "\r\n" })).toBeNull();
    expect(
      detectWindowsHome({ platform: "linux", env, exec: () => "%USERPROFILE%\r\n" }),
    ).toBeNull();
    expect(
      detectWindowsHome({ platform: "linux", env: {}, exec: () => "C:\\Users\\x" }),
    ).toBeNull();
    expect(detectWindowsHome({ platform: "win32", env, exec: () => "C:\\Users\\x" })).toBeNull();
  });
});

describe("isWsl", () => {
  it("is true only with WSL_DISTRO_NAME, which the hooks need to report (e.g. not under sudo)", () => {
    expect(isWsl({ WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
    expect(isWsl({})).toBe(false);
    expect(isWsl({ WSL_DISTRO_NAME: "" })).toBe(false);
  });
});
