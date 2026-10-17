import { execFileSync } from "node:child_process";
import { createServer, Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUARDED_PORTS } from "../../../test/real-ports-guard.mjs";
import { DEFAULT_PORT } from "../src/port";

describe("real ports guard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses a request to the hub's first port before a socket opens", async () => {
    expect(GUARDED_PORTS).toContain(DEFAULT_PORT);
    await expect(fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`)).rejects.toMatchObject({
      cause: { message: `test guard: port ${DEFAULT_PORT} belongs to the real hub` },
    });
  });

  it("refuses a request to a host other than loopback before a socket opens", async () => {
    await expect(fetch("http://192.0.2.1/")).rejects.toMatchObject({
      cause: { message: "test guard: 192.0.2.1 is not a loopback host" },
    });
  });

  it("is loaded by the node processes the tests spawn", () => {
    const loaded = execFileSync(
      process.execPath,
      ["-e", 'console.log(!!globalThis[Symbol.for("vibetribe.realPortsGuard")])'],
      { encoding: "utf8" },
    );
    expect(loaded.trim()).toBe("true");
  });

  it("rebinds a port-0 listener the OS put on a guarded port, unnoticed by its caller", async () => {
    vi.spyOn(Server.prototype, "address").mockReturnValueOnce({
      address: "127.0.0.1",
      family: "IPv4",
      port: DEFAULT_PORT,
    });
    const server = createServer();
    const events: string[] = [];
    server.on("listening", () => events.push("listening"));
    server.on("close", () => events.push("close"));
    let callbacks = 0;
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => {
        callbacks++;
        resolve();
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    const port = (server.address() as { port: number }).port;
    expect(port).not.toBe(DEFAULT_PORT);
    expect(callbacks).toBe(1);
    expect(events).toEqual(["listening"]);
    await new Promise((resolve) => server.close(resolve));
  });
});
