import { changed, ok, skipped } from "@vibetribe/hub";
import { describe, expect, it } from "vitest";
import { formatCost, parseTurnResult, RunObserver } from "../scripts/e2e-observe";
import { hubState, view } from "./helpers";

const ID = "0a1b2c3d-0000-4000-8000-00000000000a";
const RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  total_cost_usd: 0.00123,
  usage: {
    input_tokens: 532,
    output_tokens: 4,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 9,
  },
};
const INIT = {
  type: "system",
  subtype: "init",
  session_id: ID,
  model: "claude-haiku-4-5-20251001",
  apiKeySource: "none",
};
const session = (state: "working" | "done_unseen") =>
  view({ key: { host: "win", sessionId: ID }, state });
const event = (name: string) => ({ at: 1, host: "win", sessionId: ID, name });
const file = (fields: Record<string, unknown> = {}) => ({
  name: "4242.json",
  text: JSON.stringify({
    pid: 4242,
    sessionId: ID,
    procStart: "134360984898638759",
    status: "busy",
    entrypoint: "sdk-cli",
    ...fields,
  }),
});

describe("parseTurnResult", () => {
  it("reads how the turn ended and what it cost from the result message only", () => {
    expect(parseTurnResult(JSON.stringify(RESULT))).toEqual({
      failed: false,
      subtype: "success",
      costUsd: 0.00123,
      tokens: { input: 532, output: 4, cacheWrite: 0, cacheRead: 9 },
    });
    expect(parseTurnResult(JSON.stringify({ type: "assistant", message: {} }))).toBeNull();
    expect(parseTurnResult("{")).toBeNull();
  });

  it("prints the cost with its tokens, or says it is unknown", () => {
    expect(formatCost("windows", parseTurnResult(JSON.stringify(RESULT)))).toBe(
      "windows cost: $0.0012 (input 532, output 4, cache write 0, cache read 9 tokens)",
    );
    expect(formatCost("wsl", null)).toBe("wsl cost: unknown");
  });
});

describe("RunObserver", () => {
  it("passes a run whose hooks, states, file and end the hub and the folder showed", () => {
    const o = new RunObserver(ID);
    expect(
      o.sawHub(hubState({ sessions: [session("working")], recent: [event("SessionStart")] })),
    ).toBe(true);
    o.sawLine(JSON.stringify(INIT));
    o.sawLine(JSON.stringify(RESULT));
    o.sawFiles([{ name: "1.json", text: "{}" }, file()], "windows");
    const done = [event("UserPromptSubmit"), event("Stop")];
    o.sawHub(hubState({ sessions: [session("done_unseen")], recent: done }));
    o.sawHub(hubState({ sessions: [session("done_unseen")], recent: done }));
    o.sawFiles([], "windows");
    expect(o.sawHub(hubState({ recent: [event("SessionEnd")] }))).toBe(false);
    expect(
      o.verdict("windows", { turn: parseTurnResult(JSON.stringify(RESULT)), exit: 0, gone: true }),
    ).toEqual([
      ok("windows turn", "success"),
      ok("windows model", "claude-haiku-4-5-20251001, no API key"),
      ok("windows hooks", "SessionStart, UserPromptSubmit, Stop, SessionEnd"),
      ok("windows deck", "working → done_unseen"),
      ok("windows session file", "entrypoint sdk-cli, status busy"),
      ok("windows session end", "gone from the hub"),
    ]);
  });

  it("names everything the run did not see", () => {
    const o = new RunObserver(ID);
    const foreign = { ...event("Stop"), sessionId: "another" };
    o.sawHub(
      hubState({ sessions: [session("working")], recent: [event("SessionStart"), foreign] }),
    );
    const failed = { ...RESULT, is_error: true, subtype: "error_max_budget_usd" };
    expect(
      o.verdict("wsl", { turn: parseTurnResult(JSON.stringify(failed)), exit: 1, gone: false }),
    ).toEqual([
      changed("wsl turn", "failed (error_max_budget_usd, exit 1)"),
      changed("wsl model", "claude sent no init message"),
      changed("wsl hooks", "never reached the hub: UserPromptSubmit, Stop, SessionEnd"),
      changed("wsl deck", "never done_unseen (states: working)"),
      skipped("wsl session file", "print mode wrote none"),
      changed("wsl session end", "still in the hub after the session ended"),
    ]);
    const unseen = new RunObserver(ID).verdict("wsl", { turn: null, exit: null, gone: true });
    expect(unseen[0]).toEqual(changed("wsl turn", "claude sent no result (exit none)"));
    expect(unseen.at(-1)).toEqual(skipped("wsl session end", "never in the hub"));
  });

  it("calls the model drift unless claude ran Haiku without an API key", () => {
    const modelOf = (init: Record<string, unknown>) => {
      const o = new RunObserver(ID);
      o.sawLine("{");
      o.sawLine(JSON.stringify({ ...INIT, ...init }));
      return o.verdict("wsl", { turn: null, exit: null, gone: true })[1];
    };
    expect(modelOf({})).toEqual(ok("wsl model", "claude-haiku-4-5-20251001, no API key"));
    expect(modelOf({ model: "claude-sonnet-4-5" })).toEqual(
      changed("wsl model", "claude-sonnet-4-5, API key source none"),
    );
    expect(modelOf({ apiKeySource: "ANTHROPIC_API_KEY" })).toEqual(
      changed("wsl model", "claude-haiku-4-5-20251001, API key source ANTHROPIC_API_KEY"),
    );
    expect(modelOf({ model: undefined, apiKeySource: undefined })).toEqual(
      changed("wsl model", "unknown, API key source unknown"),
    );
  });

  it("calls its own session file drift when the parser rejects it, unless one read was good", () => {
    const broken = new RunObserver(ID);
    broken.sawFiles([{ name: "4243.json", text: file().text }], "windows");
    expect(broken.verdict("windows", { turn: null, exit: null, gone: true })[4]).toEqual(
      changed("windows session file", "the parser rejects it or it names another pid"),
    );
    const noStart = new RunObserver(ID);
    noStart.sawFiles([file({ procStart: undefined })], "windows");
    expect(noStart.verdict("windows", { turn: null, exit: null, gone: true })[4]).toEqual(
      changed("windows session file", "no procStart"),
    );
    const good = new RunObserver(ID);
    good.sawFiles([file()], "windows");
    good.sawFiles([{ name: "4242.json", text: file().text.slice(0, 70) }], "windows");
    expect(good.verdict("windows", { turn: null, exit: null, gone: true })[4]?.outcome).toBe("ok");
  });
});
