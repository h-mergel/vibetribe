import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostInfo } from "../src/host";
import { runHook } from "../src/roles/hook";
import { runStatusline } from "../src/roles/statusline";

const WSL: HostInfo = { os: "wsl", distro: "Ubuntu", hostname: "PC" };
const SECRET = "SECRET_PROMPT_TEXT";
const HOOK_STDIN = JSON.stringify({ session_id: "s", hook_event_name: "Stop" });

function recorder() {
  const calls: { path: string; body: unknown }[] = [];
  return {
    calls,
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      return true;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runHook", () => {
  it("posts a built envelope to /v1/event", async () => {
    const r = recorder();
    await runHook({
      stdin: JSON.stringify({ session_id: "s", hook_event_name: "Stop" }),
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
    });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.path).toBe("/v1/event");
  });

  it("posts a hook body of kind hook without prompt text", async () => {
    const r = recorder();
    await runHook({
      stdin: JSON.stringify({
        session_id: "s",
        hook_event_name: "UserPromptSubmit",
        prompt: SECRET,
      }),
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
    });
    expect(r.calls).toHaveLength(1);
    const body = r.calls[0]?.body;
    expect(body).toMatchObject({ kind: "hook" });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it.each([
    ["empty stdin", ""],
    ["garbage", "{not json"],
    ["no session id", JSON.stringify({ hook_event_name: "Stop" })],
    ["null literal", "null"],
    ["empty array", "[]"],
  ])("sends nothing for %s", async (_name, stdin) => {
    const r = recorder();
    await runHook({ stdin, env: {}, host: WSL, now: 1, post: r.post });
    expect(r.calls).toHaveLength(0);
  });

  it("never writes to stdout, for a sent event and for invalid stdin", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const r = recorder();
    await runHook({ stdin: HOOK_STDIN, env: {}, host: WSL, now: 1, post: r.post });
    await runHook({ stdin: "{not json", env: {}, host: WSL, now: 1, post: r.post });
    expect(stdout).not.toHaveBeenCalled();
  });

  it("sends nothing on an unsupported host", async () => {
    const r = recorder();
    await runHook({
      stdin: JSON.stringify({ session_id: "s", hook_event_name: "Stop" }),
      env: {},
      host: null,
      now: 1,
      post: r.post,
    });
    expect(r.calls).toHaveLength(0);
  });
});

describe("runStatusline", () => {
  const stdin = JSON.stringify({
    session_id: "s",
    rate_limits: { five_hour: { used_percentage: 20 } },
  });

  it("returns the previous statusline's output and posts the rate limits", async () => {
    const r = recorder();
    const out = await runStatusline({
      stdin,
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
      previous: { command: "my-statusline", shell: "C:/Git/bin/bash.exe" },
      runPrevious: async (command, input, shell) => `${command}:${input.length}:${shell}`,
    });
    expect(out).toBe(`my-statusline:${stdin.length}:C:/Git/bin/bash.exe`);
    expect(r.calls[0]?.path).toBe("/v1/statusline");
  });

  it("posts a statusline body of kind statusline without prompt text", async () => {
    const r = recorder();
    await runStatusline({
      stdin: JSON.stringify({
        session_id: "s",
        prompt: SECRET,
        rate_limits: { five_hour: { used_percentage: 20 } },
      }),
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
      previous: null,
      runPrevious: async () => "x",
    });
    expect(r.calls).toHaveLength(1);
    const body = r.calls[0]?.body;
    expect(body).toMatchObject({ kind: "statusline" });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("returns empty output without a previous statusline", async () => {
    const r = recorder();
    expect(
      await runStatusline({
        stdin,
        env: {},
        host: WSL,
        now: 1,
        post: r.post,
        previous: null,
        runPrevious: async () => "x",
      }),
    ).toBe("");
  });

  it.each([[""], ["  \t"]])("does not run an empty previous command %j", async (command) => {
    const r = recorder();
    const runPrevious = vi.fn(async () => "x");
    const out = await runStatusline({
      stdin,
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
      previous: { command },
      runPrevious,
    });
    expect(out).toBe("");
    expect(runPrevious).not.toHaveBeenCalled();
    expect(r.calls).toHaveLength(1);
  });

  it("returns empty output when the previous command fails, and still posts", async () => {
    const r = recorder();
    const out = await runStatusline({
      stdin,
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
      previous: { command: "broken" },
      runPrevious: async () => {
        throw new Error("exit 1");
      },
    });
    expect(out).toBe("");
    expect(r.calls).toHaveLength(1);
  });

  it("returns empty output when the previous command throws synchronously, and still posts", async () => {
    const r = recorder();
    const out = await runStatusline({
      stdin,
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
      previous: { command: "broken" },
      runPrevious: () => {
        throw new Error("sync");
      },
    });
    expect(out).toBe("");
    expect(r.calls).toHaveLength(1);
  });

  it("output does not depend on the hub", async () => {
    const out = await runStatusline({
      stdin,
      env: {},
      host: WSL,
      now: 1,
      post: async () => false,
      previous: { command: "c" },
      runPrevious: async () => "line",
    });
    expect(out).toBe("line");
  });

  it("returns the previous output and posts nothing with a null host", async () => {
    const r = recorder();
    const out = await runStatusline({
      stdin,
      env: {},
      host: null,
      now: 1,
      post: r.post,
      previous: { command: "c" },
      runPrevious: async () => "line",
    });
    expect(out).toBe("line");
    expect(r.calls).toHaveLength(0);
  });

  it("still runs the previous command for invalid stdin", async () => {
    const r = recorder();
    const out = await runStatusline({
      stdin: "nope",
      env: {},
      host: WSL,
      now: 1,
      post: r.post,
      previous: { command: "c" },
      runPrevious: async () => "ok",
    });
    expect(out).toBe("ok");
    expect(r.calls).toHaveLength(0);
  });
});
