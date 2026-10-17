import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/deploy.sh", import.meta.url));
const UUID = "dev.h2k.vibetribe";
const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;

/**
 * Everything happens in a scratch dir: a fake "C:\" root, a source plugin folder and shims for
 * wslpath and cmd.exe on PATH. The real %APPDATA% and Stream Deck are never involved.
 */
let root = "";
let src = "";
let plugins = "";
let dest = "";

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vt-deploy-"));
  src = join(root, "src", `${UUID}.sdPlugin`);
  write(join(src, "bin", "plugin.js"), "new-plugin");
  write(join(src, "imgs", "a.png"), "new-img");
  write(join(src, "ui", "slot.html"), "new-ui");
  write(join(src, "manifest.json"), "new-manifest");
  plugins = join(root, "fakec", "appdata", "Elgato", "StreamDeck", "Plugins");
  dest = join(plugins, `${UUID}.sdPlugin`);
  const shims = join(root, "shims");
  // maps C:\a\b to <root>/fakec/a/b
  write(
    join(shims, "wslpath"),
    `#!/bin/sh\np=$(printf '%s' "$2" | tr '\\\\' '/')\nprintf '%s\\n' "${root}/fakec/\${p#?:/}"\n`,
  );
  write(join(shims, "cmd.exe"), `#!/bin/sh\necho "$@" >> "${root}/cmd.log"\n`);
  chmodSync(join(shims, "wslpath"), 0o755);
  chmodSync(join(shims, "cmd.exe"), 0o755);
});

afterEach(() => {
  // unreadable folders from the failure tests
  spawnSync("chmod", ["-R", "u+rwx", root]);
  rmSync(root, { recursive: true, force: true });
});

