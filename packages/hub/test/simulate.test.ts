import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTokenFile, parseArgs, postEnvelope, runScenario } from "../scripts/simulate";
import { type RunningHub, startHub } from "../src/runtime";
import { loadScenario } from "../src/scenario";

let running: RunningHub | null = null;
afterEach(async () => {
  await running?.stop();
  running = null;
});

interface SimSession {
  key: { sessionId: string };
  state: string;
  background: { count: number; kinds: Record<string, number> };
}

const scenario = (name: string) =>
  loadScenario(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/scenarios/${name}.jsonl`, import.meta.url)),
      "utf8",
    ),
  );

async function startAndPlay(name: string): Promise<string> {
  running = await startHub({ port: 0, token: "t", sources: [], usage: null });
  const url = `http://127.0.0.1:${running.port}`;
  await runScenario(scenario(name), (envelope) => postEnvelope(url, "t", envelope));
  return url;
}

async function sessionsAt(url: string): Promise<SimSession[]> {
  const state = (await (await fetch(`${url}/debug/state.json`)).json()) as {
    sessions: SimSession[];
  };
  return state.sessions;
}

const statesOf = (sessions: SimSession[]) =>
  Object.fromEntries(sessions.map((s) => [s.key.sessionId, s.state]));

describe("simulator scenarios end to end", () => {
  it("three sessions, one waiting", async () => {
    const url = await startAndPlay("three-sessions-one-waiting");
    await vi.waitFor(
      async () =>
        expect(statesOf(await sessionsAt(url))).toEqual({
          "sim-a": "working",
          "sim-b": "needs_permission",
          "sim-c": "done_unseen",
        }),
      { timeout: 2000 },
    );
  });

  it("done with background jobs keeps the two jobs in the summary", async () => {
    const url = await startAndPlay("done-with-background-jobs");
    await vi.waitFor(
      async () => {
        const sessions = await sessionsAt(url);
        expect(statesOf(sessions)).toEqual({ "sim-bg": "done_unseen" });
        expect(sessions[0]?.background).toMatchObject({
          count: 2,
          kinds: { shell: 1, agent: 1, monitor: 0, other: 0 },
        });
      },
      { timeout: 2000 },
    );
  });

  it("parallel subagent permissions end cleanly despite the anonymous notification (probe S7)", async () => {
    const url = await startAndPlay("subagent-parallel-permission");
    await vi.waitFor(
      async () => expect(statesOf(await sessionsAt(url))).toEqual({ "sim-s7": "working" }),
      { timeout: 2000 },
    );
  });

  it("loadScenario rejects lines without envelope", () => {
    expect(() => loadScenario('{"delayMs":0}')).toThrow(/line 1/);
  });
});

describe("runScenario and postEnvelope errors", () => {
  it("a 401 names status and body but never the token", async () => {
    running = await startHub({ port: 0, token: "t", sources: [], usage: null });
    const url = `http://127.0.0.1:${running.port}`;
    const secret = "wrong-secret-value";
    const err = await runScenario(scenario("three-sessions-one-waiting"), (envelope) =>
      postEnvelope(url, secret, envelope),
    ).catch((e: Error) => e);
    expect((err as Error).message).toBe("hub answered 401: unauthorized");
    expect((err as Error).message).not.toContain(secret);
  });

  it("truncates a long response body to 200 characters", async () => {
    const err = await runScenario([{ delayMs: 0, envelope: {} }], async () => ({
      status: 500,
      body: "x".repeat(500),
    })).catch((e: Error) => e);
    expect((err as Error).message).toBe(`hub answered 500: ${"x".repeat(200)}`);
  });

  it("names the error code when the hub is unreachable", async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((r) => server.close(() => r()));
    // refused or reset depending on the platform; either way the code must be named
    await expect(postEnvelope(`http://127.0.0.1:${port}`, "t", {})).rejects.toThrow(
      /hub unreachable at http:\/\/127\.0\.0\.1:\d+ \(E[A-Z]+\)/,
    );
  });
});

describe("parseArgs", () => {
  it("defaults the url and leaves the token file to the lookup", () => {
    expect(parseArgs(["a.jsonl"])).toEqual({
      file: "a.jsonl",
      url: "http://127.0.0.1:43710",
      tokenFile: undefined,
    });
  });

  it("reads --url and --token-file and strips trailing slashes from the url", () => {
    expect(
      parseArgs(["a.jsonl", "--url", "http://127.0.0.1:9/", "--token-file", "/tmp/t"]),
    ).toEqual({
      file: "a.jsonl",
      url: "http://127.0.0.1:9",
      tokenFile: "/tmp/t",
    });
  });

  it("rejects a missing scenario file or one that looks like a flag", () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["--url", "http://x"])).toThrow(/usage/);
  });

  it("rejects --url or --token-file without a value", () => {
    expect(() => parseArgs(["a.jsonl", "--url"])).toThrow("--url needs a value");
    expect(() => parseArgs(["a.jsonl", "--url", "--token-file", "/tmp/t"])).toThrow(
      "--url needs a value",
    );
    expect(() => parseArgs(["a.jsonl", "--token-file"])).toThrow("--token-file needs a value");
  });
});

describe("findTokenFile", () => {
  const none = () => false;

  it("prefers the token in the home directory and does not look at Windows users", () => {
    const listUsers = vi.fn(() => ["Heinrich"]);
    const path = findTokenFile({
      home: "/home/heinrich",
      wsl: true,
      listUsers,
      exists: (p) => p === "/home/heinrich/.vibetribe/token",
    });
    expect(path).toBe("/home/heinrich/.vibetribe/token");
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("finds the first Windows user's token from WSL", () => {
    const path = findTokenFile({
      home: "/home/heinrich",
      wsl: true,
      listUsers: () => ["Public", "Heinrich", "Other"],
      exists: (p) =>
        p === "/mnt/c/Users/Heinrich/.vibetribe/token" ||
        p === "/mnt/c/Users/Other/.vibetribe/token",
    });
    expect(path).toBe("/mnt/c/Users/Heinrich/.vibetribe/token");
  });

  it("does not search Windows users outside WSL", () => {
    const listUsers = vi.fn(() => ["Heinrich"]);
    expect(() =>
      findTokenFile({ home: "/home/x", wsl: false, listUsers, exists: () => true }),
    ).not.toThrow();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("fails with a hint when no token exists", () => {
    expect(() =>
      findTokenFile({ home: "/home/x", wsl: true, listUsers: () => ["Heinrich"], exists: none }),
    ).toThrow("token not found – pass --token-file /mnt/c/Users/<you>/.vibetribe/token");
  });
});
