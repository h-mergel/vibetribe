import { describe, expect, it } from "vitest";
import {
  type ProcessOutcome,
  reasonOf,
  WSL_SETUP_SCRIPT,
  wslSetup,
  wslSetupArgs,
  wslSetupResult,
} from "../src/setup/wsl";

const REPORTER = "C:\\Users\\Jane Doe\\.vibetribe\\reporter.mjs";

describe("wslSetupArgs", () => {
  it("runs the script in the home of the given distribution with the reporter path in forward slashes", () => {
    expect(wslSetupArgs("Debian", REPORTER, "install")).toEqual([
      "-d",
      "Debian",
      "--cd",
      "~",
      "-e",
      "sh",
      "-lc",
      WSL_SETUP_SCRIPT,
      "sh",
      "C:/Users/Jane Doe/.vibetribe/reporter.mjs",
      "install",
    ]);
  });

  it("the script needs node 20 or later, removes on 'remove' and passes the Windows home of the reporter otherwise", () => {
    expect(WSL_SETUP_SCRIPT).toContain('r=$(wslpath -u "$1") || exit 3;');
    expect(WSL_SETUP_SCRIPT).toContain("command -v node >/dev/null 2>&1 || exit 127;");
    expect(WSL_SETUP_SCRIPT).toContain(
      'node -e "process.exit(parseInt(process.versions.node) < 20 ? 1 : 0)" || exit 4;',
    );
    expect(WSL_SETUP_SCRIPT).toContain(
      'if [ "$2" = remove ]; then exec node "$r" setup --uninstall; fi;',
    );
    expect(WSL_SETUP_SCRIPT).toContain(
      'exec node "$r" setup --windows-home "$(dirname "$(dirname "$r")")"',
    );
  });
});

describe("wslSetupResult", () => {
  const result = (code: number | null, stderr = "") =>
    wslSetupResult("Debian", "install", { code, stderr });

  it("names the distribution on success, for both modes", () => {
    expect(result(0)).toEqual({ ok: true, text: "Hooks installed in WSL (Debian)." });
    expect(wslSetupResult("Debian", "remove", { code: 0, stderr: "" })).toEqual({
      ok: true,
      text: "Hooks removed from WSL (Debian).",
    });
  });

  it("explains a node off the login PATH, a node too old, an unreachable reporter and a wsl.exe that did not answer", () => {
    expect(result(127).text).toBe(
      "Node.js is not on the login PATH in WSL (Debian) (~/.profile; nvm or fnm set up only in ~/.bashrc does not count). Install Node.js 20 or later there, then try again.",
    );
    expect(result(4).text).toBe(
      "Node.js in WSL (Debian) is older than 20. Install Node.js 20 or later there, then try again.",
    );
    expect(result(3).text).toBe(
      "WSL (Debian) cannot reach the Windows files. Set up Windows first.",
    );
    expect(result(null).text).toBe("wsl.exe did not answer. Is WSL (Debian) working?");
    for (const code of [127, 4, 3, null]) expect(result(code).ok).toBe(false);
  });

  it("shows the reporter's own error line, else the exit code; wsl.exe's own codes get a plain message", () => {
    expect(result(1, "\n/home/jane/.claude/settings.json is not valid JSON.\n\n")).toEqual({
      ok: false,
      text: "/home/jane/.claude/settings.json is not valid JSON.",
    });
    expect(result(1, " \n")).toEqual({ ok: false, text: "Setup in WSL (Debian) failed (exit 1)." });
    expect(result(4294967295).text).toBe(
      "wsl.exe could not run the setup in WSL (Debian) (exit 4294967295).",
    );
  });
});

describe("reasonOf", () => {
  it("skips the stack trace and Node's version footer", () => {
    const crash =
      "file:///home/jane/.vibetribe/reporter.mjs:12\nSyntaxError: Unexpected token '?'\n    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:146:18)\n    at callTranslator (node:internal/modules/esm/loader:310:14)\n\nNode.js v12.22.9\n";
    expect(reasonOf(crash)).toBe("SyntaxError: Unexpected token '?'");
  });

  it("drops NUL characters from the error output", () => {
    const utf16 = Buffer.from("There is no distribution with the supplied name.\r\n", "utf16le");
    expect(reasonOf(utf16.toString("utf8"))).toBe(
      "There is no distribution with the supplied name.",
    );
    expect(reasonOf(" \n")).toBeNull();
  });
});

describe("wslSetup", () => {
  it("runs wsl.exe once and maps its outcome", async () => {
    const calls: [string, string[]][] = [];
    const run = async (file: string, args: string[]): Promise<ProcessOutcome> => {
      calls.push([file, args]);
      return { code: 0, stderr: "" };
    };
    expect(await wslSetup("Debian", REPORTER, "remove", run)).toEqual({
      ok: true,
      text: "Hooks removed from WSL (Debian).",
    });
    expect(calls).toEqual([["wsl.exe", wslSetupArgs("Debian", REPORTER, "remove")]]);
  });
});
