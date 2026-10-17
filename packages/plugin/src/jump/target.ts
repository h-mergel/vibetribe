import type { SessionView } from "@vibetribe/core";
import {
  DESKTOP_SESSION_ID as DESKTOP,
  DESKTOP_ENTRYPOINT,
  isDesktopId,
} from "@vibetribe/protocol";

/** Remote Control and remote session id (`session_…`, probes F and J2). */
const BRIDGE = "session_[0-9A-Za-z]{1,64}";
const BRIDGE_ID = new RegExp(`^${BRIDGE}$`);
/** The only two link forms that ever reach the OS (spec §9). */
const JUMP_URL = new RegExp(`^claude://claude\\.ai/(?:epitaxy/${DESKTOP}|code/${BRIDGE})$`);

/**
 * Spec §9: a Desktop session opens by its Desktop id (probe E), a Remote Control or remote
 * session by its bridge id (probe F). Anything else (e.g. a CLI session in a terminal) has no
 * target: null.
 */
export function jumpUrlFor(v: SessionView): string | null {
  if (
    v.entrypoint === DESKTOP_ENTRYPOINT &&
    v.hostSessionId !== null &&
    isDesktopId(v.hostSessionId)
  )
    return `claude://claude.ai/epitaxy/${v.hostSessionId}`;
  if (v.bridgeSessionId !== null && BRIDGE_ID.test(v.bridgeSessionId))
    return `claude://claude.ai/code/${v.bridgeSessionId}`;
  return null;
}

/** Strict check right before a link is handed to the OS. */
export const isJumpUrl = (url: string): boolean => JUMP_URL.test(url);
