import { describe, expect, it } from "vitest";
import { applyHooks } from "../src/setup/settings";
import { stateOfFiles } from "../src/setup/state";

const SOURCE = "reporter";
const ours = JSON.stringify(
  applyHooks(
    { statusLine: { type: "command", command: "node /h/.vibetribe/reporter.mjs statusline" } },
    { node: "/usr/bin/node", reporter: "/h/.vibetribe/reporter.mjs" },
  ),
);
const yes = () => true;

describe("stateOfFiles", () => {
  it("is installed when the hooks are ours, the copy is current and the nodes exist", () => {
    expect(stateOfFiles(ours, SOURCE, SOURCE, yes)).toBe("installed");
  });

  it("is outdated for another copy, no copy or a node that is gone", () => {
    expect(stateOfFiles(ours, "old", SOURCE, yes)).toBe("outdated");
    expect(stateOfFiles(ours, null, SOURCE, yes)).toBe("outdated");
    expect(stateOfFiles(ours, SOURCE, SOURCE, () => false)).toBe("outdated");
  });

  it("reads settings with a byte order mark like the setup does", () => {
    expect(stateOfFiles(`\ufeff${ours}`, SOURCE, SOURCE, yes)).toBe("installed");
  });

  it.each([
    ["no file", null],
    ["an empty file", ""],
    ["invalid JSON", "{"],
    ["no hooks of ours", "{}"],
  ])("is missing with %s", (_name, settings) => {
    expect(stateOfFiles(settings, SOURCE, SOURCE, yes)).toBe("missing");
  });
});
