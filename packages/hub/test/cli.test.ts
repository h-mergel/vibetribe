import { describe, expect, it } from "vitest";
import { pickClaudeExe, refreshEnv } from "../src/usage/cli";

describe("pickClaudeExe", () => {
  it("prefers the first .exe from where.exe output", () => {
    expect(
      pickClaudeExe(
        "C:\\Users\\H\\AppData\\Roaming\\npm\\claude.cmd\r\nC:\\Users\\H\\.local\\bin\\claude.exe\r\n",
      ),
    ).toBe("C:\\Users\\H\\.local\\bin\\claude.exe");
  });

  it("returns null when only shims or nothing is found", () => {
    expect(pickClaudeExe("C:\\npm\\claude.cmd\r\n")).toBeNull();
    expect(pickClaudeExe("")).toBeNull();
  });
});

describe("refreshEnv", () => {
  it("removes API keys and token overrides so the CLI uses its own login", () => {
    const env = refreshEnv({
      PATH: "p",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_AUTH_TOKEN: "t",
      CLAUDE_CODE_OAUTH_TOKEN: "o",
    });
    expect(env).toEqual({ PATH: "p" });
  });
});
