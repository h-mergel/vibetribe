import { describe, expect, it } from "vitest";
import {
  applyHooks,
  applyStatusline,
  HOOK_EVENTS,
  type ReporterCommand,
  removeHooks,
  removeStatusline,
  SettingsShapeError,
  statuslineCommand,
} from "../src/setup/settings";

const CMD: ReporterCommand = {
  node: "C:/Program Files/nodejs/node.exe",
  reporter: "C:/Users/H/.vibetribe/reporter.mjs",
};
const FOREIGN = { matcher: "Bash", hooks: [{ type: "command", command: "python3 check.py" }] };
const FOREIGN_ENTRY = { type: "command", command: "python3 check.py" };
const OURS_ENTRY = {
  type: "command",
  command: CMD.node,
  args: [CMD.reporter, "hook"],
  timeout: 2,
  async: true,
};
const LATER = { matcher: "Edit", hooks: [{ type: "command", command: "later.sh" }] };

type Hooks = Record<string, unknown[]>;
const hooksOf = (s: Record<string, unknown>): Hooks => s.hooks as Hooks;

describe("applyHooks", () => {
  it("adds one exec-form group per event, async except SessionEnd", () => {
    const s = applyHooks({}, CMD);
    const hooks = s.hooks as Record<string, { hooks: Record<string, unknown>[] }[]>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(hooks.Stop?.[0]?.hooks[0]).toEqual({
      type: "command",
      command: "C:/Program Files/nodejs/node.exe",
      args: ["C:/Users/H/.vibetribe/reporter.mjs", "hook"],
      timeout: 2,
      async: true,
    });
    expect(hooks.SessionEnd?.[0]?.hooks[0]).not.toHaveProperty("async");
  });

  it("keeps foreign hooks and other settings, and is idempotent", () => {
    const before = { model: "opus", hooks: { PreToolUse: [FOREIGN] } };
    const once = applyHooks(before, CMD);
    const twice = applyHooks(once, CMD);
    expect(twice).toEqual(once);
    expect(once.model).toBe("opus");
    expect((once.hooks as Record<string, unknown[]>).PreToolUse?.[0]).toEqual(FOREIGN);
    expect((once.hooks as Record<string, unknown[]>).PreToolUse).toHaveLength(2);
  });

  it("does not mutate its input", () => {
    const before = { hooks: { PreToolUse: [FOREIGN] } };
    const copy = structuredClone(before);
    applyHooks(before, CMD);
    expect(before).toEqual(copy);
  });

  it("keeps a foreign entry in a shared group and adds ours once", () => {
    const shared = { matcher: "Bash", hooks: [FOREIGN_ENTRY, OURS_ENTRY] };
    const installed = applyHooks({ hooks: { PreToolUse: [shared] } }, CMD);
    expect(hooksOf(installed).PreToolUse).toContainEqual({
      matcher: "Bash",
      hooks: [FOREIGN_ENTRY],
    });
    expect(hooksOf(installed).PreToolUse).toEqual([
      { hooks: [OURS_ENTRY] },
      { matcher: "Bash", hooks: [FOREIGN_ENTRY] },
    ]);
    expect(applyHooks(installed, CMD)).toEqual(installed);
  });

  it.each([
    ["grep-style entry", { command: "grep", args: ["-r", ".vibetribe/reporter.mjs"] }],
    [
      "args[0] with .bak suffix",
      { type: "command", command: "x", args: ["/x/.vibetribe/reporter.mjs.bak"] },
    ],
  ])("keeps a false-positive %s", (_name, entry) => {
    const group = { hooks: [entry] };
    const installed = applyHooks({ hooks: { PreToolUse: [group] } }, CMD);
    expect(hooksOf(installed).PreToolUse).toContainEqual(group);
    expect(hooksOf(installed).PreToolUse).toHaveLength(2);
  });

  it("keeps a group whose matcher mentions the reporter path", () => {
    const group = { matcher: ".vibetribe/reporter.mjs", hooks: [FOREIGN_ENTRY] };
    const installed = applyHooks({ hooks: { PreToolUse: [group] } }, CMD);
    expect(hooksOf(installed).PreToolUse).toContainEqual(group);
    expect(hooksOf(installed).PreToolUse).toHaveLength(2);
  });

  it.each([
    [
      "backslashes",
      {
        type: "command",
        command: "node",
        args: ["C:\\Users\\H\\.vibetribe\\reporter.mjs", "hook"],
      },
    ],
    ["mixed case", { type: "command", command: "node", args: [".VibeTribe/Reporter.mjs", "hook"] }],
  ])("recognises our entry written as %s, so apply does not duplicate it", (_name, entry) => {
    const legacy = { hooks: [entry] };
    const installed = applyHooks({ hooks: { PreToolUse: [legacy] } }, CMD);
    expect(hooksOf(installed).PreToolUse).toEqual([{ hooks: [OURS_ENTRY] }]);
  });

  it("re-applying keeps our group in place before a later group", () => {
    const first = applyHooks({}, CMD);
    const ours = hooksOf(first).PreToolUse?.[0];
    const s = { hooks: { PreToolUse: [ours, LATER] } };
    const once = applyHooks(s, CMD);
    expect(hooksOf(once).PreToolUse).toEqual([ours, LATER]);
    expect(applyHooks(once, CMD)).toEqual(once);
  });

  it("places ours at the position of the first group that held ours", () => {
    const ours = hooksOf(applyHooks({}, CMD)).PreToolUse?.[0];
    const s = { hooks: { PreToolUse: [FOREIGN, ours, LATER] } };
    const once = applyHooks(s, CMD);
    expect(hooksOf(once).PreToolUse).toEqual([FOREIGN, ours, LATER]);
    expect(applyHooks(once, CMD)).toEqual(once);
  });

  it("stays identical on re-apply when a foreign group was added after ours", () => {
    const once = applyHooks({}, CMD);
    const withLater = {
      ...once,
      hooks: { ...hooksOf(once), PreToolUse: [...hooksOf(once).PreToolUse, LATER] },
    };
    const again = applyHooks(withLater, CMD);
    expect(again).toEqual(withLater);
    expect(applyHooks(again, CMD)).toEqual(again);
  });

  it.each([[["keep"]], ["keep"], [{ PreToolUse: "bar" }]])(
    "throws SettingsShapeError for hooks %j",
    (hooks) => {
      expect(() => applyHooks({ hooks }, CMD)).toThrow(SettingsShapeError);
    },
  );

  it("keeps an unknown event untouched whatever its shape", () => {
    const installed = applyHooks({ hooks: { Foo: "bar" } }, CMD);
    expect(hooksOf(installed).Foo).toBe("bar");
  });

  it.each([
    [
      "statusline-role command in a Stop group",
      { command: '"C:/n/node.exe" "C:/Users/H/.vibetribe/reporter.mjs" statusline' },
    ],
    ["hookfile suffix", { command: "node /x/.vibetribe/reporter.mjs hookfile" }],
    ["missing boundary before the marker", { command: "node /x/my.vibetribe/reporter.mjs hook" }],
  ])("keeps a foreign %s entry, which is not our hook", (_name, entry) => {
    const group = { hooks: [entry] };
    const installed = applyHooks({ hooks: { Stop: [group] } }, CMD);
    expect(hooksOf(installed).Stop).toEqual([group, hooksOf(applyHooks({}, CMD)).Stop?.[0]]);
    expect(removeHooks(installed)).toEqual({ hooks: { Stop: [group] } });
  });

  it("keeps a bare entry that holds the marker outside any hooks array", () => {
    const bare = { command: "node", args: ["/x/.vibetribe/reporter.mjs", "hook"] };
    const installed = applyHooks({ hooks: { PreToolUse: [bare] } }, CMD);
    expect(hooksOf(installed).PreToolUse).toEqual([
      bare,
      hooksOf(applyHooks({}, CMD)).PreToolUse?.[0],
    ]);
    expect(removeHooks(installed)).toEqual({ hooks: { PreToolUse: [bare] } });
  });

  it("keeps an own __proto__ key when applying", () => {
    const parsed = JSON.parse('{"hooks":{"__proto__":[{"hooks":[]}],"Stop":[]}}');
    const text = JSON.stringify(applyHooks(parsed, CMD));
    expect(Object.keys(JSON.parse(text).hooks)).toContain("__proto__");
    expect(text).toContain('"__proto__":[{"hooks":[]}]');
  });
});

