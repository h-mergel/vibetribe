import { describe, expect, it } from "vitest";
import {
  BACKGROUND_RESTORE_MAX_AGE_MS,
  type BackgroundFile,
  PendingBackgrounds,
  parseBackgrounds,
  serializeBackgrounds,
} from "../src/background/records";
import { Hub } from "../src/hub";
import { HOST, hook, jobs, saved, savedFile, scan, T } from "./background-fixtures";

describe("background file format", () => {
  it("round-trips the save time, ids, kinds and the change time", () => {
    expect(parseBackgrounds(serializeBackgrounds(savedFile))).toEqual(savedFile);
  });

  it("returns null for an unreadable file and skips unreadable entries", () => {
    expect(parseBackgrounds("not json")).toBeNull();
    expect(parseBackgrounds('{"v":2,"savedAt":1,"sessions":[]}')).toBeNull();
    expect(parseBackgrounds('{"v":1,"sessions":[]}')).toBeNull();
    const mixed = {
      v: 1,
      savedAt: 7,
      sessions: [
        {
          host: HOST,
          sessionId: "ok",
          changedAt: 5,
          tasks: [{ id: "b", kind: "shell" }, { id: 3 }],
        },
        { host: HOST, sessionId: "bad-kind", changedAt: 5, tasks: [{ id: "b", kind: "bash" }] },
        { host: "", sessionId: "x", changedAt: 5, tasks: [{ id: "b", kind: "shell" }] },
        { host: HOST, sessionId: "no-time", tasks: [{ id: "b", kind: "shell" }] },
        null,
      ],
    };
    expect(parseBackgrounds(JSON.stringify(mixed))).toEqual({
      savedAt: 7,
      records: [
        { key: { host: HOST, sessionId: "ok" }, tasks: [{ id: "b", kind: "shell" }], changedAt: 5 },
      ],
    });
  });
});

describe("PendingBackgrounds", () => {
  it("hands records to the first scan of their host that lists the session, drops the rest", () => {
    const p = new PendingBackgrounds();
    const other = { ...saved, key: { host: "win", sessionId: "w1" } };
    const gone = { ...saved, key: { host: HOST, sessionId: "ended" } };
    p.load({ savedAt: T, records: [saved, other, gone] }, T);
    expect(p.takeForScan(scan(T))).toEqual([saved]);
    expect(p.all(T)).toEqual([{ ...other, savedAt: T }]);
  });

  it("measures the downtime, not the job age: an old job from a fresh file is restored", () => {
    const p = new PendingBackgrounds();
    p.load({ savedAt: T - BACKGROUND_RESTORE_MAX_AGE_MS, records: [saved] }, T);
    expect(p.all(T)).toEqual([]);
    const old = { ...saved, changedAt: T - 2 * BACKGROUND_RESTORE_MAX_AGE_MS };
    p.load({ savedAt: T - 60_000, records: [old] }, T);
    expect(p.all(T)).toEqual([{ ...old, savedAt: T - 60_000 }]);
  });
});

describe("Hub background restore (Plan 7)", () => {
  it("a session with a job before the restart shows it again after the first scan", () => {
    const hub = new Hub();
    hub.restoreBackgrounds(savedFile, T);
    expect(hub.backgrounds(T)).toEqual([{ ...saved, savedAt: savedFile.savedAt }]);
    hub.ingestSnapshot(scan(T));
    expect(hub.state(T).sessions[0]?.state).toBe("background");
    expect(jobs(hub, T)).toMatchObject({ count: 2, kinds: { shell: 1, agent: 1 }, stale: false });
    expect(hub.backgrounds(T)).toEqual([saved]);
  });

  it("a live job list from a hook wins over the saved one", () => {
    const hub = new Hub();
    hub.restoreBackgrounds(savedFile, T);
    hub.ingest(hook("Stop", []), T);
    hub.ingestSnapshot(scan(T + 1_000));
    expect(jobs(hub, T + 1_000)?.count).toBe(0);
    expect(hub.backgrounds(T)).toEqual([]);
  });

  it("a session missing from its host's scan has ended: nothing is restored or kept", () => {
    const hub = new Hub();
    hub.restoreBackgrounds(savedFile, T);
    hub.ingestSnapshot(scan(T, []));
    hub.ingestSnapshot(scan(T + 5_000));
    expect(jobs(hub, T + 5_000)?.count).toBe(0);
    expect(hub.backgrounds(T)).toEqual([]);
  });
});

describe("pending jobs of a host that never scans (R3)", () => {
  const H = 3_600_000;

  it("keep their original save time when the file is rewritten, and expire after 6 h", () => {
    const hub = new Hub();
    hub.restoreBackgrounds(savedFile, T);
    // two hours on, the keeper rewrites the file: the pending record keeps the old save time
    expect(hub.backgrounds(T + 2 * H)).toEqual([{ ...saved, savedAt: savedFile.savedAt }]);
    const text = serializeBackgrounds({ savedAt: T + 2 * H, records: hub.backgrounds(T + 2 * H) });
    expect(parseBackgrounds(text)?.records[0]?.savedAt).toBe(savedFile.savedAt);
    // the 10 min refresh never revives them: 6 h after the ORIGINAL save they are gone
    expect(hub.backgrounds(savedFile.savedAt + 6 * H)).toEqual([]);
    // and a restart reading the rewritten file drops them as well
    const next = new Hub();
    next.restoreBackgrounds(parseBackgrounds(text) as BackgroundFile, savedFile.savedAt + 6 * H);
    expect(next.backgrounds(savedFile.savedAt + 6 * H)).toEqual([]);
  });

  it("are not restored by a scan once they are older than 6 h", () => {
    const hub = new Hub();
    hub.restoreBackgrounds(savedFile, T);
    hub.ingestSnapshot(scan(savedFile.savedAt + 6 * H));
    expect(jobs(hub, savedFile.savedAt + 6 * H)?.count).toBe(0);
  });

  it("count as expired when the save time lies in the future (clock set back)", () => {
    const p = new PendingBackgrounds();
    p.load({ savedAt: T + 1, records: [saved] }, T);
    expect(p.all(T)).toEqual([]);
    const q = new PendingBackgrounds();
    q.load({ savedAt: T - 60_000, records: [{ ...saved, savedAt: T + 1 }] }, T);
    expect(q.all(T)).toEqual([]);
  });

  it("are dropped when a SubagentStop names their agent; the other jobs stay", () => {
    const hub = new Hub();
    hub.restoreBackgrounds(savedFile, T);
    hub.ingest(
      { ...hook("SubagentStop"), event: { ...hook("SubagentStop").event, agentId: "a1" } },
      T,
    );
    expect(hub.backgrounds(T)).toEqual([
      { ...saved, tasks: [{ id: "b1", kind: "shell" }], savedAt: savedFile.savedAt },
    ]);
  });
});

describe("serializeBackgrounds writes ids and kinds only (R3)", () => {
  it("drops every other task field", () => {
    const dirty = {
      savedAt: T,
      records: [{ ...saved, tasks: [{ id: "b1", kind: "shell", command: "secret" }] }],
    };
    // biome-ignore lint/suspicious/noExplicitAny: a task with extra fields from a wider source
    const text = serializeBackgrounds(dirty as any);
    expect(JSON.parse(text).sessions[0].tasks).toEqual([{ id: "b1", kind: "shell" }]);
  });
});
