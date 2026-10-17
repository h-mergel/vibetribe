import { describe, expect, it } from "vitest";
import { LimitsStore, levelOf, WINDOW_MS } from "../src/limits";

const H = 3_600_000;

describe("levelOf", () => {
  it("neutral < 60, amber < 85, red >= 85", () => {
    expect(levelOf(59.9)).toBe("neutral");
    expect(levelOf(60)).toBe("amber");
    expect(levelOf(84.9)).toBe("amber");
    expect(levelOf(85)).toBe("red");
  });
});

describe("LimitsStore windows", () => {
  it("computes pace and ahead-of-plan from resetsAt", () => {
    const s = new LimitsStore();
    // window started 1h ago (resets in 4h) -> pace 20 %
    s.ingestEndpoint({ fiveHour: { usedPct: 35, resetsAt: 4 * H } }, 0);
    const w = s.window("five_hour", 0);
    expect(w?.pacePct).toBeCloseTo(20);
    expect(w?.aheadOfPlan).toBe(true);
    expect(w?.level).toBe("neutral");
    expect(w?.stale).toBe(false);
  });

  it("newest reading wins across sources", () => {
    const s = new LimitsStore();
    s.ingestStatusline({ fiveHour: { usedPct: 50, resetsAt: 4 * H } }, 2_000);
    s.ingestEndpoint({ fiveHour: { usedPct: 40, resetsAt: 4 * H } }, 1_000);
    expect(s.window("five_hour", 2_000)?.usedPct).toBe(50);
  });

  it("rolls over to 0 % once resetsAt has passed", () => {
    const s = new LimitsStore();
    s.ingestEndpoint({ sevenDay: { usedPct: 95, resetsAt: 10_000 } }, 0);
    expect(s.window("seven_day", 10_000)).toMatchObject({
      usedPct: 0,
      resetsAt: null,
      pacePct: null,
      rolledOver: true,
    });
  });

  it("a statusline snapshot without the window after reset means a new window", () => {
    const s = new LimitsStore();
    s.ingestStatusline({ fiveHour: { usedPct: 80, resetsAt: 5_000 } }, 0);
    s.ingestStatusline({}, 6_000);
    expect(s.window("five_hour", 6_000)).toMatchObject({
      usedPct: 0,
      resetsAt: null,
      rolledOver: true,
    });
  });

  it("marks windows stale after 15 minutes", () => {
    const s = new LimitsStore();
    s.ingestEndpoint({ fiveHour: { usedPct: 10, resetsAt: 4 * H } }, 0);
    expect(s.window("five_hour", 15 * 60_000)?.stale).toBe(false);
    expect(s.window("five_hour", 15 * 60_000 + 1)?.stale).toBe(true);
  });

  it("clamps implausible percentages to 0..100", () => {
    const s = new LimitsStore();
    s.ingestEndpoint(
      {
        fiveHour: { usedPct: 140, resetsAt: 4 * H },
        sevenDay: { usedPct: -3, resetsAt: WINDOW_MS.seven_day },
      },
      0,
    );
    expect(s.window("five_hour", 0)?.usedPct).toBe(100);
    expect(s.window("seven_day", 0)?.usedPct).toBe(0);
  });

  it("returns null without any reading", () => {
    expect(new LimitsStore().window("five_hour", 0)).toBeNull();
  });
});

describe("LimitsStore extra usage and auth", () => {
  it("keeps extra usage and marks it stale after 10 minutes", () => {
    const s = new LimitsStore();
    s.ingestEndpoint(
      { extra: { enabled: true, usedCredits: 12.4, monthlyLimit: 50, currency: "EUR" } },
      0,
    );
    expect(s.extra(600_000)).toMatchObject({
      usedCredits: 12.4,
      monthlyLimit: 50,
      currency: "EUR",
      stale: false,
    });
    expect(s.extra(600_001)?.stale).toBe(true);
  });

  it("carries the inactive reason into the view", () => {
    const s = new LimitsStore();
    s.ingestEndpoint(
      {
        extra: {
          enabled: false,
          usedCredits: 0,
          monthlyLimit: 50,
          currency: "EUR",
          inactive: "no_credit",
        },
      },
      0,
    );
    expect(s.extra(1)?.inactive).toBe("no_credit");
  });

  it("auth expires on demand and recovers with the next endpoint reading", () => {
    const s = new LimitsStore();
    s.setAuthExpired();
    expect(s.auth).toBe("expired");
    s.ingestEndpoint({}, 1);
    expect(s.auth).toBe("ok");
  });
});
