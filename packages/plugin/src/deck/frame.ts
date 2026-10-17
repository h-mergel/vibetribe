import { FRAME_PRIORITY, type FramePriority } from "@vibetribe/core";
import type { Tile } from "@vibetribe/render";

/**
 * What a tile says apart from its clocks: wait times (slot and inbox top), breathing level, reset
 * countdown and the stale/reset notes change without any event. Only a change of this signature
 * is a state frame.
 */
export function contentSignature(tile: Tile): string {
  const copy: Record<string, unknown> = { ...tile };
  if (tile.kind === "slot") {
    delete copy.wait;
    delete copy.level;
    delete copy.tick;
  } else if (tile.kind === "inbox") {
    if (tile.top) copy.top = { ...tile.top, wait: null };
  } else if (tile.kind === "limit") {
    delete copy.resetIn;
    delete copy.note;
  } else if (tile.kind === "extra") {
    delete copy.note;
  }
  return JSON.stringify(copy);
}

/**
 * A changed content signature is a state frame. Otherwise the frame is a breath step of a
 * breathing key, a working-dot step, or a clock: none of them may eat the breathing headroom.
 */
export function framePriority(tile: Tile, changed: boolean, breathes: boolean): FramePriority {
  if (changed) return FRAME_PRIORITY.state;
  if (breathes) return FRAME_PRIORITY.breathe;
  return tile.kind === "slot" && tile.state === "working"
    ? FRAME_PRIORITY.working
    : FRAME_PRIORITY.clock;
}
