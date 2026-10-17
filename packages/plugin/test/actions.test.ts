import type {
  KeyDownEvent,
  KeyUpEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerActions, VibeTribeAction } from "../src/actions";
import type { DeckController } from "../src/compose";
import { KEY_ROLES, type KeyPlacement } from "../src/deck/keys";
import type { PressKind } from "../src/deck/press";
import { ACTION_UUIDS } from "../src/ids";

class FakeDeck implements DeckController {
  readonly appeared: KeyPlacement[] = [];
  readonly gone: string[] = [];
  readonly presses: [string, PressKind][] = [];
  keyAppeared(p: KeyPlacement): void {
    this.appeared.push(p);
  }
  keyDisappeared(id: string): void {
    this.gone.push(id);
  }
  press(id: string, kind: PressKind): void {
    this.presses.push([id, kind]);
  }
}

interface Opts {
  id?: string;
  coordinates?: { row: number; column: number };
  multi?: boolean;
  isKey?: boolean;
}
const ev = <T>(o: Opts = {}): T =>
  ({
    action: {
      id: o.id ?? "k1",
      device: { id: "dev1" },
      coordinates: o.coordinates,
      isKey: () => o.isKey ?? true,
      isInMultiAction: () => o.multi ?? false,
    },
  }) as unknown as T;

function setup() {
  const deck = new FakeDeck();
  let t = 0;
  const a = new VibeTribeAction("slot", deck, () => t);
  return {
    deck,
    a,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe("VibeTribeAction", () => {
  it("routes on the manifest id of its role", () => {
    expect(new VibeTribeAction("limit5h", new FakeDeck()).manifestId).toBe(ACTION_UUIDS.limit5h);
  });

  it("reports a visible key with its coordinates", () => {
    const { a, deck } = setup();
    a.onWillAppear(ev<WillAppearEvent>({ coordinates: { row: 1, column: 2 } }));
    expect(deck.appeared).toEqual([{ id: "k1", role: "slot", device: "dev1", row: 1, column: 2 }]);
  });

  it("skips multi-action children, keys without coordinates and non-keys", () => {
    const { a, deck } = setup();
    a.onWillAppear(ev<WillAppearEvent>({ coordinates: { row: 0, column: 0 }, multi: true }));
    a.onWillAppear(ev<WillAppearEvent>({}));
    a.onWillAppear(ev<WillAppearEvent>({ coordinates: { row: 0, column: 0 }, isKey: false }));
    expect(deck.appeared).toEqual([]);
  });

  it("turns key down/up into short and long presses", () => {
    const { a, deck, at } = setup();
    at(1000);
    a.onKeyDown(ev<KeyDownEvent>());
    at(1100);
    a.onKeyUp(ev<KeyUpEvent>());
    at(2000);
    a.onKeyDown(ev<KeyDownEvent>());
    at(2700);
    a.onKeyUp(ev<KeyUpEvent>());
    expect(deck.presses).toEqual([
      ["k1", "short"],
      ["k1", "long"],
    ]);
  });

  it("ignores an up without a down", () => {
    const { a, deck } = setup();
    a.onKeyUp(ev<KeyUpEvent>());
    expect(deck.presses).toEqual([]);
  });

  it("a held key that disappears, reappears and is released is no long press", () => {
    const { a, deck, at } = setup();
    const coordinates = { row: 0, column: 0 };
    at(0);
    a.onWillAppear(ev<WillAppearEvent>({ coordinates }));
    a.onKeyDown(ev<KeyDownEvent>());
    at(100);
    a.onWillDisappear(ev<WillDisappearEvent>());
    at(5000);
    a.onWillAppear(ev<WillAppearEvent>({ coordinates }));
    a.onKeyUp(ev<KeyUpEvent>());
    expect(deck.gone).toEqual(["k1"]);
    expect(deck.presses).toEqual([]);
  });
});

describe("registerActions", () => {
  it("registers one action per role with the manifest ids", () => {
    const registered: VibeTribeAction[] = [];
    registerActions(new FakeDeck(), (a) => registered.push(a as VibeTribeAction));
    expect(registered.map((a) => a.manifestId)).toEqual(KEY_ROLES.map((r) => ACTION_UUIDS[r]));
    expect(registered).toHaveLength(6);
  });

  it("wires each action to its own role", () => {
    const deck = new FakeDeck();
    const registered: VibeTribeAction[] = [];
    registerActions(deck, (a) => registered.push(a as VibeTribeAction));
    registered.forEach((a, i) => {
      a.onWillAppear(ev<WillAppearEvent>({ id: `k${i}`, coordinates: { row: 0, column: i } }));
    });
    expect(deck.appeared.map((p) => p.role)).toEqual([...KEY_ROLES]);
  });
});

describe("default clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("measures a 700 ms hold with Date.now as a long press", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const deck = new FakeDeck();
    const a = new VibeTribeAction("slot", deck);
    a.onKeyDown(ev<KeyDownEvent>());
    vi.advanceTimersByTime(700);
    a.onKeyUp(ev<KeyUpEvent>());
    expect(deck.presses).toEqual([["k1", "long"]]);
  });
});
