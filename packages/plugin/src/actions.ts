import streamDeck, {
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { DeckController } from "./compose";
import { KEY_ROLES, type KeyRole } from "./deck/keys";
import { PressTracker } from "./deck/press";
import { ACTION_UUIDS } from "./ids";

/**
 * SDK adapter for one key role. `manifestId` is what `registerAction` routes on; the `@action`
 * decorator only sets this same field, so one class serves all six roles without subclasses.
 */
export class VibeTribeAction extends SingletonAction {
  override readonly manifestId: string;
  readonly #role: KeyRole;
  readonly #deck: DeckController;
  readonly #presses = new PressTracker();
  readonly #now: () => number;

  constructor(role: KeyRole, deck: DeckController, now: () => number = Date.now) {
    super();
    this.manifestId = ACTION_UUIDS[role];
    this.#role = role;
    this.#deck = deck;
    this.#now = now;
  }

  override onWillAppear(ev: WillAppearEvent): void {
    // multi-action children and dials have no grid position and never show our images
    if (!ev.action.isKey() || ev.action.isInMultiAction()) return;
    const c = ev.action.coordinates;
    if (!c) return;
    this.#deck.keyAppeared({
      id: ev.action.id,
      role: this.#role,
      device: ev.action.device.id,
      row: c.row,
      column: c.column,
    });
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    // a key that vanishes while held never reports its key-up; the press must not outlive it
    this.#presses.cancel(ev.action.id);
    this.#deck.keyDisappeared(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    this.#presses.down(ev.action.id, this.#now());
  }

  override onKeyUp(ev: KeyUpEvent): void {
    const kind = this.#presses.up(ev.action.id, this.#now());
    if (kind) this.#deck.press(ev.action.id, kind);
  }
}

/**
 * Registers one action per role; must run before `streamDeck.connect()`. `register` is a seam
 * for tests; the default hands the action to the SDK.
 */
export function registerActions(
  deck: DeckController,
  register: (action: SingletonAction) => void = (a) => streamDeck.actions.registerAction(a),
): void {
  for (const role of KEY_ROLES) register(new VibeTribeAction(role, deck));
}
