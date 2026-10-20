import { SETUP_SOURCE } from "@vibetribe/hub";
import { isObj } from "@vibetribe/protocol";
import type { SetupState } from "@vibetribe/reporter/setup";
import type { SetupResult, WindowsSetup } from "./windows";
import type { WslMode } from "./wsl";

/** What the property inspector shows (ui/vibetribe.html reads exactly these fields); sent as JSON. */
export type SetupView = {
  windows: SetupState;
  /** WSL's distribution; null hides the WSL part (no WSL, or not found yet) */
  wsl: string | null;
  busy: boolean;
  message: SetupResult | null;
};

/** What the property inspector asks for: `{ "setup": <request> }`. */
export const SETUP_REQUESTS = [
  "refresh",
  "install",
  "remove",
  "install-wsl",
  "remove-wsl",
] as const;
export type SetupRequest = (typeof SETUP_REQUESTS)[number];

export function requestOf(payload: unknown): SetupRequest | null {
  const r = isObj(payload) ? payload.setup : undefined;
  return SETUP_REQUESTS.find((s) => s === r) ?? null;
}

/** The status key's alert text comes from this error (deck `statusAlert`). */
function setupError(state: SetupState): string | null {
  if (state === "installed") return null;
  return state === "missing" ? "Claude Code hooks not set up" : "Claude Code hooks need an update";
}

export interface SetupControllerDeps {
  windows: WindowsSetup;
  /** WSL's distribution (`wslDistro`); null: none, or none yet */
  findDistro: () => Promise<string | null>;
  /** called once, when WSL's distribution is found: the hub starts reading it */
  wslFound: (distro: string) => void;
  wsl: (distro: string, mode: WslMode) => Promise<SetupResult>;
  /** to the open property inspector; must not throw */
  publish: (view: SetupView) => void;
  hub: {
    markOk(source: string, at: number): void;
    markError(source: string, message: string): void;
  };
  now: () => number;
  log: (line: string) => void;
}

/**
 * Setup on the user's click only: reads the Windows state for the status key and the property
 * inspector, runs one step at a time and ignores clicks while a step runs. Looks for WSL in the
 * background on every refresh until it is found (wsl.exe can be slow right after login).
 */
export class SetupController {
  readonly #d: SetupControllerDeps;
  #state: SetupState = "missing";
  #distro: string | null = null;
  #finding = false;
  #busy = false;
  #message: SetupResult | null = null;

  constructor(deps: SetupControllerDeps) {
    this.#d = deps;
  }

  /** Re-reads the Windows state, marks the hub and shows the result. Never throws. */
  refresh(): void {
    try {
      this.#state = this.#d.windows.state();
    } catch (err) {
      this.#d.log(`setup state not read: ${String(err)}`);
      this.#state = "missing";
    }
    const error = setupError(this.#state);
    if (error === null) this.#d.hub.markOk(SETUP_SOURCE, this.#d.now());
    else this.#d.hub.markError(SETUP_SOURCE, error);
    this.#publish();
    if (this.#distro === null) void this.#findWsl();
  }

  async handle(payload: unknown): Promise<void> {
    const request = requestOf(payload);
    if (request === null || this.#busy) return;
    if (request === "refresh") {
      this.#message = null;
      this.refresh();
      return;
    }
    this.#busy = true;
    this.#publish();
    // the Windows steps run synchronously: let the inspector show "Working…" first
    await new Promise((resolve) => setImmediate(resolve));
    try {
      this.#message = await this.#run(request);
    } catch (err) {
      this.#message = { ok: false, text: `Setup failed: ${String(err)}` };
    }
    this.#busy = false;
    this.#d.log(`setup ${request}: ${this.#message.ok ? "ok" : "failed"}`);
    this.refresh();
  }

  async #findWsl(): Promise<void> {
    if (this.#finding) return;
    this.#finding = true;
    try {
      const distro = await this.#d.findDistro();
      if (distro !== null && this.#distro === null) {
        this.#distro = distro;
        this.#d.wslFound(distro);
        this.#publish();
      }
    } catch (err) {
      this.#d.log(`wsl lookup failed: ${String(err)}`);
    } finally {
      this.#finding = false;
    }
  }

  async #run(request: Exclude<SetupRequest, "refresh">): Promise<SetupResult> {
    switch (request) {
      case "install":
        return this.#d.windows.install();
      case "remove":
        return this.#d.windows.uninstall();
      case "install-wsl":
      case "remove-wsl": {
        if (this.#distro === null) return { ok: false, text: "WSL was not found." };
        if (request === "install-wsl" && this.#state !== "installed")
          return { ok: false, text: "Set up Windows first." };
        return this.#d.wsl(this.#distro, request === "install-wsl" ? "install" : "remove");
      }
    }
  }

  #publish(): void {
    this.#d.publish({
      windows: this.#state,
      wsl: this.#distro,
      busy: this.#busy,
      message: this.#message,
    });
  }
}
