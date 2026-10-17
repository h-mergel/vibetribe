import { describe, expect, it } from "vitest";
import { detectHost } from "../src/host";

describe("detectHost", () => {
  it("detects windows, wsl and mac", () => {
    expect(detectHost("win32", {}, "PC")).toEqual({ os: "windows", distro: null, hostname: "PC" });
    expect(detectHost("linux", { WSL_DISTRO_NAME: "Ubuntu" }, "PC")).toEqual({
      os: "wsl",
      distro: "Ubuntu",
      hostname: "PC",
    });
    expect(detectHost("darwin", {}, "mbp")).toEqual({ os: "mac", distro: null, hostname: "mbp" });
  });

  it("does not support plain linux in v1", () => {
    expect(detectHost("linux", {}, "box")).toBeNull();
  });
});
