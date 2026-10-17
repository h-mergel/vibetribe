import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changed, ok, skipped } from "@vibetribe/hub";
import { describe, expect, it } from "vitest";
import { checkPluginFolder, checkWindowsSessions, sessionFiles } from "../scripts/windows-side";

describe("checkPluginFolder", () => {
  it("looks for the deployed manifest under %APPDATA%\\Elgato\\StreamDeck\\Plugins", () => {
    const asked: string[] = [];
    const exists = (path: string) => {
      asked.push(path);
      return true;
    };
    expect(checkPluginFolder("/r", exists)).toEqual(ok("stream deck plugin", "installed"));
    expect(asked).toEqual([
      join("/r", "Elgato", "StreamDeck", "Plugins", "dev.h2k.vibetribe.sdPlugin", "manifest.json"),
    ]);
    expect(checkPluginFolder("/r", () => false)).toEqual(
      changed("stream deck plugin", "no manifest.json in Plugins\\dev.h2k.vibetribe.sdPlugin"),
    );
  });
});

describe("checkWindowsSessions", () => {
  it("skips only this check, without error text, when the process list is unavailable", async () => {
    const failing = async (): Promise<Map<number, number>> => {
      throw new Error("powershell.exe ProcessId=4242 stderr");
    };
    const files = [{ name: "4242.json", text: "{}" }];
    expect(await checkWindowsSessions(files, failing)).toEqual(
      skipped("session files (Windows)", "process list unavailable"),
    );
  });
});

describe("sessionFiles", () => {
  it("skips files that cannot be stat'ed and keeps those written since", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sessions-"));
    try {
      writeFileSync(join(dir, "1.json"), "a");
      writeFileSync(join(dir, "2.json"), "b");
      writeFileSync(join(dir, "3.txt"), "c");
      const mtime = (path: string): number => {
        if (path.endsWith("2.json")) throw new Error("EACCES");
        return path.endsWith("1.json") ? 1_000 : Date.now();
      };
      expect(await sessionFiles(dir, 500, mtime)).toEqual([{ name: "1.json", text: "a" }]);
      expect(await sessionFiles(dir, 5_000, mtime)).toEqual([]);
      expect((await sessionFiles(dir)).map((e) => e.name).sort()).toEqual(["1.json", "2.json"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
