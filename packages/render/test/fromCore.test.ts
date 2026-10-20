import type { SessionView } from "@vibetribe/core";
import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatMoney } from "../src/format";
import { extraTile, inboxTile, limitTile, slotTile, waitSeconds } from "../src/fromCore";

const TZ = "Europe/Berlin";
const base: SessionView = {
  id: "wsl:Ubuntu/s1",
  key: { host: "wsl:Ubuntu", sessionId: "s1" },
  hostKind: "wsl",
  badge: "WSL",
  title: "Mobile Entwicklung Northwind",
  cwd: "/home/h2k/dev/projects/acme",
  state: "idle",
  detail: null,
  errorType: null,
  episodeSince: null,
  episodeSeen: true,
  background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
  pid: 1,
  entrypoint: "claude-desktop",
  hostSessionId: "local_x",
  bridgeSessionId: null,
};
const permission = {
  ...base,
  state: "needs_permission" as const,
  episodeSince: 0,
  episodeSeen: false,
};

describe("waitSeconds", () => {
  it("counts whole seconds and never goes negative", () => {
    expect(waitSeconds(0, 65_400)).toBe(65);
    expect(waitSeconds(10_000, 0)).toBe(0);
  });

  it("moves in 2 s steps below one minute when asked, not above", () => {
    expect(waitSeconds(0, 43_900, 2)).toBe(42);
    expect(waitSeconds(0, 42_000, 2)).toBe(42);
    expect(waitSeconds(0, 61_000, 2)).toBe(61);
  });
});

describe("slotTile", () => {
  it("shows the wait in seconds and the breath level when animated", () => {
    // 65.4 s after the start: breath step 2 of 4 (600–900 ms of the 1.2 s period) -> level 1
    const t = slotTile(permission, { now: 65_400, animated: true });
    expect(t.frame).toBe("thick");
    expect(t.level).toBe(1);
    // the clock of a breathing key is read at the start of its breath step (65.4 s -> 65.4 s)
    expect(t.wait).toBe(65);
  });

  it("reads a breathing key's clock at the start of the breath step", () => {
    // 60.1 s: the step started at 60.0 s; at 59.99 s it still shows 59 s
    expect(slotTile(permission, { now: 60_100, animated: true }).wait).toBe(60);
    expect(slotTile(permission, { now: 60_250, animated: true }).wait).toBe(60);
    expect(slotTile(permission, { now: 59_990, animated: true }).wait).toBe(59);
  });

  it("is static (level 1) when not animated and applies the clock step", () => {
    const t = slotTile(permission, { now: 43_500, animated: false, clockStepS: 2 });
    expect(t.level).toBe(1);
    expect(t.wait).toBe(42);
  });

  it("an unseen done_unseen asks for a static thick frame (R9, handoff v2; never animated, R11)", () => {
    const done = { ...base, state: "done_unseen" as const, episodeSince: 0, episodeSeen: false };
    // core animatedIds never names a done_unseen, so the deck asks for animated: false
    const t = slotTile(done, { now: 300, animated: false });
    expect(t.frame).toBe("thick");
    expect(t.level).toBe(1);
    // seen: back to calm
    expect(slotTile({ ...base, episodeSince: 0 }, { now: 300, animated: false }).frame).toBe(
      "normal",
    );
  });

  it("shows no wait for states without a clock", () => {
    expect(slotTile({ ...base, episodeSince: 0 }, { now: 5_000, animated: false }).wait).toBeNull();
  });

  it("background state lists the job kinds, short when there are several", () => {
    const bg = (kinds: SessionView["background"]["kinds"]) =>
      slotTile(
        { ...base, state: "background", background: { count: 3, kinds, stale: false } },
        { now: 0, animated: false },
      );
    expect(bg({ shell: 2, agent: 1, monitor: 0, other: 0 }).detail).toBe("2 sh · 1 ag");
    expect(bg({ shell: 2, agent: 0, monitor: 0, other: 0 }).detail).toBe("2 shell");
    expect(bg({ shell: 2, agent: 1, monitor: 3, other: 1 }).detail).toBe(
      "2 sh · 1 ag · 3 mon · 1 job",
    );
    expect(bg({ shell: 2, agent: 1, monitor: 0, other: 0 }).bgCount).toBe(3);
  });

  it("working shows the tool and the lit dot, error shows the error type", () => {
    const w = slotTile(
      { ...base, state: "working", detail: "Bash" },
      { now: 0, animated: false, tick: 2 },
    );
    expect(w).toMatchObject({ detail: "Bash", tick: 2 });
    expect(slotTile(base, { now: 0, animated: false, tick: 2 }).tick).toBe(0);
    expect(
      slotTile(
        { ...base, state: "error", errorType: "billing_error", episodeSince: 0 },
        { now: 0, animated: false },
      ).detail,
    ).toBe("billing_error");
  });

  it("carries a press flash only when one is given", () => {
    expect(slotTile(base, { now: 0, animated: false })).not.toHaveProperty("flash");
    expect(slotTile(base, { now: 0, animated: false, flash: null })).not.toHaveProperty("flash");
    expect(slotTile(base, { now: 0, animated: false, flash: "no_target" })).toMatchObject({
      flash: "no_target",
    });
  });

  it("uses a drawable title (folder name for a title in an undrawable script)", () => {
    expect(
      slotTile({ ...base, title: "日本語のプロジェクト" }, { now: 0, animated: false }).title,
    ).toBe("acme");
  });
});

