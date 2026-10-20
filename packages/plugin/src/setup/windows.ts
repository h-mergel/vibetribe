import { existsSync } from "node:fs";
import {
  detectGitBash,
  execText,
  install,
  type SetupEnv,
  SetupError,
  type SetupState,
  setupState,
  uninstall,
} from "@vibetribe/reporter/setup";

/** What one setup step reports to the property inspector (a type: it travels as JSON). */
export type SetupResult = {
  ok: boolean;
  text: string;
};

/** Claude Code's hooks on this Windows user: read the state, install, remove. */
export interface WindowsSetup {
  state(): SetupState;
  install(): SetupResult;
  uninstall(): SetupResult;
}

export interface WindowsSetupOptions {
  home: string;
  /** the reporter bundle the plugin carries */
  reporterSource: string;
  /** the Node running the plugin (Stream Deck's) and its version; the hooks run a copy of it */
  nodePath: string;
  nodeVersion: string;
  log: (line: string) => void;
  /** Seam: Git Bash for a displaced statusline; defaults to the real lookup */
  gitBash?: () => string | null;
  now?: () => Date;
}

/** The reporter's own setup, run inside the plugin; failures come back as text, never thrown. */
export function windowsSetup(o: WindowsSetupOptions): WindowsSetup {
  const env = (): SetupEnv => ({
    home: o.home,
    platform: "win32",
    wsl: false,
    nodePath: o.nodePath,
    copyNode: { version: o.nodeVersion },
    reporterSource: o.reporterSource,
    windowsHome: null,
    now: o.now?.() ?? new Date(),
    log: o.log,
    gitBash:
      o.gitBash ??
      (() =>
        detectGitBash({ platform: "win32", env: process.env, exists: existsSync, exec: execText })),
  });
  const run = (step: (e: SetupEnv) => void, done: string): SetupResult => {
    try {
      step(env());
      return { ok: true, text: done };
    } catch (err) {
      o.log(`setup failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        ok: false,
        text: err instanceof SetupError ? err.message : `Setup failed: ${String(err)}`,
      };
    }
  };
  return {
    state: () => setupState(o.home, o.reporterSource),
    install: () => run(install, "Hooks installed for Claude Code on Windows."),
    uninstall: () => run(uninstall, "Hooks removed from Claude Code on Windows."),
  };
}
