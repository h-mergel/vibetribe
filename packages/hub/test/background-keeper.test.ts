import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKGROUND_RETRY_MS,
  type BackgroundPorts,
  keepBackgrounds,
} from "../src/background/keeper";
import {
  BACKGROUND_REFRESH_MS,
  parseBackgrounds,
  serializeBackgrounds,
} from "../src/background/records";
import { Hub } from "../src/hub";
import { ingressError, type RunningHub, startHub } from "../src/runtime";
import { HOST, hook, jobs, KEY, savedFile, scan, T } from "./background-fixtures";

const settle = () => new Promise((r) => setTimeout(r, 0));

/** keepBackgrounds on a fresh hub with a controllable clock; `saves` collects every write. */
async function kept(
  load: BackgroundPorts["load"],
  save?: BackgroundPorts["save"],
  canSave?: () => boolean,
) {
  const hub = new Hub();
  const saves: string[] = [];
  const lines: string[] = [];
  let clock = T;
  await keepBackgrounds({
    hub,
    ports: {
      load,
      save:
        save ??
        (async (text) => {
          saves.push(text);
        }),
    },
    now: () => clock,
    log: (l) => lines.push(l),
    canSave,
  });
  return { hub, saves, lines, at: (t: number) => (clock = t) };
}

describe("keepBackgrounds", () => {
  it("restores the saved file and writes only when the job lists change", async () => {
    const { hub, saves } = await kept(async () => serializeBackgrounds(savedFile));
    hub.ingestSnapshot(scan(T));
    expect(jobs(hub, T)?.count).toBe(2);
    hub.ingest(hook("SubagentStop", [{ id: "b1", type: "shell" }]), T + 1_000);
    await settle();
    hub.ingest(hook("UserPromptSubmit"), T + 2_000);
    hub.ingest(hook("Stop", []), T + 3_000);
    await settle();
    expect(saves.map((w) => parseBackgrounds(w)?.records)).toEqual([
      [{ key: KEY, tasks: [{ id: "b1", kind: "shell" }], changedAt: T + 1_000 }],
      [],
    ]);
  });

  it("rewrites the file every 10 min while jobs run, so the save time measures the downtime", async () => {
    const { hub, saves, at } = await kept(async () => null);
    hub.ingestSnapshot(scan(T));
    hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
    await settle();
    at(T + BACKGROUND_REFRESH_MS - 1);
    hub.ingestSnapshot(scan(T + BACKGROUND_REFRESH_MS - 1));
    await settle();
    at(T + BACKGROUND_REFRESH_MS);
    hub.ingestSnapshot(scan(T + BACKGROUND_REFRESH_MS));
    await settle();
    expect(saves.map((w) => parseBackgrounds(w)?.savedAt)).toEqual([T, T + BACKGROUND_REFRESH_MS]);
  });

  it("retries a failed write at most every 30 s while it keeps failing and logs the failure once", async () => {
    let fail = 2;
    let attempts = 0;
    const saves: string[] = [];
    const { hub, lines, at } = await kept(
      async () => null,
      async (text) => {
        attempts++;
        if (fail-- > 0) throw new Error("EBUSY");
        saves.push(text);
      },
    );
    const scanAt = async (t: number) => {
      at(t);
      hub.ingestSnapshot(scan(t));
      await settle();
    };
    hub.ingestSnapshot(scan(T));
    hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
    await settle();
    // the scans notify every few seconds: no new attempt within BACKGROUND_RETRY_MS
    for (const t of [T + 1_500, T + 5_000, T + BACKGROUND_RETRY_MS - 1]) await scanAt(t);
    expect(attempts).toBe(1);
    await scanAt(T + BACKGROUND_RETRY_MS);
    expect(attempts).toBe(2);
    await scanAt(T + 2 * BACKGROUND_RETRY_MS - 1);
    expect(attempts).toBe(2);
    await scanAt(T + 2 * BACKGROUND_RETRY_MS);
    expect(attempts).toBe(3);
    // saved again: the next change is written at once
    at(T + 2 * BACKGROUND_RETRY_MS + 1_000);
    hub.ingest(hook("Stop", []), T + 2 * BACKGROUND_RETRY_MS + 1_000);
    await settle();
    expect(saves.map((w) => parseBackgrounds(w)?.records.length)).toEqual([1, 0]);
    expect(lines).toEqual([
      "background file not saved: Error: EBUSY",
      "background file saved again",
    ]);
  });

  it("a clock set back while writes fail does not block the retry for the size of the jump", async () => {
    let fail = true;
    const saves: string[] = [];
    const { hub, at } = await kept(
      async () => null,
      async (text) => {
        if (fail) {
          fail = false;
          throw new Error("EBUSY");
        }
        saves.push(text);
      },
    );
    hub.ingestSnapshot(scan(T));
    hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
    await settle();
    at(T - 3_600_000);
    hub.ingestSnapshot(scan(T - 3_600_000));
    await settle();
    expect(saves).toHaveLength(1);
  });

  it("retries a failed write of the empty list, so ended jobs do not come back after a restart", async () => {
    let fail = false;
    const saves: string[] = [];
    const { hub, at } = await kept(
      async () => null,
      async (text) => {
        if (fail) {
          fail = false;
          throw new Error("EPERM");
        }
        saves.push(text);
      },
    );
    hub.ingestSnapshot(scan(T));
    hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
    await settle();
    fail = true;
    at(T + 1_000);
    hub.ingest(hook("Stop", []), T + 1_000);
    await settle();
    // no jobs left, so no 10 min refresh: only the retry writes the empty list
    at(T + 1_000 + BACKGROUND_RETRY_MS);
    hub.ingestSnapshot(scan(T + 1_000 + BACKGROUND_RETRY_MS));
    await settle();
    expect(saves.map((w) => parseBackgrounds(w)?.records.length)).toEqual([1, 0]);
  });

  it("writes nothing while canSave says no, and catches up with the next change once it says yes", async () => {
    let up = false;
    const { hub, saves } = await kept(
      async () => null,
      undefined,
      () => up,
    );
    hub.ingestSnapshot(scan(T));
    hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
    await settle();
    expect(saves).toEqual([]);
    up = true;
    hub.ingestSnapshot(scan(T));
    await settle();
    expect(saves.map((w) => parseBackgrounds(w)?.records.length)).toEqual([1]);
  });

  it("logs an unreadable or corrupt file once and runs on without it", async () => {
    const broken = await kept(async () => {
      throw new Error("EACCES");
    });
    const corrupt = await kept(async () => "{ not json");
    for (const { hub, lines } of [broken, corrupt]) {
      hub.ingestSnapshot(scan(T));
      hub.ingestSnapshot(scan(T + 5_000));
      expect(lines).toHaveLength(1);
      expect(jobs(hub, T + 5_000)?.count).toBe(0);
    }
    expect(broken.lines).toEqual(["background file unreadable: Error: EACCES"]);
    expect(corrupt.lines).toEqual(["background file ignored: unreadable content"]);
  });
});

