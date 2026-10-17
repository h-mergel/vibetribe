import {
  animatedIds,
  BREATH_FPS,
  FrameScheduler,
  InboxCycler,
  type Removal,
  type SessionView,
  SlotTable,
  waitingInOrder,
} from "@vibetribe/core";
import type { DeckMirror, HubState } from "@vibetribe/hub";
import { DEFAULT_VARIANT, type KeyFlash, render, type Variant } from "@vibetribe/render";
import { svgDataUrl } from "../image";
import { jumpUrlFor } from "../jump/target";
import { PressFeedback } from "./feedback";
import { contentSignature, framePriority } from "./frame";
import { type KeyPlacement, KeyRegistry } from "./keys";
import { Motion } from "./motion";
import type { DeckCommand, PressKind } from "./press";
import { ShownFrames } from "./shown";
import { inboxView, tileFor } from "./tiles";

/** Pressed-key feedback: "Open…" outlasts the ~2 s Claude Desktop needs to show the session. */
export const FLASH_MS: Record<KeyFlash, number> = { jumping: 2_500, no_target: 2_000 };

/** Status tap: all four sources for 5 s (handoff §4.3). */
export const STATUS_EXPANDED_MS = 5_000;

/** Elgato guideline: 10 setImage per second for the whole plugin (spec §5). */
export const DEFAULT_MAX_FRAMES = 10;

export interface DeckOptions {
  /** Hands one image to one key; true when the surface accepted it. Must not throw (FrameScheduler). */
  send: (keyId: string, image: string) => boolean;
  maxFramesPerSecond?: number;
  timeZone?: string;
  /** One line per key whose tile could not be rendered (once until it renders again). */
  log?: (line: string) => void;
  variant?: Variant;
}

/** Spec §6.3: a slot stays reserved 10 s after /clear or /resume. */
export const RESERVATION_MS = 10_000;

/**
 * Everything between hub state and key images, without the SDK: slot assignment, which tile goes on
 * which key, breathing frames, the image budget, the press seam and the debug mirror. Time is
 * always a parameter. Slots are stable (spec §6.3; KeyRegistry, SlotTable): new sessions land only
 * on visible keys, and a session that needs attention takes the visible slot of the calmest one.
 */
export class Deck {
  readonly #keys = new KeyRegistry();
  readonly #slots = new SlotTable(0);
  readonly #cycler = new InboxCycler();
  readonly #scheduler: FrameScheduler;
  readonly #timeZone: string | undefined;
  /** what each key shows: last accepted image and session, refusal backoff */
  readonly #shown = new ShownFrames();
  readonly #signature = new Map<string, string>();
  readonly #failing = new Set<string>();
  readonly #feedback = new PressFeedback();
  readonly #motion: Motion;
  readonly #variant: Variant;
  readonly #log: (line: string) => void;
  #flushAt = 0;
  #state: HubState | null = null;

