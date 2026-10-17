import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunningVibeTribe } from "../src/compose";
import { headlessConfig, parsePressLine, remoteFixturePorts, startHeadless } from "../src/headless";
import { freePort, svgFromDataUrl } from "./helpers";

const FIXTURE = "packages/hub/fixtures/remote/sessions.json";

const until = async (check: () => boolean, ms = 3_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("headless remote fixture and key presses", () => {
  it("reads VIBETRIBE_REMOTE_FIXTURE; without it there is no REM source", () => {
    expect(headlessConfig({}).remoteFixture).toBeNull();
    expect(headlessConfig({ VIBETRIBE_REMOTE_FIXTURE: FIXTURE }).remoteFixture).toBe(FIXTURE);
  });

  it("parses press lines", () => {
    expect(parsePressLine("press mk2:1:0")).toEqual({ id: "mk2:1:0", kind: "short" });
    expect(parsePressLine("  long mk2:0:0 ")).toEqual({ id: "mk2:0:0", kind: "long" });
    expect(parsePressLine("press")).toBeNull();
    expect(parsePressLine("tap mk2:1:0")).toBeNull();
    expect(parsePressLine("press a b")).toBeNull();
  });

  it("serves the fixture through the real parser (cse_ ids become session_) and reports a broken file", async () => {
    const ok = await remoteFixturePorts(join(process.cwd(), FIXTURE)).fetchSessions("x");
    expect(ok.kind === "ok" && ok.sessions.map((s) => s.id)).toEqual([
      "session_01SimBlocked",
      "session_01SimWorking",
      "session_01SimDone",
      "session_01SimRead",
    ]);
    const missing = remoteFixturePorts("/nonexistent/vt.json");
    expect(await missing.fetchSessions("x")).toEqual({
      kind: "error",
      message: "fixture unreadable",
    });
    const drift = remoteFixturePorts("x", async () => '{"items":[]}');
    expect(await drift.fetchSessions("x")).toEqual({
      kind: "error",
      message: "unexpected response",
    });
    expect((await missing.readCredentials())?.accessToken).toBe("fixture");
  });
});

describe("startHeadless with remote sessions", () => {
  let dir = "";
  let app: RunningVibeTribe | null = null;
  afterEach(async () => {
    await app?.stop();
    app = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("shows the fixture as REM sessions and logs a slot jump instead of opening it", async () => {
    dir = mkdtempSync(join(tmpdir(), "vt-headless-"));
    const logs: string[] = [];
    const printed: string[] = [];
    const port = await freePort();
    app = await startHeadless(
      {
        VIBETRIBE_PORT: String(port),
        VIBETRIBE_TOKEN: "tok",
        VIBETRIBE_REMOTE_FIXTURE: join(process.cwd(), FIXTURE),
      },
      { cwd: dir, log: (l) => logs.push(l), print: (t) => printed.push(t) },
    );
    const running = app;
    if (!running) throw new Error("headless did not start");
    expect(printed.join("")).toContain("press <key-id> | long <key-id>");
    await until(() => running.hub.hub.state(Date.now()).sessions.length === 4);
    const states = running.hub.hub
      .state(Date.now())
      .sessions.map((s) => [s.key.sessionId, s.badge, s.state]);
    expect(states).toEqual([
      ["session_01SimBlocked", "REM", "needs_input"],
      ["session_01SimWorking", "REM", "working"],
      ["session_01SimDone", "REM", "done_unseen"],
      ["session_01SimRead", "REM", "idle"],
    ]);
    const mirror = await (await fetch(`http://127.0.0.1:${port}/debug/keys.json`)).json();
    await until(() =>
      (
        svgFromDataUrl(
          running.deck.mirror(Date.now()).keys.find((k) => k.id === "mk2:1:0")?.image ?? "",
        ) ?? ""
      ).includes("REM"),
    );
    expect(mirror).toHaveProperty("jumps", []);
    running.press("mk2:1:0", "short");
    await until(() => logs.some((l) => l.includes("(logged)")));
    expect(logs).toContain(
      "jump (headless, not opened): claude://claude.ai/code/session_01SimBlocked",
    );
    await until(
      () =>
        running.hub.hub
          .state(Date.now())
          .sessions.find((s) => s.key.sessionId === "session_01SimBlocked")?.episodeSeen === true,
    );
  });
});
