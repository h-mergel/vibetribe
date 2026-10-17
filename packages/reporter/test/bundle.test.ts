import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const bundle = join(pkg, "dist", "reporter.mjs");
/** Set in beforeAll: a copy of the bundle in a directory of its own, so only node: built-ins resolve. */
let bundleFile = "";
let server: Server | null = null;

/** Asynchronous like run(): the fake hub of a test lives in this process and must keep answering. */
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    const b = spawn(process.execPath, ["build.mjs"], { cwd: pkg });
    let stderr = "";
    b.stderr.setEncoding("utf8").on("data", (c: string) => {
      stderr += c;
    });
    b.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
  const dir = mkdtempSync(join(tmpdir(), "vt-bundle-"));
  bundleFile = join(dir, "reporter.mjs");
  copyFileSync(bundle, bundleFile);
});
afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler);
  server = s;
  return new Promise((resolve) =>
    s.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    ),
  );
}

/** Fake home with a config pointing at hubUrl and a token file. */
function home(hubUrl: string): string {
  const h = mkdtempSync(join(tmpdir(), "vt-home-"));
  mkdirSync(join(h, ".vibetribe"));
  writeFileSync(join(h, ".vibetribe", "token"), "tok\n");
  writeFileSync(
    join(h, ".vibetribe", "config.json"),
    JSON.stringify({ hubUrl, tokenPath: join(h, ".vibetribe", "token") }),
  );
  return h;
}

/** Fake home whose config runs `command` as the previous statusline; the hub is unreachable. */
function homeWithPrevious(command: string): string {
  const h = home("http://127.0.0.1:1");
  writeFileSync(
    join(h, ".vibetribe", "config.json"),
    JSON.stringify({ hubUrl: "http://127.0.0.1:1", previousStatusline: { command } }),
  );
  return h;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/**
 * Spawns the bundle asynchronously: spawnSync would block the event loop and the fake hub could
 * never answer. `input: null` leaves stdin open and writes nothing.
 */
function run(
  role: string,
  h: string,
  input: string | null,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<Run> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bundleFile, role, ...args], {
      env: {
        ...process.env,
        HOME: h,
        USERPROFILE: h,
        WSL_DISTRO_NAME: "Ubuntu",
        CLAUDE_PID: "42",
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ status, stdout, stderr, ms: Date.now() - t0 });
    };
    child.stdin.on("error", () => {
      /* the reporter may exit before reading its stdin */
    });
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      stderr += c;
    });
    child.on("close", (status) => finish(status));
    // A lingering grandchild can hold stdout open after the reporter has exited, so 'close' may
    // never come. Take the exit status and give the remaining output a moment to arrive.
    child.on("exit", (status) => setTimeout(() => finish(status), 200));
    if (input !== null) child.stdin.end(input);
  });
}