  constructor(o: DeckOptions) {
    this.#timeZone = o.timeZone;
    this.#log = o.log ?? (() => {});
    this.#variant = o.variant ?? DEFAULT_VARIANT;
    const max = o.maxFramesPerSecond ?? DEFAULT_MAX_FRAMES;
    this.#motion = new Motion(max);
    this.#scheduler = new FrameScheduler((id, image) => {
      // only accepted images count for the mirror and the budget figures
      if (o.send(id, image)) this.#shown.accepted(id, image, this.#flushAt);
      else this.#shown.refused(id, this.#flushAt);
    }, max);
  }

  get pendingCount(): number {
    return this.#scheduler.pendingCount;
  }

  /** A key that (re)appears is always redrawn: the app forgets images of hidden keys. */
  keyAppeared(p: KeyPlacement, now: number): void {
    if (!this.#keys.add(p)) return;
    this.#scheduler.forget(p.id);
    this.#shown.forget(p.id);
    this.#signature.delete(p.id);
    // keys of a page reappear one by one: no promotion before update or tick (the first would lose its session)
    this.#sync(now, false);
    // the new key and the inbox (overflow count) are state changes; other keys follow the tick
    this.#render(now);
  }

  keyDisappeared(id: string, now: number): void {
    this.#keys.remove(id, now);
    this.#scheduler.forget(id);
    this.#shown.forget(id);
    this.#signature.delete(id);
    this.#failing.delete(id);
    this.#feedback.forget(id);
    // a waiting session on the hidden key counts as "+N" at once
    this.#render(now);
  }

  /** New hub state. Removals first (slot release and /clear reservation), then sync, then render. */
  update(state: HubState, removals: Removal[], now: number): void {
    for (const r of removals) {
      const reserve =
        r.reason === "clear" || r.reason === "resume"
          ? { host: r.key.host, cwd: r.cwd, pid: r.pid, until: now + RESERVATION_MS }
          : undefined;
      this.#slots.release(r.id, reserve);
    }
    this.#state = state;
    this.#sync(now, true);
    this.#render(now);
  }

  /** Called every 250 ms: breathing frames, clocks, inbox landing, then the budgeted flush. */
  tick(now: number): DeckCommand[] {
    this.#sync(now, true);
    const out = this.#landing(now);
    this.#render(now);
    this.#flush(now);
    return out;
  }

  press(id: string, kind: PressKind, now: number): DeckCommand[] {
    // InboxCycler contract: settle before every press
    const out = this.#landing(now);
    const key = this.#keys.get(id);
    if (!key || !this.#state) return out;
    const views = this.#state.sessions;
    switch (key.role) {
      case "slot": {
        // the session the key showed in its last accepted image, not the slot table: a promotion
        // can swap the slot between two frames, and a press must act on what the user saw
        const view = this.#view(this.#shown.sessionOf(id));
        if (!view) break;
        out.push(
          kind === "long" ? { type: "seen", session: view } : this.#jump(id, view, true, now),
        );
        break;
      }
      case "inbox": {
        if (kind === "long") {
          for (const v of views)
            if (v.state === "done_unseen") out.push({ type: "seen", session: v });
        } else {
          const target = this.#view(this.#cycler.press(now, waitingInOrder(views)));
          if (target) out.push(this.#jump(id, target, false, now));
        }
        break;
      }
      case "limit5h":
      case "limitWeek":
        if (kind === "short") out.push({ type: "refresh_usage" });
        break;
      case "extra":
        // the page where the user switches Extra Usage on or off; hold: nothing
        if (kind === "short") out.push({ type: "open_usage" });
        break;
      case "status":
        // tap: all sources for 5 s; hold: diagnostics (the debug page)
        if (kind === "short") this.#feedback.expand(id, now + STATUS_EXPANDED_MS);
        else out.push({ type: "open_debug" });
        break;
    }
    this.#render(now);
    return out;
  }

  /** Spec §9: a jump shows "Open…" on the pressed key; a session without a link shows "No link". */
  #jump(keyId: string, session: SessionView, markSeen: boolean, now: number): DeckCommand {
    const url = jumpUrlFor(session);
    const kind: KeyFlash = url ? "jumping" : "no_target";
    this.#feedback.flash(keyId, kind, session.id, now + FLASH_MS[kind]);
    return url ? { type: "jump", session, url, markSeen } : { type: "no_target", session };
  }

  /**
   * Spec §6.2: the inbox session the user landed on (5 s without another press). The press that
   * chose it has already jumped there (no second jump); a session without a link was never shown.
   */
  #landing(now: number): DeckCommand[] {
    const view = this.#view(this.#cycler.settle(now));
    return view && jumpUrlFor(view) !== null ? [{ type: "landed", session: view }] : [];
  }

  /** Spec §11.1: exactly the images the surface accepted per key, plus the budget figures. */
  mirror(now: number): DeckMirror {
    return {
      at: now,
      sentLastSecond: this.#shown.acceptedLastSecond(now),
      pending: this.#scheduler.pendingCount,
      keys: this.#keys.all().map((k) => ({
        id: k.id,
        role: k.role,
        slot: k.role === "slot" ? this.#keys.slotIndexOf(k.id) : null,
        device: k.device,
        row: k.row,
        column: k.column,
        image: this.#shown.imageOf(k.id),
        sentAt: this.#shown.atOf(k.id),
      })),
    };
  }

  #view(id: string | null): SessionView | undefined {
    return id === null ? undefined : this.#state?.sessions.find((v) => v.id === id);
  }

  /**
   * Give back the sessions of long-hidden keys, grow the table, then fill visible indexes; with
   * `promote`, sessions that need attention or are pinned displace calm ones (`SlotTable.promote`).
   */
  #sync(now: number, promote: boolean): void {
    for (const index of this.#keys.releaseHidden(now)) {
      const id = this.#slots.idAt(index);
      if (id !== null) this.#slots.release(id);
    }
    const n = this.#keys.slotCount;
    if (n > this.#slots.count) this.#slots.resize(n);
    if (!this.#state) return;
    const visible = (i: number) => this.#keys.isVisibleIndex(i);
    this.#slots.sync(this.#state.sessions, now, visible);
    if (promote) this.#slots.promote(this.#state.sessions, now, visible, this.#state.pins);
  }

  /**
   * The one render path of update, tick and key changes: every visible key is drawn, and a tile
   * that cannot be rendered only blanks its own key. A key in its refusal backoff is skipped until
   * it ends, so a change in between still counts as one.
   */
  #render(now: number): void {
    if (!this.#state) return;
    const views = this.#state.sessions;
    const animated = animatedIds(views, now);
    const slotIds = Array.from({ length: this.#keys.slotCount }, (_, i) => this.#slots.idAt(i));
    const shown = new Set(this.#keys.visibleSlotIndexes().map((i) => slotIds[i]));
    const shownViews = views.filter((v) => shown.has(v.id));
    const inbox = inboxView(this.#state, shown, this.#cycler.current(now));
    // only the comfortable inbox shows a clock (the wait of the session it shows)
    const inboxClock =
      this.#variant === "comfortable" && this.#keys.all().some((k) => k.role === "inbox")
        ? inbox.summary.top
        : null;
    const motion = this.#motion.frame(now, { shown: shownViews, animated, inboxClock });
    const sessionOn = (keyId: string): string | null | undefined => {
      const index = this.#keys.slotIndexOf(keyId);
      return index >= 0 ? this.#slots.idAt(index) : undefined;
    };
    const ctx = {
      now,
      animated,
      slotIds,
      inbox,
      timeZone: this.#timeZone,
      ...this.#feedback.active(now, sessionOn),
      tick: motion.tick,
      clockStepS: motion.clockStepS,
    };
    // headroom per second: 4 frames per breathing key plus one for state changes
    const breathing = shownViews.filter((v) => animated.has(v.id)).length;
    this.#scheduler.setReserve(BREATH_FPS * breathing + 1);
    for (const key of this.#keys.all()) {
      if (!this.#shown.due(key.id, now)) continue;
      const slotIndex = key.role === "slot" ? this.#keys.slotIndexOf(key.id) : -1;
      const breathes = slotIndex >= 0 && animated.has(slotIds[slotIndex] ?? "");
      try {
        const tile = tileFor(key, slotIndex, this.#state, ctx);
        const image = svgDataUrl(render(tile, { variant: this.#variant }));
        const signature = contentSignature(tile);
        const changed = this.#signature.get(key.id) !== signature;
        this.#signature.set(key.id, signature);
        this.#failing.delete(key.id);
        if (slotIndex >= 0) this.#shown.queue(key.id, slotIds[slotIndex] ?? null, image);
        this.#scheduler.submit(key.id, image, framePriority(tile, changed, breathes));
      } catch (err) {
        if (!this.#failing.has(key.id)) {
          this.#failing.add(key.id);
          this.#log(`tile for ${key.id} failed: ${String(err)}`);
        }
      }
    }
  }

  #flush(now: number): void {
    this.#flushAt = now;
    this.#scheduler.flush(now);
    // a refused frame is not on the key: the next render sends it again, as a changed one
    for (const id of this.#shown.afterFlush()) {
      this.#scheduler.forget(id);
      this.#signature.delete(id);
    }
  }
}
