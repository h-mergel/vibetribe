import { INGRESS_TOKEN_MESSAGE, ingressPortError } from "@vibetribe/hub";
import { describe, expect, it } from "vitest";
import type { KeyPlacement } from "../src/deck/keys";
import { inboxView, statusAlert, statusTile, type TileContext, tileFor } from "../src/deck/tiles";
import { hubState, view } from "./helpers";

const key = (role: KeyPlacement["role"]): KeyPlacement => ({
  id: role,
  role,
  device: "d",
  row: 0,
  column: 0,
});
const ctx = (over: Partial<TileContext> = {}): TileContext => ({
  now: 10_000,
  animated: new Set(),
  slotIds: [],
  inbox: inboxView(hubState(), new Set()),
  ...over,
});
const ok = { health: "ok", lastAt: 1, error: null } as const;
const stale = { health: "stale", lastAt: 1, error: null } as const;
const missing = { health: "missing", lastAt: null, error: null } as const;
const PORT_ERROR = ingressPortError([{ port: 43710, code: "EADDRINUSE" }]);

describe("statusTile", () => {
  it("maps source names to WIN/WSL/REM/LIM with the worst health per kind; a configured source that is down is missing", () => {
    const state = hubState({
      sources: {
        "sessions:win": { health: "ok", lastAt: 1, error: null },
        "sessions:wsl:Ubuntu": { health: "stale", lastAt: 1, error: null },
        "sessions:wsl:Debian": { health: "ok", lastAt: 1, error: null },
        usage: { health: "missing", lastAt: null, error: "login expired" },
        ingress: { health: "ok", lastAt: 1, error: null },
      },
    });
    expect(statusTile(state)).toEqual({
      kind: "status",
      rows: [
        { source: "WIN", health: "ok" },
        { source: "WSL", health: "stale" },
        { source: "REM", health: "off" },
        { source: "LIM", health: "missing" },
      ],
      alert: null,
    });
  });

  it("no source of a kind gives off, not missing: REM is off until the remote source is configured", () => {
    expect(statusTile(hubState()).rows).toEqual([
      { source: "WIN", health: "off" },
      { source: "WSL", health: "off" },
      { source: "REM", health: "off" },
      { source: "LIM", health: "off" },
    ]);
  });

  it("a configured remote source that is down is missing, not off", () => {
    const state = hubState({ sources: { "sessions:remote": missing } });
    expect(statusTile(state).rows.find((s) => s.source === "REM")?.health).toBe("missing");
  });

  it("the WSL rule holds too: no WSL source gives off", () => {
    const state = hubState({ sources: { "sessions:win": ok } });
    expect(statusTile(state).rows.find((s) => s.source === "WSL")?.health).toBe("off");
  });

  it("a remote source that is ok makes REM ok; a usage source that is ok makes LIM ok", () => {
    const state = hubState({
      sources: { "sessions:remote": ok, usage: ok },
    });
    expect(statusTile(state).rows).toEqual([
      { source: "WIN", health: "off" },
      { source: "WSL", health: "off" },
      { source: "REM", health: "ok" },
      { source: "LIM", health: "ok" },
    ]);
  });

  it("prefix matchers need the trailing colon: sessions:wslx is not WSL", () => {
    const state = hubState({
      sources: { "sessions:wslx": ok, "sessions:remotex": ok },
    });
    const byLabel = Object.fromEntries(statusTile(state).rows.map((s) => [s.source, s.health]));
    expect(byLabel.WSL).toBe("off");
    expect(byLabel.REM).toBe("off");
  });

  it("ranks health within one kind: missing beats stale, stale beats ok, in either order", () => {
    const worstOf = (
      a: typeof ok | typeof stale | typeof missing,
      b: typeof ok | typeof stale | typeof missing,
    ) =>
      statusTile(hubState({ sources: { "sessions:wsl:A": a, "sessions:wsl:B": b } })).rows[1]
        ?.health;
    expect(worstOf(stale, missing)).toBe("missing");
    expect(worstOf(missing, stale)).toBe("missing");
    expect(worstOf(ok, stale)).toBe("stale");
    expect(worstOf(stale, ok)).toBe("stale");
  });

  it("turns ingress errors into short alerts; a taken port outranks a missing token", () => {
    const withError = (error: string) =>
      hubState({ sources: { ingress: { health: "missing", lastAt: null, error } } });
    expect(statusAlert(withError(PORT_ERROR))).toBe("Port in use");
    expect(statusAlert(withError(INGRESS_TOKEN_MESSAGE))).toBe("No token");
    expect(statusAlert(withError(`${PORT_ERROR}; ${INGRESS_TOKEN_MESSAGE}`))).toBe("Port in use");
    expect(statusAlert(withError("EACCES"))).toBe("Error");
    expect(statusAlert(hubState())).toBeNull();
  });
});

