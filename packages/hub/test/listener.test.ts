import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  BIND_RETRY_MS,
  createListener,
  INGRESS_TOKEN_MESSAGE,
  ingressPortError,
  type Listener,
  type ListenerOptions,
} from "../src/http/listener";
import { Hub } from "../src/hub";

const blockers = new Set<Server>();
const listeners: Listener[] = [];
afterEach(async () => {
  for (const l of listeners.splice(0)) await l.close();
  for (const b of blockers) await new Promise((r) => b.close(r));
  blockers.clear();
});

/** A port this test holds, so the listener cannot bind it. */
async function block(): Promise<{ port: number; release: () => Promise<void> }> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  blockers.add(s);
  return {
    port: (s.address() as { port: number }).port,
    release: () =>
      new Promise<void>((r) => {
        blockers.delete(s);
        s.close(() => r());
      }),
  };
}

function setup(over: Partial<ListenerOptions> = {}) {
  const hub = new Hub();
  const lines: string[] = [];
  const saved: number[] = [];
  const retries: { ms: number; retry: () => Promise<void> }[] = [];
  const listener = createListener({
    hub,
    ports: [0],
    token: "t",
    tokenMissing: false,
    savePort: async (port) => {
      saved.push(port);
    },
    mirror: undefined,
    now: () => 1,
    log: (l) => lines.push(l),
    later: (ms, retry) => retries.push({ ms, retry }),
    ...over,
  });
  listeners.push(listener);
  const health = () => hub.state(1).sources.ingress;
  /** runs the one scheduled attempt, as the hub's timer would after BIND_RETRY_MS */
  const retryNow = async (): Promise<void> => {
    const next = retries.shift();
    expect(next?.ms).toBe(BIND_RETRY_MS);
    await next?.retry();
  };
  return { listener, lines, saved, health, retries, retryNow };
}

describe("createListener", () => {
  it("tries the ports in order, takes the first that binds, records it and logs the refused ones", async () => {
    const a = await block();
    const b = await block();
    const { listener, lines, saved, health } = setup({ ports: [a.port, b.port, 0, a.port] });
    await listener.listen();
    const port = listener.port;
    expect(port).not.toBeNull();
    expect([a.port, b.port]).not.toContain(port);
    expect(health()).toMatchObject({ health: "ok", error: null });
    expect(saved).toEqual([port]);
    expect(lines).toEqual([
      `hub listening on 127.0.0.1:${port} (${a.port} EADDRINUSE, ${b.port} EADDRINUSE)`,
    ]);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });

  it("the first port free: no refusals in the log line", async () => {
    const { listener, lines } = setup();
    await listener.listen();
    expect(lines).toEqual([`hub listening on 127.0.0.1:${listener.port}`]);
  });

  it("a close while a bind is pending leaves nothing listening and records nothing", async () => {
    const { listener, lines, saved } = setup();
    const attempt = listener.listen();
    await listener.close();
    await attempt;
    expect(listener.port).toBeNull();
    expect(saved).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("a close while a refused bind is pending tries no further port, logs nothing and schedules no retry", async () => {
    const a = await block();
    const b = await block();
    const { listener, lines, health, retries } = setup({ ports: [a.port, b.port] });
    const attempt = listener.listen();
    await listener.close();
    await attempt;
    expect(lines).toEqual([]);
    expect(health()?.error ?? null).toBeNull();
    expect(retries).toEqual([]);
  });

  it("the port is null after close", async () => {
    const { listener } = setup();
    await listener.listen();
    expect(listener.port).not.toBeNull();
    await listener.close();
    expect(listener.port).toBeNull();
  });

  it("no port free: no port, the port error as health, nothing recorded, one retry scheduled", async () => {
    const a = await block();
    const b = await block();
    const { listener, lines, saved, health, retries } = setup({ ports: [a.port, b.port] });
    await listener.listen();
    expect(listener.port).toBeNull();
    const error = ingressPortError([
      { port: a.port, code: "EADDRINUSE" },
      { port: b.port, code: "EADDRINUSE" },
    ]);
    expect(error).toBe(
      `Port ${a.port}, ${b.port} in use or blocked (EADDRINUSE, EADDRINUSE; check the WSL port range and netsh excludedportrange)`,
    );
    expect(health()?.error).toBe(error);
    expect(saved).toEqual([]);
    expect(lines).toEqual([
      `ingress failed: ${a.port} EADDRINUSE, ${b.port} EADDRINUSE; retrying every 5 s`,
    ]);
    expect(retries.map((r) => r.ms)).toEqual([BIND_RETRY_MS]);
  });

  it("retries all ports until one binds, logs a lasting failure once, then records the port", async () => {
    const a = await block();
    const b = await block();
    const { listener, lines, saved, health, retries, retryNow } = setup({
      ports: [a.port, b.port],
    });
    await listener.listen();
    await retryNow();
    await retryNow();
    expect(listener.port).toBeNull();
    expect(lines).toHaveLength(1);
    await b.release();
    await retryNow();
    expect(listener.port).toBe(b.port);
    expect(health()).toMatchObject({ health: "ok", error: null });
    expect(saved).toEqual([b.port]);
    expect(lines.at(-1)).toBe(`hub listening on 127.0.0.1:${b.port} (${a.port} EADDRINUSE)`);
    expect(retries).toEqual([]);
  });

  it("a port file that cannot be written is logged; the ingress keeps listening", async () => {
    const { listener, lines, health } = setup({
      savePort: async () => {
        throw new Error("disk full");
      },
    });
    await listener.listen();
    expect(listener.port).not.toBeNull();
    expect(health()?.health).toBe("ok");
    expect(lines).toContain("port file not saved: Error: disk full");
  });

  it("a missing token is logged once and stays on the health, alone or after the port error", async () => {
    const bound = setup({ tokenMissing: true });
    await bound.listener.listen();
    expect(bound.health()?.error).toBe(INGRESS_TOKEN_MESSAGE);
    expect(bound.lines.filter((l) => l.startsWith("no token"))).toHaveLength(1);
    const a = await block();
    const lost = setup({ ports: [a.port], tokenMissing: true });
    await lost.listener.listen();
    expect(lost.health()?.error).toBe(
      `${ingressPortError([{ port: a.port, code: "EADDRINUSE" }])}; ${INGRESS_TOKEN_MESSAGE}`,
    );
  });

  it("a missing token stays on the health after a retry binds", async () => {
    const a = await block();
    const { listener, health, retryNow } = setup({ ports: [a.port], tokenMissing: true });
    await listener.listen();
    await a.release();
    await retryNow();
    expect(listener.port).toBe(a.port);
    expect(health()?.error).toBe(INGRESS_TOKEN_MESSAGE);
  });
});
