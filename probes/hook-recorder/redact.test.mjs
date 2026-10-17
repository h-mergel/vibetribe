import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./redact.mjs";

test("drops prompt text but keeps ids and event names", () => {
  const out = redact({ session_id: "abc", hook_event_name: "UserPromptSubmit", prompt: "secret plan" });
  assert.equal(out.session_id, "abc");
  assert.equal(out.hook_event_name, "UserPromptSubmit");
  assert.equal(out.prompt, "<11 chars>");
});

test("summarizes tool_input to its keys and keeps run_in_background", () => {
  const out = redact({ tool_input: { command: "rm -rf x", run_in_background: true } });
  assert.deepEqual(out.tool_input, { _keys: ["command", "run_in_background"], run_in_background: true });
});

test("drops tool_response, last_assistant_message and message", () => {
  const out = redact({ tool_response: { stdout: "x" }, last_assistant_message: "hello", message: "Claude needs permission" });
  assert.deepEqual(out.tool_response, { _keys: ["stdout"] });
  assert.equal(out.last_assistant_message, "<5 chars>");
  assert.equal(out.message, "<23 chars>");
});

test("shortens long unknown strings", () => {
  assert.equal(redact({ x: "a".repeat(100) }).x, "<100 chars>");
});

test("keeps background_tasks structure but hides commands", () => {
  const out = redact({ background_tasks: [{ id: "b1", type: "shell", status: "running", command: "sleep 60" }] });
  assert.deepEqual(out.background_tasks, [{ id: "b1", type: "shell", status: "running", command: "<8 chars>" }]);
});

test("hides short free text outside the allowlist (e.g. rule contents with commands)", () => {
  const out = redact({ permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }] }] });
  assert.equal(out.permission_suggestions[0].type, "addRules");
  assert.equal(out.permission_suggestions[0].rules[0].ruleContent, "<8 chars>");
});

test("keeps enum-like error codes, hides error messages", () => {
  assert.equal(redact({ error: "rate_limit" }).error, "rate_limit");
  assert.equal(redact({ error: "ENOENT: no such file" }).error, "<20 chars>");
});