describe("tileFor", () => {
  const a = view({
    key: { host: "win", sessionId: "a" },
    state: "needs_permission",
    episodeSince: 9_000,
    episodeSeen: false,
  });
  const b = view({
    key: { host: "win", sessionId: "b" },
    state: "done_unseen",
    episodeSince: 8_000,
    episodeSeen: false,
  });
  const state = hubState({ sessions: [a, b] });

  it("slot keys show the session at their index, breathing only when animated, empty otherwise", () => {
    const c = ctx({ slotIds: [a.id, null, b.id], animated: new Set([a.id]) });
    expect(tileFor(key("slot"), 0, state, c)).toMatchObject({
      kind: "slot",
      title: "a",
      state: "needs_permission",
      // breathing: the clock is read at the start of the breath step (9.9 s), so 0 s
      wait: 0,
      frame: "thick",
    });
    const slot0 = tileFor(key("slot"), 0, state, c);
    expect(slot0.kind === "slot" && (slot0.level ?? 1) < 1).toBe(true);
    expect(tileFor(key("slot"), 1, state, c)).toEqual({ kind: "empty" });
    expect(tileFor(key("slot"), 2, state, c)).toMatchObject({ kind: "slot", title: "b", level: 1 });
    expect(tileFor(key("slot"), 7, state, c)).toEqual({ kind: "empty" });
  });

  it("a slot id whose session has left the hub state shows empty", () => {
    const c = ctx({ slotIds: ["win/gone"], animated: new Set() });
    expect(tileFor(key("slot"), 0, state, c)).toEqual({ kind: "empty" });
  });

  it("the inbox counts only waiting sessions and has no top when nothing waits", () => {
    const calm = hubState({
      sessions: [
        view({ key: { host: "win", sessionId: "w" }, state: "working" }),
        view({ key: { host: "win", sessionId: "bg" }, state: "background" }),
      ],
    });
    expect(
      tileFor(key("inbox"), -1, calm, ctx({ inbox: inboxView(calm, new Set()) })),
    ).toMatchObject({
      waiting: 0,
      top: null,
    });
  });

  it("inbox counts waiting sessions and overflow, limits and extra follow the hub limits", () => {
    const onKeys = new Set([b.id]);
    expect(tileFor(key("inbox"), -1, state, ctx({ inbox: inboxView(state, onKeys) }))).toEqual({
      kind: "inbox",
      top: { title: "a", state: "needs_permission", wait: 1 },
      waiting: 2,
      overflow: 1,
      cycle: null,
    });
    const limits = hubState({
      limits: {
        fiveHour: {
          id: "five_hour",
          usedPct: 62,
          resetsAt: 10_000 + 3_600_000,
          pacePct: 40,
          aheadOfPlan: true,
          level: "amber",
          stale: false,
          receivedAt: 10_000,
          rolledOver: false,
        },
        sevenDay: null,
        extra: {
          enabled: true,
          usedCredits: 12.4,
          monthlyLimit: 50,
          currency: "EUR",
          stale: false,
          receivedAt: 10_000,
        },
        auth: "ok",
      },
    });
    expect(tileFor(key("limit5h"), -1, limits, ctx())).toMatchObject({
      kind: "limit",
      label: "5h",
      usedPct: 62,
      resetIn: "1h 0m",
    });
    expect(tileFor(key("limitWeek"), -1, limits, ctx())).toMatchObject({
      kind: "limit",
      label: "Week",
      usedPct: null,
      note: "No data",
    });
    const extra = tileFor(key("extra"), -1, limits, ctx());
    expect(extra).toMatchObject({ kind: "extra", ratio: 0.248 });
    expect(extra.kind === "extra" && extra.used).toBe("€12.40");
    expect(tileFor(key("status"), -1, limits, ctx())).toMatchObject({
      kind: "status",
      alert: null,
    });
  });

  it("the status key reflects the given state, including the ingress alert", () => {
    const withPort = hubState({
      sources: {
        "sessions:win": ok,
        ingress: { health: "missing", lastAt: null, error: PORT_ERROR },
      },
    });
    expect(tileFor(key("status"), -1, withPort, ctx())).toEqual({
      kind: "status",
      rows: [
        { source: "WIN", health: "ok" },
        { source: "WSL", health: "off" },
        { source: "REM", health: "off" },
        { source: "LIM", health: "off" },
      ],
      alert: "Port in use",
    });
  });

  it("with an expired login the limit tiles show the Sign in note", () => {
    const expired = hubState({
      limits: {
        fiveHour: {
          id: "five_hour",
          usedPct: 62,
          resetsAt: 10_000 + 3_600_000,
          pacePct: 40,
          aheadOfPlan: true,
          level: "amber",
          stale: false,
          receivedAt: 10_000,
          rolledOver: false,
        },
        sevenDay: null,
        extra: null,
        auth: "expired",
      },
    });
    expect(tileFor(key("limit5h"), -1, expired, ctx())).toMatchObject({
      kind: "limit",
      stale: true,
      note: "Sign in",
    });
    expect(tileFor(key("limitWeek"), -1, expired, ctx())).toMatchObject({
      kind: "limit",
      note: "Sign in",
    });
  });

  it("forwards ctx.timeZone to the stale-data clock note", () => {
    const receivedAt = Date.UTC(2026, 9, 13, 12, 34);
    const stale5h = hubState({
      limits: {
        fiveHour: {
          id: "five_hour",
          usedPct: 62,
          resetsAt: null,
          pacePct: null,
          aheadOfPlan: false,
          level: "neutral",
          stale: true,
          receivedAt,
          rolledOver: false,
        },
        sevenDay: null,
        extra: null,
        auth: "ok",
      },
    });
    expect(tileFor(key("limit5h"), -1, stale5h, ctx({ timeZone: "Asia/Tokyo" }))).toMatchObject({
      note: "As of 21:34",
    });
    expect(tileFor(key("limit5h"), -1, stale5h, ctx({ timeZone: "UTC" }))).toMatchObject({
      note: "As of 12:34",
    });
  });
});