describe("inboxTile", () => {
  const top = { ...base, state: "needs_input" as const, episodeSince: 1_000 };

  it("maps the summary with the top session's wait", () => {
    expect(inboxTile({ top, waitingCount: 2, overflowCount: 1 }, { now: 43_000 })).toEqual({
      kind: "inbox",
      waiting: 2,
      top: { title: "Mobile Entwicklung Northwind", state: "needs_input", wait: 42 },
      overflow: 1,
      cycle: null,
    });
  });

  it("carries the cycle position and a press flash only when given", () => {
    const summary = { top: null, waitingCount: 0, overflowCount: 0 };
    expect(inboxTile(summary, { now: 0 })).not.toHaveProperty("flash");
    expect(
      inboxTile(summary, { now: 0, flash: "jumping", cycle: { index: 2, total: 3 } }),
    ).toMatchObject({ flash: "jumping", cycle: { index: 2, total: 3 } });
  });
});

describe("limitTile", () => {
  const w = {
    id: "five_hour" as const,
    usedPct: 62,
    resetsAt: 4_320_000,
    pacePct: 40,
    aheadOfPlan: true,
    level: "amber" as const,
    stale: false,
    receivedAt: 0,
    rolledOver: false,
  };

  it("formats reset time and ahead flag", () => {
    expect(limitTile("5h", w, "ok", 0, TZ)).toMatchObject({
      label: "5h",
      usedPct: 62,
      resetIn: "1h 12m",
      ahead: true,
      note: null,
    });
  });

  it("notes stale data with the clock time, expired auth and missing data in English", () => {
    expect(
      limitTile("5h", { ...w, stale: true, receivedAt: Date.UTC(2026, 9, 10, 12, 5) }, "ok", 0, TZ)
        .note,
    ).toBe("As of 14:05");
    expect(limitTile("5h", w, "expired", 0, TZ).note).toBe("Sign in");
    expect(limitTile("Week", null, "ok", 0, TZ)).toMatchObject({ label: "Week", note: "No data" });
    expect(
      limitTile(
        "5h",
        { ...w, rolledOver: true, resetsAt: null, pacePct: null, usedPct: 0 },
        "ok",
        0,
        TZ,
      ).note,
    ).toBe("New window");
  });
});

describe("extraTile", () => {
  const view = {
    enabled: true,
    usedCredits: 12.4,
    monthlyLimit: 50,
    currency: "EUR",
    stale: false,
    receivedAt: 0,
  };

  it("formats money with the sign in front and the ratio", () => {
    const t = extraTile(view, "ok", TZ);
    expect(t).toMatchObject({ used: "€12.40", limit: "€50.00", level: "neutral", note: null });
    expect(t.ratio).toBeCloseTo(0.248);
  });

  it("handles disabled, missing and expired", () => {
    expect(extraTile({ ...view, enabled: false }, "ok", TZ)).toMatchObject({
      used: null,
      note: "Disabled",
    });
    expect(extraTile(null, "ok", TZ)).toMatchObject({ used: null, note: "No data" });
    for (const [inactive, note] of [
      ["no_credit", "No credit"],
      ["limit_reached", "Limit hit"],
      ["disabled", "Disabled"],
      ["other", "Inactive"],
    ] as const)
      expect(extraTile({ ...view, enabled: false, inactive }, "ok", TZ)).toMatchObject({
        used: null,
        note,
      });
    expect(extraTile(null, "expired", TZ).note).toBe("Sign in");
    expect(
      extraTile({ ...view, stale: true, receivedAt: Date.UTC(2026, 9, 10, 19, 0) }, "ok", TZ).note,
    ).toBe("As of 21:00");
  });
});

describe("format", () => {
  it("formats durations with d for days", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(59_000)).toBe("1m");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
    expect(formatDuration(-1)).toBe("0m");
  });

  it("formats money and clock times as on the English tiles", () => {
    expect(formatMoney(1234.56, "EUR")).toBe("€1,234.56");
    expect(formatMoney(5, "USD")).toBe("$5.00");
    expect(formatClock(Date.UTC(2026, 9, 10, 7, 5), TZ)).toBe("09:05");
  });
});