describe("removeHooks", () => {
  it("removes only VibeTribe groups and drops empty arrays and an empty hooks object", () => {
    const installed = applyHooks({ hooks: { PreToolUse: [FOREIGN] } }, CMD);
    expect(removeHooks(installed)).toEqual({ hooks: { PreToolUse: [FOREIGN] } });
    expect(removeHooks(applyHooks({}, CMD))).toEqual({});
  });

  it("removes only our entry from a shared group and leaves that group", () => {
    const shared = { matcher: "Bash", hooks: [FOREIGN_ENTRY, OURS_ENTRY] };
    expect(removeHooks({ hooks: { PreToolUse: [shared] } })).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [FOREIGN_ENTRY] }] },
    });
  });

  it("keeps false-positive entries", () => {
    const group = { hooks: [{ command: "grep", args: ["-r", ".vibetribe/reporter.mjs"] }] };
    const s = { hooks: { PreToolUse: [group] } };
    expect(removeHooks(s)).toEqual(s);
  });

  it("keeps a group without a hooks array", () => {
    const s = { hooks: { PreToolUse: [{ matcher: "X" }] } };
    expect(removeHooks(s)).toEqual(s);
  });

  it("returns an equal object when nothing of ours is present", () => {
    expect(removeHooks({ hooks: { PreToolUse: [] } })).toEqual({ hooks: { PreToolUse: [] } });
  });

  it.each([[["keep"]], ["keep"], [{ PreToolUse: "bar" }]])(
    "returns hooks %j unchanged",
    (hooks) => {
      const s = { hooks };
      expect(removeHooks(s)).toEqual(s);
    },
  );

  it("removes ours from a mixed hooks object and keeps every foreign key", () => {
    const oursGroup = { hooks: [OURS_ENTRY] };
    const s = {
      hooks: {
        Stop: [oursGroup],
        Bar: "x",
        Baz: [],
        Q: [{ hooks: [] }],
        PreToolUse: [oursGroup],
      },
    };
    expect(removeHooks(s)).toEqual({ hooks: { Bar: "x", Baz: [], Q: [{ hooks: [] }] } });
  });

  it("keeps a pre-existing empty hooks object next to an ours-only statusline", () => {
    const s = { hooks: {}, statusLine: { type: "command", command: statuslineCommand(CMD) } };
    expect(removeHooks(s)).toEqual(s);
    expect(removeStatusline(removeHooks(s), null)).toEqual({ hooks: {} });
  });

  it("pins that apply then remove on an empty hooks object leaves no hooks key", () => {
    expect(removeHooks(applyHooks({ hooks: {} }, CMD))).toEqual({});
  });

  it("keeps an own __proto__ key when removing", () => {
    const text = `{"hooks":{"__proto__":[{"hooks":[]}],"Stop":[{"hooks":[{"type":"command","command":"node","args":["C:/Users/H/.vibetribe/reporter.mjs","hook"],"timeout":2,"async":true}]}]}}`;
    expect(JSON.stringify(removeHooks(JSON.parse(text)))).toBe(
      '{"hooks":{"__proto__":[{"hooks":[]}]}}',
    );
  });
});

