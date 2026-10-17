import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const servers: Server[] = [];
vi.mock("node:http", async (orig) => {
  const actual = await orig<typeof import("node:http")>();
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const s = actual.createServer(...args);
      servers.push(s);
      return s;
    },
  };
});

import { createIngress } from "../src/http/ingress";
import { Hub } from "../src/hub";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
  servers.length = 0;
});

describe("ingress server errors after listen", () => {
  it("routes a later server error to onError instead of crashing", async () => {
    const errors: unknown[] = [];
    const hub = new Hub();
    const ing = createIngress({
      token: "t",
      now: () => 1,
      onEnvelope: () => {},
      onInvalid: () => {},
      state: () => hub.state(1),
      debugHtml: () => "",
      onError: (e) => errors.push(e),
    });
    close = ing.close;
    await ing.listen(0);
    const boom = new Error("late server error");
    expect(() => servers[0]?.emit("error", boom)).not.toThrow();
    expect(errors).toEqual([boom]);
  });

  it("survives an onError that throws", async () => {
    const ing = createIngress({
      token: "t",
      now: () => 1,
      onEnvelope: () => {},
      onInvalid: () => {},
      state: () => new Hub().state(1),
      debugHtml: () => "",
      onError: () => {
        throw new Error("reporter broke");
      },
    });
    close = ing.close;
    await ing.listen(0);
    expect(() => servers[0]?.emit("error", new Error("x"))).not.toThrow();
  });
});
