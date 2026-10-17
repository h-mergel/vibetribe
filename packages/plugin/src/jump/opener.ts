import { type SpawnOptions, spawn } from "node:child_process";
import { system32Exe } from "./system32";
import { isJumpUrl } from "./target";

/** How a jump went: handed to Windows, only logged (headless), or not started. */
export type JumpResult = "opened" | "logged" | "failed";

/**
 * Port (spec §3.1 `Jumper`): hands a claude:// link to the OS. Never rejects; the composition
 * marks the session seen unless the result is `failed`.
 */
export interface JumpOpener {
  open(url: string): Promise<JumpResult>;
}

/** The part of a child process the opener uses; node's ChildProcess satisfies it. */
export interface SpawnedChild {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
  unref(): void;
}

export type SpawnFn = (file: string, args: string[], options: SpawnOptions) => SpawnedChild;

const nodeSpawn: SpawnFn = (file, args, options) => spawn(file, args, options);

export function rundll32Path(env: NodeJS.ProcessEnv = process.env): string {
  return system32Exe("rundll32.exe", env);
}

/**
 * Windows adapter (the SDK's `openUrl` refuses custom schemes): `rundll32
 * url.dll,FileProtocolHandler <url>`, without a shell. Only links that pass `isJumpUrl` start a
 * process; the result is known once the process spawned or failed to.
 */
export function createRundll32Opener(
  log: (line: string) => void,
  spawnFn: SpawnFn = nodeSpawn,
  exe: string = rundll32Path(),
): JumpOpener {
  return {
    open(url) {
      if (!isJumpUrl(url)) {
        log(`jump refused: ${JSON.stringify(url.slice(0, 80))} is not a claude link`);
        return Promise.resolve("failed");
      }
      return new Promise((resolve) => {
        try {
          const child = spawnFn(exe, ["url.dll,FileProtocolHandler", url], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            shell: false,
          });
          // the error listener stays: an unhandled 'error' event would end the plugin
          child.once("error", (err) => {
            log(`jump failed: ${String(err)}`);
            resolve("failed");
          });
          child.once("spawn", () => {
            child.unref();
            resolve("opened");
          });
        } catch (err) {
          log(`jump failed: ${String(err)}`);
          resolve("failed");
        }
      });
    },
  };
}

/** Headless mode: never starts anything, only logs the link. */
export function createLoggingOpener(log: (line: string) => void): JumpOpener {
  return {
    open: async (url) => {
      log(`jump (headless, not opened): ${url}`);
      return "logged";
    },
  };
}
