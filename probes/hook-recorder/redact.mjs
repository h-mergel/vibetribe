// Allowlist redaction: keeps structure, numbers, booleans and strings of known identifier/enum fields.
// Every other string (prompts, commands, messages, titles, rule contents) becomes "<n chars>".
const KEEP = new Set([
  "session_id", "hook_event_name", "tool_name", "toolName", "tool_use_id", "agent_id", "agent_type",
  "notification_type", "reason", "source", "permission_mode", "model", "trigger", "mcp_server",
  "elicitation_id", "action", "mode", "prompt_id", "cwd", "id", "type", "kind", "status", "behavior", "destination",
]);
const ENUM = /^[a-z_]{1,32}$/;
const DROP = new Set([
  "prompt",
  "tool_input",
  "tool_response",
  "last_assistant_message",
  "message",
  "transcript_path",
  "agent_transcript_path",
  "error_details",
  "content",
  "description",
]);

function summarize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return `<${value.length} chars>`;
  if (Array.isArray(value)) return `<array ${value.length}>`;
  if (typeof value === "object") {
    const out = { _keys: Object.keys(value).sort() };
    if (typeof value.run_in_background === "boolean") out.run_in_background = value.run_in_background;
    return out;
  }
  return typeof value;
}

export function redact(value, key = "") {
  if (DROP.has(key)) return summarize(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === "string") {
    if (KEEP.has(key) || (key === "error" && ENUM.test(value))) return value;
    return `<${value.length} chars>`;
  }
  return value;
}
