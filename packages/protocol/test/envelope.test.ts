import { describe, expect, it } from "vitest";
import { hostId } from "../src/envelope";

describe("hostId", () => {
  it("builds the host ids shared by reporter and hub", () => {
    expect(hostId("windows", null, "DRAGONFLY-PC")).toBe("win");
    expect(hostId("wsl", "Ubuntu", "DRAGONFLY-PC")).toBe("wsl:Ubuntu");
    expect(hostId("mac", null, "MacBook-Pro.local")).toBe("mac:macbook-pro.local");
    expect(hostId("wsl", null, "x")).toBe("wsl:unknown");
  });
});
