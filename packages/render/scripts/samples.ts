import type { SessionState, SessionView } from "@vibetribe/core";
import { extraTile, inboxTile, limitTile, slotTile } from "../src/fromCore";
import type { Tile } from "../src/model";
import { REFERENCE_SAMPLES } from "./reference-samples";

const NOW = Date.UTC(2026, 9, 10, 12, 0);
const TZ = "Europe/Berlin";

const base: SessionView = {
  id: "g",
  key: { host: "wsl:Ubuntu", sessionId: "g" },
  hostKind: "wsl",
  badge: "WSL",
  title: "Mobile Entwicklung Northwind",
  cwd: "/home/heinrich/dev/projects/acme",
  state: "idle",
  detail: null,
  errorType: null,
  episodeSince: NOW - 65_000,
  episodeSeen: false,
  background: { count: 0, kinds: { shell: 0, agent: 0, monitor: 0, other: 0 }, stale: false },
  pid: 1,
  entrypoint: "claude-desktop",
  hostSessionId: null,
  bridgeSessionId: null,
};

const STATES: SessionState[] = [
  "needs_permission",
  "needs_input",
  "error",
  "done_unseen",
  "throttled",
  "working",
  "background",
  "idle",
  "no_signal",
];
const bg = { count: 3, kinds: { shell: 2, agent: 1, monitor: 0, other: 0 }, stale: false };
const still = { now: NOW, animated: false };

/** Tiles built from core views the way the deck builds them (English notes, seconds, flashes). */
export const CORE_SAMPLES: [string, Tile][] = [
  ...STATES.map((state): [string, Tile] => [
    `core-slot-${state}`,
    slotTile(
      {
        ...base,
        state,
        detail: state === "working" ? "Bash" : null,
        errorType:
          state === "error" ? "billing_error" : state === "throttled" ? "rate_limit" : null,
        background: state === "background" || state === "done_unseen" ? bg : base.background,
      },
      { ...still, tick: 1 },
    ),
  ]),
  [
    "core-slot-breath-low",
    slotTile(
      { ...base, state: "needs_permission", episodeSince: NOW },
      { now: NOW, animated: true },
    ),
  ],
  ["core-slot-seen", slotTile({ ...base, state: "needs_permission", episodeSeen: true }, still)],
  [
    "core-slot-jumping",
    slotTile({ ...base, state: "done_unseen" }, { ...still, flash: "jumping" }),
  ],
  [
    "core-slot-no-link",
    slotTile({ ...base, state: "needs_input" }, { ...still, flash: "no_target" }),
  ],
  [
    "core-slot-remote",
    slotTile(
      {
        ...base,
        badge: "REM",
        hostKind: "remote",
        state: "needs_input",
        title: "Partner-Akquise Handoff fortführen",
        pid: null,
      },
      still,
    ),
  ],
  ["core-slot-japanese", slotTile({ ...base, title: "日本語のプロジェクト" }, still)],
  [
    "core-inbox",
    inboxTile(
      { top: { ...base, state: "needs_permission" }, waitingCount: 3, overflowCount: 2 },
      { now: NOW },
    ),
  ],
  [
    "core-inbox-cycling-no-link",
    inboxTile(
      { top: { ...base, state: "needs_input" }, waitingCount: 3, overflowCount: 0 },
      { now: NOW, flash: "no_target", cycle: { index: 2, total: 3 } },
    ),
  ],
  [
    "core-inbox-opening",
    inboxTile(
      { top: { ...base, state: "error" }, waitingCount: 1, overflowCount: 4 },
      { now: NOW, flash: "jumping" },
    ),
  ],
  ["core-inbox-empty", inboxTile({ top: null, waitingCount: 0, overflowCount: 0 }, { now: NOW })],
  [
    "core-limit-5h",
    limitTile(
      "5h",
      {
        id: "five_hour",
        usedPct: 62,
        resetsAt: NOW + 4_320_000,
        pacePct: 40,
        aheadOfPlan: true,
        level: "amber",
        stale: false,
        receivedAt: NOW,
        rolledOver: false,
      },
      "ok",
      NOW,
      TZ,
    ),
  ],
  [
    "core-limit-week-red",
    limitTile(
      "Week",
      {
        id: "seven_day",
        usedPct: 91,
        resetsAt: NOW + 2 * 86_400_000,
        pacePct: 70,
        aheadOfPlan: true,
        level: "red",
        stale: false,
        receivedAt: NOW,
        rolledOver: false,
      },
      "ok",
      NOW,
      TZ,
    ),
  ],
  ["core-limit-expired", limitTile("5h", null, "expired", NOW, TZ)],
  [
    "core-extra",
    extraTile(
      {
        enabled: true,
        usedCredits: 12.4,
        monthlyLimit: 50,
        currency: "EUR",
        stale: false,
        receivedAt: NOW,
      },
      "ok",
      TZ,
    ),
  ],
  [
    "core-extra-disabled",
    extraTile(
      {
        enabled: false,
        usedCredits: 0,
        monthlyLimit: null,
        currency: "EUR",
        stale: false,
        receivedAt: NOW,
      },
      "ok",
      TZ,
    ),
  ],
  [
    "core-extra-no-credit",
    extraTile(
      {
        enabled: false,
        usedCredits: 0,
        monthlyLimit: 50,
        currency: "EUR",
        inactive: "no_credit",
        stale: false,
        receivedAt: NOW,
      },
      "ok",
      TZ,
    ),
  ],
  [
    "core-extra-limit-reached",
    extraTile(
      {
        enabled: false,
        usedCredits: 0,
        monthlyLimit: 50,
        currency: "EUR",
        inactive: "limit_reached",
        stale: false,
        receivedAt: NOW,
      },
      "ok",
      TZ,
    ),
  ],
  [
    "core-extra-inactive",
    extraTile(
      {
        enabled: false,
        usedCredits: 0,
        monthlyLimit: 50,
        currency: "EUR",
        inactive: "other",
        stale: false,
        receivedAt: NOW,
      },
      "ok",
      TZ,
    ),
  ],
  [
    "core-status-expanded-alert",
    {
      kind: "status",
      expanded: true,
      alert: "No token",
      rows: [
        { source: "WIN", health: "missing" },
        { source: "WSL", health: "missing" },
        { source: "REM", health: "off" },
        { source: "LIM", health: "stale" },
      ],
    },
  ],
];

/**
 * Every tile the gallery shows and `pnpm tiles:measure` checks: the 52 reference models of the
 * Claude Design handoff plus the tiles built from core views.
 */
export const GALLERY_SAMPLES: [string, Tile][] = [
  ...Object.entries(REFERENCE_SAMPLES),
  ...CORE_SAMPLES,
];