describe("reporter bundle", () => {
  it("hook role delivers the envelope, prints nothing and exits 0", async () => {
    const bodies: string[] = [];
    const url = await listen((req, res) => {
      let b = "";
      req.on("data", (c) => {
        b += c;
      });
      req.on("end", () => {
        bodies.push(b);
        res.writeHead(202).end();
      });
    });
    const r = await run(
      "hook",
      home(url),
      JSON.stringify({ session_id: "s", hook_event_name: "Stop", cwd: "/p" }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const body = JSON.parse(bodies[0] ?? "{}");
    expect(body).toMatchObject({
      kind: "hook",
      session: { id: "s", pid: 42 },
      event: { name: "Stop" },
    });
  });

  it("hook role posts to the port in the hub's port file when config.json names no hub", async () => {
    let received = 0;
    const url = await listen((req, res) => {
      req.resume();
      req.on("end", () => {
        received++;
        res.writeHead(202).end();
      });
    });
    const h = home(url);
    writeFileSync(
      join(h, ".vibetribe", "config.json"),
      JSON.stringify({ tokenPath: join(h, ".vibetribe", "token") }),
    );
    writeFileSync(join(h, ".vibetribe", "port"), new URL(url).port);
    const r = await run(
      "hook",
      h,
      JSON.stringify({ session_id: "s", hook_event_name: "Stop", cwd: "/p" }),
    );
    expect(r.status).toBe(0);
    expect(received).toBe(1);
  });

  it.each([
    ["garbage stdin", "{oops"],
    ["empty stdin", ""],
  ])("hook role exits 0 silently for %s", async (_n, input) => {
    const r = await run("hook", home("http://127.0.0.1:1"), input);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("hook role exits 0 silently with a valid payload and a dead hub", async () => {
    const r = await run(
      "hook",
      home("http://127.0.0.1:1"),
      JSON.stringify({ session_id: "s", hook_event_name: "Stop", cwd: "/p" }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("hook role exits 0 within 2.5 s and silently when the hub hangs", async () => {
    const url = await listen(() => {
      /* never answer */
    });
    const r = await run(
      "hook",
      home(url),
      JSON.stringify({ session_id: "s", hook_event_name: "Stop" }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.ms).toBeLessThan(2_500);
  });

  it("hook role stops waiting for a stdin that stays open", async () => {
    const r = await run("hook", home("http://127.0.0.1:1"), null);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.ms).toBeGreaterThanOrEqual(900);
    expect(r.ms).toBeLessThan(4_000);
  }, 10_000);

  it("statusline role prints the previous statusline output", async () => {
    const h = homeWithPrevious(`node -e "process.stdout.write('PREV')"`);
    const r = await run("statusline", h, JSON.stringify({ session_id: "s" }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("PREV");
  });

  it("statusline role survives a previous command that ignores stdin", async () => {
    const r = await run(
      "statusline",
      homeWithPrevious("echo hi"),
      JSON.stringify({ session_id: "s" }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("hi\n");
  });

  it("statusline role releases the process when a grandchild keeps the previous output open", async () => {
    const r = await run(
      "statusline",
      homeWithPrevious("echo part; sleep 20 | cat"),
      JSON.stringify({ session_id: "s" }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("part\n");
    expect(r.ms).toBeLessThan(12_000);
  }, 30_000);

  describe("unexpected errors", () => {
    /** Preload that makes the first process.stdin access throw; later accesses work. */
    function preload(): Record<string, string> {
      const dir = mkdtempSync(join(tmpdir(), "vt-pre-"));
      const file = join(dir, "pre.mjs");
      writeFileSync(
        file,
        `const d = Object.getOwnPropertyDescriptor(process, "stdin");
let first = true;
Object.defineProperty(process, "stdin", {
  configurable: true,
  get() {
    if (first) {
      first = false;
      throw new Error("injected stdin failure");
    }
    return d.get.call(process);
  },
});
`,
      );
      // appended: the real-ports guard stays loaded in the bundle
      return { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${file}`.trim() };
    }

    it.each(["hook", "statusline"])("%s role stays silent and exits 0", async (role) => {
      const r = await run(role, home("http://127.0.0.1:1"), "{}", [], preload());
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("");
    });
  });

  it("the bundle does not import node:crypto (hook path stays lean)", () => {
    expect(readFileSync(bundleFile, "utf8")).not.toContain("node:crypto");
  });

  it("unknown role prints usage to stderr and exits 2", async () => {
    const r = await run("nope", home("http://127.0.0.1:1"), "");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage");
  });

  describe("setup role", () => {
    /** Windows home with a token, so a WSL-style install can finish without cmd.exe. */
    function winHome(): string {
      const w = mkdtempSync(join(tmpdir(), "vt-win-"));
      mkdirSync(join(w, ".vibetribe"));
      writeFileSync(join(w, ".vibetribe", "token"), "tok");
      return w;
    }
    const fresh = () => mkdtempSync(join(tmpdir(), "vt-setup-home-"));

    it("--uninstall on a fresh home exits 0", async () => {
      const r = await run("setup", fresh(), "", ["--uninstall"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
    });

    it("reports a SetupError as one clean line on stderr and exits 1", async () => {
      const h = fresh();
      mkdirSync(join(h, ".claude"));
      writeFileSync(join(h, ".claude", "settings.json"), "{ nope");
      const r = await run("setup", h, "", ["--windows-home", winHome()]);
      expect(r.status).toBe(1);
      expect(r.stderr.trim().split("\n")).toHaveLength(1);
      expect(r.stderr).toContain("not valid JSON");
      expect(r.stderr).not.toMatch(/\n\s+at /);
    });

    it("prints the stack of an unexpected error and exits 1", async () => {
      const h = fresh();
      // validation passes, then creating ~/.vibetribe fails: not a SetupError
      writeFileSync(join(h, ".vibetribe"), "i am a file, not a directory");
      const r = await run("setup", h, "", ["--windows-home", winHome()]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/EEXIST|ENOTDIR/);
      expect(r.stderr).toMatch(/\n\s+at /);
    });

    it.each([
      ["an unknown flag", ["--nope"]],
      ["--windows-home without a value", ["--windows-home"]],
      ["--windows-home followed by a flag", ["--windows-home", "--uninstall"]],
    ])("rejects %s with usage and exit 2", async (_n, args) => {
      const h = fresh();
      const r = await run("setup", h, "", args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("usage");
      expect(existsSync(join(h, ".claude"))).toBe(false);
      expect(existsSync(join(h, ".vibetribe"))).toBe(false);
    });
  });
});
