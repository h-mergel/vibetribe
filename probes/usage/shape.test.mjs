import assert from "node:assert/strict";
import { test } from "node:test";
import { describeShape } from "./shape.mjs";

test("keeps numbers, booleans, null and short enums; hides other strings", () => {
  const out = describeShape({ five_hour: { utilization: 41.5, resets_at: "2026-10-10T15:00:00Z" }, extra_usage: { is_enabled: true, currency: "EUR", used_credits: 1240 } });
  assert.deepEqual(out, {
    five_hour: { utilization: 41.5, resets_at: "<iso-date>" },
    extra_usage: { is_enabled: true, currency: "EUR", used_credits: 1240 },
  });
});

test("never reveals token-like strings", () => {
  const out = describeShape({ token: "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz", note: "some longer free text here" });
  assert.equal(out.token, "<string 39>");
  assert.equal(out.note, "<string 26>");
});
