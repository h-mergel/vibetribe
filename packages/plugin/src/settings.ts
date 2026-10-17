import { isObj } from "@vibetribe/protocol";

/** The global setting behind "Prefer pinned sessions" (ui/slot.html writes the same key). */
export const PREFER_PINNED_KEY = "preferPinned";

/** Sessions pinned in Claude Desktop keep their slots until the user unticks the box. */
export const PREFER_PINNED_DEFAULT = true;

/** The box as saved; absent or anything but a boolean is the default. */
export function preferPinnedOf(settings: unknown): boolean {
  const value = isObj(settings) ? settings[PREFER_PINNED_KEY] : undefined;
  return typeof value === "boolean" ? value : PREFER_PINNED_DEFAULT;
}

/** The slice of the SDK's `streamDeck.settings` used here; the real one satisfies it. */
export interface GlobalSettingsLike {
  getGlobalSettings(): Promise<unknown>;
  onDidReceiveGlobalSettings(listener: (ev: { settings: unknown }) => void): unknown;
}

/**
 * Follows "Prefer pinned sessions": the saved global settings once (call after connect), then every
 * change the property inspector makes. A failed read is logged and applies the default.
 */
export function followPreferPinned(
  sd: GlobalSettingsLike,
  apply: (on: boolean) => void,
  log: (line: string) => void,
): void {
  sd.onDidReceiveGlobalSettings((ev) => apply(preferPinnedOf(ev.settings)));
  sd.getGlobalSettings().then(
    (settings) => apply(preferPinnedOf(settings)),
    (err) => {
      log(`global settings not read: ${String(err)}`);
      apply(PREFER_PINNED_DEFAULT);
    },
  );
}
