export type KeyRole = "slot" | "inbox" | "limit5h" | "limitWeek" | "extra" | "status";

export const KEY_ROLES: readonly KeyRole[] = [
  "slot",
  "inbox",
  "limit5h",
  "limitWeek",
  "extra",
  "status",
];

/** One visible key: the action instance id plus where it sits. */
export interface KeyPlacement {
  id: string;
  role: KeyRole;
  device: string;
  row: number;
  column: number;
}

/** Reading order on the deck: device, then row, then column (plain code-unit order, locale independent). */
export function comparePlacement(a: KeyPlacement, b: KeyPlacement): number {
  if (a.device !== b.device) return a.device < b.device ? -1 : 1;
  return a.row - b.row || a.column - b.column;
}

const isGrid = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** A slot whose key stays hidden longer than this gives its session back (deleted key, long page switch). */
export const HIDDEN_RELEASE_MS = 60_000;

/**
 * Visible keys by id, plus a stable slot numbering (spec §6.3: a session keeps its slot).
 * A slot key gets its index at the first sight of its id; the index never changes afterwards:
 * not when the key moves (re-add with new coordinates), not when it disappears, not when other
 * keys appear before it. Initial indexes therefore follow willAppear order. Only `forgetIndex`
 * releases an index; the next new slot key takes the lowest released one, so the numbering stays
 * as small as the number of slot keys in use.
 */
export class KeyRegistry {
  readonly #keys = new Map<string, KeyPlacement>();
  readonly #indexById = new Map<string, number>();
  readonly #idByIndex = new Map<number, string>();
  readonly #released = new Set<number>();
  /** slot index -> since when its key is hidden */
  readonly #hiddenSince = new Map<number, number>();
  #nextIndex = 0;

  /**
   * Register or update a visible key. Returns false and ignores the call when row or column is not
   * a finite integer (an existing key stays as it was); true otherwise.
   */
  add(p: KeyPlacement): boolean {
    if (!isGrid(p.row) || !isGrid(p.column)) return false;
    this.#keys.set(p.id, { ...p });
    this.#hiddenSince.delete(this.slotIndexOf(p.id));
    if (p.role === "slot" && !this.#indexById.has(p.id)) {
      const index = this.#released.size > 0 ? Math.min(...this.#released) : this.#nextIndex++;
      this.#released.delete(index);
      this.#indexById.set(p.id, index);
      this.#idByIndex.set(index, p.id);
    }
    return true;
  }

  /** The key is no longer visible; its slot index is kept until `releaseHidden`. */
  remove(id: string, now: number): void {
    this.#keys.delete(id);
    const index = this.slotIndexOf(id);
    if (index >= 0 && !this.#hiddenSince.has(index)) this.#hiddenSince.set(index, now);
  }

  /** Releases (`forgetIndex`) the indexes whose key is hidden longer than HIDDEN_RELEASE_MS; returns them. */
  releaseHidden(now: number): number[] {
    const released: number[] = [];
    for (const [index, since] of this.#hiddenSince) {
      if (now - since <= HIDDEN_RELEASE_MS) continue;
      this.#hiddenSince.delete(index);
      if (this.forgetIndex(index)) released.push(index);
    }
    return released;
  }

  get(id: string): KeyPlacement | undefined {
    return this.#keys.get(id);
  }

  /** Visible keys in placement order. */
  all(): KeyPlacement[] {
    return [...this.#keys.values()].sort(comparePlacement);
  }

  /** Highest slot index ever assigned plus one; never shrinks (released indexes are reused). */
  get slotCount(): number {
    return this.#nextIndex;
  }

  /** Stable 0-based slot index of a slot key (visible or not), -1 for unknown, forgotten and non-slot keys. */
  slotIndexOf(id: string): number {
    return this.#indexById.get(id) ?? -1;
  }

  /** True while the key owning this index is currently visible. */
  isVisibleIndex(index: number): boolean {
    const id = this.#idByIndex.get(index);
    return id !== undefined && this.#keys.get(id)?.role === "slot";
  }

  /** Indexes of currently visible slot keys, ascending (assign new sessions only to these). */
  visibleSlotIndexes(): number[] {
    return [...this.#idByIndex.keys()].filter((i) => this.isVisibleIndex(i)).sort((a, b) => a - b);
  }

  /**
   * Release the index of a hidden key (its session has been given back). Returns false for
   * visible or unknown indexes. The next new slot key, the same id included, may take it.
   */
  forgetIndex(index: number): boolean {
    const id = this.#idByIndex.get(index);
    if (id === undefined || this.isVisibleIndex(index)) return false;
    this.#idByIndex.delete(index);
    this.#indexById.delete(id);
    this.#released.add(index);
    return true;
  }
}

/** Top row Inbox, 5h, week, Extra, Status; rows 2–3 are slots 1–10. */
export function defaultMk2Layout(device = "mk2"): KeyPlacement[] {
  const top: KeyRole[] = ["inbox", "limit5h", "limitWeek", "extra", "status"];
  const keys: KeyPlacement[] = top.map((role, column) => ({
    id: `${device}:0:${column}`,
    role,
    device,
    row: 0,
    column,
  }));
  for (let row = 1; row <= 2; row++)
    for (let column = 0; column < 5; column++)
      keys.push({ id: `${device}:${row}:${column}`, role: "slot", device, row, column });
  return keys;
}