describe("startHub with saved background jobs", () => {
  let running: RunningHub | null = null;
  afterEach(async () => {
    await running?.stop();
    running = null;
  });

  it("shows the saved job after the first scan of a restarted hub", async () => {
    running = await startHub({
      port: 0,
      token: "t",
      sources: [
        {
          name: "sessions:wsl:Ubuntu",
          host: HOST,
          hostKind: "wsl",
          scan: async (now) => scan(now),
        },
      ],
      usage: null,
      now: () => T,
      background: { load: async () => serializeBackgrounds(savedFile), save: async () => {} },
    });
    const hub = running.hub;
    await new Promise((r) => setTimeout(r, 50));
    expect(jobs(hub, T)?.count).toBe(2);
  });

  it("a hub whose listener failed to bind (port in use) never writes the file; one that listens does", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const taken = (blocker.address() as AddressInfo).port;
    const run = async (port: number) => {
      const saves: string[] = [];
      running = await startHub({
        port,
        token: "t",
        sources: [],
        usage: null,
        now: () => T,
        background: {
          load: async () => null,
          save: async (text) => {
            saves.push(text);
          },
        },
      });
      const portError = ingressError(running, T);
      running.hub.ingestSnapshot(scan(T));
      running.hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
      await settle();
      await running.stop();
      running = null;
      return { saves, portError };
    };
    try {
      const lost = await run(taken);
      expect(lost.portError).toMatch(/^Port \d+ in use or blocked/);
      expect(lost.saves).toEqual([]);
      const ok = await run(0);
      expect(ok.portError).toBeNull();
      expect(ok.saves).toHaveLength(1);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  it("a stopped hub never writes the file, even when a late poll still changes the jobs", async () => {
    const saves: string[] = [];
    running = await startHub({
      port: 0,
      token: "t",
      sources: [],
      usage: null,
      now: () => T,
      background: {
        load: async () => null,
        save: async (text) => {
          saves.push(text);
        },
      },
    });
    const hub = running.hub;
    hub.ingestSnapshot(scan(T));
    hub.ingest(hook("Stop", [{ id: "b1", type: "shell" }]), T);
    await settle();
    expect(saves).toHaveLength(1);
    await running.stop();
    running = null;
    hub.ingest(hook("Stop", [{ id: "b2", type: "shell" }]), T);
    await settle();
    expect(saves).toHaveLength(1);
  });
});
