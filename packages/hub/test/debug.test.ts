import type { HookEnvelope } from "@vibetribe/protocol";
import { describe, expect, it } from "vitest";
import { renderDebugHtml } from "../src/http/debug";
import { Hub } from "../src/hub";

describe("renderDebugHtml", () => {
  it("renders sessions, limits, sources and recent events, escaped", () => {
    const hub = new Hub();
    hub.ingestSnapshot({
      host: "win",
      hostKind: "windows",
      at: 1_000,
      sessions: [
        {
          sessionId: "s1",
          pid: 7,
          cwd: "C:/p",
          entrypoint: "claude-desktop",
          name: "<b>Title</b>",
          hostSessionId: null,
          bridgeSessionId: null,
          status: "busy",
          waitingFor: null,
        },
      ],
    });
    const html = renderDebugHtml(hub.state(1_000), "Europe/Berlin");
    expect(html).toContain("&lt;b&gt;Title&lt;/b&gt;");
    expect(html).toContain("working");
    expect(html).toContain("sessions:win");
    expect(html).toContain('http-equiv="refresh"');
  });

  it("escapes a script payload in every string field and never emits a raw <script", () => {
    const payload = "<script>alert(1)</script>";
    const hub = new Hub();
    const envelope = {
      v: 1,
      kind: "hook",
      source: { host: payload, os: "windows", distro: null, entrypoint: payload },
      session: { id: payload, cwd: payload, pid: 1, hostSessionId: null },
      event: {
        name: payload,
        ts: 1,
        toolName: payload,
        toolUseId: null,
        agentId: null,
        notificationType: null,
        errorType: payload,
        reason: payload,
        auto: null,
        backgroundTasks: null,
      },
    } as unknown as HookEnvelope;
    hub.ingest(envelope, 1_000);
    hub.ingestSnapshot({
      host: payload,
      hostKind: "windows",
      at: 1_000,
      sessions: [
        {
          sessionId: "s2",
          pid: 2,
          cwd: payload,
          entrypoint: payload,
          name: payload,
          hostSessionId: payload,
          bridgeSessionId: payload,
          status: "busy",
          waitingFor: payload,
        },
      ],
    });
    hub.markError(`sessions:${payload}`, payload);
    hub.ingestUsage(
      { extra: { enabled: true, usedCredits: 1, monthlyLimit: 2, currency: payload } },
      1_000,
    );
    const html = renderDebugHtml(hub.state(1_000), "Europe/Berlin");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders an empty state without throwing", () => {
    const html = renderDebugHtml(new Hub().state(0), "Europe/Berlin");
    expect(html).toContain("Sessions (0)");
    for (const heading of ["Keys", "Limits", "Sources", "Recent events (invalid envelopes: 0)"]) {
      expect(html).toContain(`<h2>${heading}`);
    }
    expect(html).toContain("<th>Origin</th><th>Title</th><th>State</th>");
  });

  it("renders a non-finite time as a dash instead of failing the page", () => {
    const state = new Hub().state(0);
    state.recent.push({ at: Number.NaN, host: "win", sessionId: "s1", name: "Stop" });
    expect(renderDebugHtml(state, "Europe/Berlin")).toContain("<td>–</td><td>win</td>");
  });

  it("shows the sidebar place of sessions pinned in Claude Desktop", () => {
    const hub = new Hub();
    const file = {
      pid: 7,
      cwd: "C:/p",
      entrypoint: "claude-desktop",
      bridgeSessionId: null,
      status: "idle" as const,
      waitingFor: null,
    };
    hub.ingestSnapshot({
      host: "win",
      hostKind: "windows",
      at: 1_000,
      sessions: [
        { ...file, sessionId: "s1", name: "Pinned", hostSessionId: "local_a" },
        { ...file, sessionId: "s2", name: "Loose", hostSessionId: "local_z" },
      ],
    });
    hub.ingestPins(["local_b", "local_a"]);
    const html = renderDebugHtml(hub.state(1_000), "Europe/Berlin");
    expect(html).toContain("<th>Episode since</th><th>Pin</th>");
    const rows = html.split("<tr>");
    // the last two cells: episode since (none) and pin
    expect(rows.find((r) => r.includes("Pinned"))).toContain("<td>–</td><td>2</td></tr>");
    expect(rows.find((r) => r.includes("Loose"))).toContain("<td>–</td><td>–</td></tr>");
  });

  it("renders a missing last-seen time as a dash", () => {
    const hub = new Hub();
    hub.markError("usage", "login expired");
    const html = renderDebugHtml(hub.state(1_000), "Europe/Berlin");
    expect(html).toContain("<td>missing</td><td>–</td><td>login expired</td>");
  });
});