const deploy = (env: Record<string, string> = {}) => {
  const res = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${join(root, "shims")}:${process.env.PATH}`,
      HOME: root,
      VIBETRIBE_DEPLOY_SRC: src,
      VIBETRIBE_DEPLOY_APPDATA_WIN: "C:\\appdata",
      ...env,
    },
  });
  return { code: res.status, out: res.stdout + res.stderr };
};
const read = (path: string): string => readFileSync(path, "utf8");
const RESTART = "Quit Stream Deck completely and start it again";

describe.skipIf(!hasBash)("deploy.sh", () => {
  it("first install: creates only the plugin folder and says to restart Stream Deck", () => {
    mkdirSync(plugins, { recursive: true });
    const { code, out } = deploy();
    expect(code).toBe(0);
    expect(read(join(dest, "bin", "plugin.js"))).toBe("new-plugin");
    expect(read(join(dest, "imgs", "a.png"))).toBe("new-img");
    expect(read(join(dest, "ui", "slot.html"))).toBe("new-ui");
    expect(read(join(dest, "manifest.json"))).toBe("new-manifest");
    expect(out).toContain(RESTART);
    expect(readdirSync(plugins)).toEqual([`${UUID}.sdPlugin`]); // no .new / .old left behind
  });

  it("second deploy replaces the files, drops stale ones and keeps logs/", () => {
    mkdirSync(plugins, { recursive: true });
    write(join(dest, "bin", "plugin.js"), "old-plugin");
    write(join(dest, "bin", "stale.js"), "stale");
    write(join(dest, "imgs", "gone.png"), "gone");
    write(join(dest, "manifest.json"), "old-manifest");
    write(join(dest, "logs", "sdk.log"), "keep me");
    const { code, out } = deploy();
    expect(code).toBe(0);
    expect(read(join(dest, "bin", "plugin.js"))).toBe("new-plugin");
    expect(existsSync(join(dest, "bin", "stale.js"))).toBe(false);
    expect(existsSync(join(dest, "imgs", "gone.png"))).toBe(false);
    expect(read(join(dest, "manifest.json"))).toBe("new-manifest");
    expect(read(join(dest, "logs", "sdk.log"))).toBe("keep me");
    // the restart link only works in developer mode: the app must be restarted by hand
    expect(out).toContain(RESTART);
    expect(existsSync(join(root, "cmd.log"))).toBe(false);
    expect(readdirSync(plugins)).toEqual([`${UUID}.sdPlugin`]);
  });

  it.skipIf(process.getuid?.() === 0)("a failing copy leaves the previous version intact", () => {
    mkdirSync(plugins, { recursive: true });
    write(join(dest, "bin", "plugin.js"), "old-plugin");
    write(join(dest, "imgs", "old.png"), "old-img");
    write(join(dest, "manifest.json"), "old-manifest");
    write(join(dest, "logs", "sdk.log"), "keep me");
    chmodSync(join(src, "imgs", "a.png"), 0o000); // cp cannot read it
    const { code, out } = deploy();
    expect(code).not.toBe(0);
    expect(out).toContain("installed plugin was not changed");
    expect(read(join(dest, "bin", "plugin.js"))).toBe("old-plugin");
    expect(read(join(dest, "imgs", "old.png"))).toBe("old-img");
    expect(read(join(dest, "manifest.json"))).toBe("old-manifest");
    expect(read(join(dest, "logs", "sdk.log"))).toBe("keep me");
    expect(readdirSync(plugins)).toEqual([`${UUID}.sdPlugin`]); // staging cleaned up
  });

  it.skipIf(process.getuid?.() === 0)("a failing swap puts the previous version back", () => {
    mkdirSync(plugins, { recursive: true });
    write(join(dest, "bin", "plugin.js"), "old-plugin");
    write(join(dest, "imgs", "old.png"), "old-img");
    write(join(dest, "manifest.json"), "old-manifest");
    chmodSync(dest, 0o555); // renames inside the plugin folder fail
    const { code, out } = deploy();
    chmodSync(dest, 0o755);
    expect(code).not.toBe(0);
    expect(out).toContain("previous version");
    expect(read(join(dest, "bin", "plugin.js"))).toBe("old-plugin");
    expect(read(join(dest, "imgs", "old.png"))).toBe("old-img");
    expect(read(join(dest, "manifest.json"))).toBe("old-manifest");
  });

  it("keeps the previous files when putting them back fails", () => {
    mkdirSync(plugins, { recursive: true });
    write(join(dest, "bin", "plugin.js"), "old-plugin");
    write(join(dest, "imgs", "old.png"), "old-img");
    write(join(dest, "manifest.json"), "old-manifest");
    // shim: moving the new manifest in fails (the swap breaks) and so does every move out of .old (the restore breaks)
    write(
      join(root, "shims", "mv"),
      `#!/bin/sh
case "$1" in *.old/*|*.new/manifest.json) exit 1;; esac
exec /bin/mv "$@"
`,
    );
    chmodSync(join(root, "shims", "mv"), 0o755);
    const { code, out } = deploy();
    expect(code).not.toBe(0);
    const old = `${dest}.old`;
    expect(out).toContain(`kept in ${old}`);
    expect(read(join(old, "bin", "plugin.js"))).toBe("old-plugin");
    expect(read(join(old, "manifest.json"))).toBe("old-manifest");
    expect(existsSync(`${dest}.new`)).toBe(false);
  });

  it("a failing first install says nothing was installed and leaves no plugin folder", () => {
    mkdirSync(plugins, { recursive: true });
    write(
      join(root, "shims", "mv"),
      `#!/bin/sh
case "$1" in *.new/manifest.json) exit 1;; esac
exec /bin/mv "$@"
`,
    );
    chmodSync(join(root, "shims", "mv"), 0o755);
    const { code, out } = deploy();
    expect(code).not.toBe(0);
    expect(out).toContain("nothing was installed");
    expect(out).not.toContain("previous version");
    expect(readdirSync(plugins)).toEqual([]);
  });

  it("never deletes previous files an earlier deploy left in .old", () => {
    mkdirSync(plugins, { recursive: true });
    write(join(dest, "manifest.json"), "half-new");
    write(join(`${dest}.old`, "manifest.json"), "only copy of the old manifest");
    const { code, out } = deploy();
    expect(code).toBe(1);
    expect(out).toContain("an earlier deploy left files in");
    expect(read(join(`${dest}.old`, "manifest.json"))).toBe("only copy of the old manifest");
    expect(read(join(dest, "manifest.json"))).toBe("half-new");
  });

  it("a run killed during the swap keeps the previous files in .old", () => {
    mkdirSync(plugins, { recursive: true });
    write(join(dest, "bin", "plugin.js"), "old-plugin");
    write(join(dest, "imgs", "old.png"), "old-img");
    write(join(dest, "manifest.json"), "old-manifest");
    // shim: the deploy is killed while the new manifest moves in (old files are in .old by then)
    write(
      join(root, "shims", "mv"),
      `#!/bin/sh
case "$1" in *.new/manifest.json) kill -TERM $PPID; exit 1;; esac
exec /bin/mv "$@"
`,
    );
    chmodSync(join(root, "shims", "mv"), 0o755);
    const { code } = deploy();
    expect(code).not.toBe(0);
    expect(read(join(`${dest}.old`, "manifest.json"))).toBe("old-manifest");
  });

  it("refuses when Stream Deck is not installed and creates nothing", () => {
    const { code, out } = deploy();
    expect(code).toBe(1);
    expect(out).toContain("Stream Deck not installed?");
    expect(existsSync(join(root, "fakec", "appdata"))).toBe(false);
  });

  it.each([
    ["relative", "appdata"],
    ["unexpanded variable", "%APPDATA%"],
    ["unix path", "/mnt/c/appdata"],
    ["UNC path", "\\\\server\\share"],
    ["multi-line", "C:\\appdata\nC:\\other"],
    ["parent segment", "C:\\appdata\\..\\x"],
  ])("rejects an invalid APPDATA (%s)", (_name, value) => {
    mkdirSync(plugins, { recursive: true });
    const { code, out } = deploy({ VIBETRIBE_DEPLOY_APPDATA_WIN: value });
    expect(code).toBe(1);
    expect(out).toMatch(/APPDATA/);
    expect(existsSync(dest)).toBe(false);
  });

  it.each([
    ["bin/plugin.js", join("bin", "plugin.js")],
    ["imgs", "imgs"],
    ["ui", "ui"],
    ["manifest.json", "manifest.json"],
  ])("refuses when %s is missing in the source", (name, rel) => {
    mkdirSync(plugins, { recursive: true });
    rmSync(join(src, rel), { recursive: true });
    const { code, out } = deploy();
    expect(code).toBe(1);
    expect(out).toContain(name);
    expect(existsSync(dest)).toBe(false);
  });

  it("without cmd.exe (and no override) says so instead of failing silently", () => {
    // a PATH without the Windows entries WSL appends: no cmd.exe
    const res = spawnSync("bash", [script], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: root, VIBETRIBE_DEPLOY_SRC: src },
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/cmd\.exe not found/);
  });
});
