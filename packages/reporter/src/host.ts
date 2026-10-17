import type { OsKind } from "@vibetribe/protocol";
import type { Env } from "./env";

export interface HostInfo {
  os: OsKind;
  distro: string | null;
  hostname: string;
}

/** Plain Linux (no WSL) is not supported in v1. */
export function detectHost(platform: string, env: Env, hostname: string): HostInfo | null {
  if (platform === "win32") return { os: "windows", distro: null, hostname };
  if (platform === "darwin") return { os: "mac", distro: null, hostname };
  if (platform === "linux" && env.WSL_DISTRO_NAME)
    return { os: "wsl", distro: env.WSL_DISTRO_NAME, hostname };
  return null;
}
