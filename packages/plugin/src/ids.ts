import type { KeyRole } from "./deck/keys";

/** Plugin UUID (spec §13, domain h2k.dev); the .sdPlugin directory carries the same name. */
export const PLUGIN_UUID = "dev.h2k.vibetribe";

/** One Stream Deck action per key role; the manifest lists exactly these. */
export const ACTION_UUIDS: Record<KeyRole, string> = {
  slot: `${PLUGIN_UUID}.slot`,
  inbox: `${PLUGIN_UUID}.inbox`,
  limit5h: `${PLUGIN_UUID}.limit-5h`,
  limitWeek: `${PLUGIN_UUID}.limit-week`,
  extra: `${PLUGIN_UUID}.extra`,
  status: `${PLUGIN_UUID}.status`,
};