describe("end-to-end", () => {
  it("restores a realistic settings.json exactly after apply, JSON round trip and remove", () => {
    const text = `{
  "model": "opus",
  "permissions": { "allow": ["Bash(npm test)"] },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "python3 check.py" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "notify.sh" }] }]
  },
  "statusLine": { "type": "command", "command": "ccusage statusline", "padding": 2 }
}`;
    const original = JSON.parse(text);
    const { settings, previous } = applyStatusline(applyHooks(JSON.parse(text), CMD), CMD);
    const reread = JSON.parse(JSON.stringify(settings));
    expect(removeHooks(removeStatusline(reread, previous))).toEqual(original);
  });
});

describe("statusline", () => {
  it("quotes paths with spaces", () => {
    expect(statuslineCommand(CMD)).toBe(
      '"C:/Program Files/nodejs/node.exe" "C:/Users/H/.vibetribe/reporter.mjs" statusline',
    );
  });

  it("wraps an existing statusline, keeping padding and refreshInterval", () => {
    const before = {
      statusLine: {
        type: "command",
        command: "ccusage statusline",
        padding: 0,
        refreshInterval: 10,
      },
    };
    const { settings, previous } = applyStatusline(before, CMD);
    expect(previous).toEqual({ command: "ccusage statusline", padding: 0, refreshInterval: 10 });
    expect(settings.statusLine).toEqual({
      type: "command",
      command: statuslineCommand(CMD),
      padding: 0,
      refreshInterval: 10,
    });
  });

  it("reports no new previous when the statusline is already ours", () => {
    const once = applyStatusline({ statusLine: { type: "command", command: "x" } }, CMD).settings;
    const again = applyStatusline(once, CMD);
    expect(again.previous).toBeNull();
    expect(again.settings).toEqual(once);
  });

  it("installs without a previous statusline", () => {
    expect(applyStatusline({}, CMD)).toEqual({
      settings: { statusLine: { type: "command", command: statuslineCommand(CMD) } },
      previous: null,
    });
  });

  it("restores the previous statusline on removal, or deletes ours", () => {
    const prev = { command: "ccusage statusline", padding: 0 };
    const installed = applyStatusline({ statusLine: { type: "command", ...prev } }, CMD).settings;
    expect(removeStatusline(installed, prev)).toEqual({
      statusLine: { type: "command", command: "ccusage statusline", padding: 0 },
    });
    expect(removeStatusline(applyStatusline({}, CMD).settings, null)).toEqual({});
  });

  it("never writes the recorded shell back into settings.json", () => {
    const installed = applyStatusline(
      { statusLine: { type: "command", command: "x", padding: 1, refreshInterval: 5 } },
      CMD,
    ).settings;
    const previous = { command: "x", padding: 1, refreshInterval: 5, shell: "C:/Git/bin/bash.exe" };
    expect(removeStatusline(installed, previous)).toEqual({
      statusLine: { type: "command", command: "x", padding: 1, refreshInterval: 5 },
    });
  });

  it("leaves a foreign statusline alone on removal", () => {
    const foreign = { statusLine: { type: "command", command: "other" } };
    expect(removeStatusline(foreign, null)).toEqual(foreign);
  });

  it.each([["ccusage"], [["a"]], [{ command: 5 }], [null]])(
    "throws SettingsShapeError for statusLine %j",
    (statusLine) => {
      expect(() => applyStatusline({ statusLine }, CMD)).toThrow(SettingsShapeError);
    },
  );

  it("re-applying over our statusline keeps padding and refreshInterval and reports no previous", () => {
    const old = {
      statusLine: {
        type: "command",
        command: '"C:/old/node.exe" "C:/old/.vibetribe/reporter.mjs" statusline',
        padding: 2,
        refreshInterval: 7,
      },
    };
    const { settings, previous } = applyStatusline(old, CMD);
    expect(previous).toBeNull();
    expect(settings.statusLine).toEqual({
      type: "command",
      command: statuslineCommand(CMD),
      padding: 2,
      refreshInterval: 7,
    });
  });

  it("displaces a foreign statusline whose marker has no statusline role", () => {
    const command = "ccusage --config /tmp/.vibetribe/reporter.mjs";
    const foreign = { statusLine: { type: "command", command } };
    expect(applyStatusline(foreign, CMD).previous).toEqual({ command });
    expect(removeStatusline(foreign, null)).toEqual(foreign);
  });

  it("recognises our statusline written with backslashes and mixed case", () => {
    const command = '"C:\\n\\node.exe" "C:\\Users\\H\\.VibeTribe\\Reporter.mjs" statusline';
    const ours = { statusLine: { type: "command", command } };
    expect(applyStatusline(ours, CMD).previous).toBeNull();
    expect(removeStatusline(ours, null)).toEqual({});
  });

  it("round-trips a foreign statusline through apply and remove", () => {
    const foreign = {
      statusLine: {
        type: "command",
        command: "ccusage statusline",
        padding: 0,
        refreshInterval: 10,
      },
    };
    const { settings, previous } = applyStatusline(foreign, CMD);
    expect(removeStatusline(settings, previous)).toEqual({
      statusLine: {
        type: "command",
        command: "ccusage statusline",
        padding: 0,
        refreshInterval: 10,
      },
    });
  });
});
