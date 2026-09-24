import { useRef, useState } from 'preact/hooks';
import { ITEM_ORDER, MAX_PACKED, type ItemId } from '../engine';
import { countOf } from '../meta/bag';
import { useBag } from '../meta/store';
import type { TVContext } from './context';

export interface Packing {
  /** How many of each item you own (what can go in the bag). */
  owned: Record<ItemId, number>;
  /** Items in the carry-on, in packing order. */
  packed: ItemId[];
  /** Copies of an item still out on the bed. */
  left: (item: ItemId) => number;
  ready: boolean;
  full: boolean;
  add: (item: ItemId) => void;
  /** Take the item at this slot back out. */
  remove: (slot: number) => void;
  done: () => void;
  reopen: () => void;
}

/**
 * Your carry-on while packing. Every change is sent to the host at once (so whatever is in the bag when
 * time runs out flies with you); Done marks you ready. This screen's picks are the truth while you pack:
 * the host's copy is only read when the screen opens (after a reload, or switching between 2D and 3D).
 */
export function usePacking(ctx: TVContext): Packing {
  const bag = useBag();
  const you = ctx.game.you;
  const [packed, setPacked] = useState<ItemId[]>(() => you?.items ?? []);
  // The bag as of the latest click, so quick clicks (or clicks from the 3D room between renders) build on each other.
  const current = useRef(packed);
  const ready = you?.packed ?? false;

  const owned = Object.fromEntries(ITEM_ORDER.map((id) => [id, countOf(bag, id)])) as Record<ItemId, number>;
  const leftIn = (items: readonly ItemId[], item: ItemId) => owned[item] - items.filter((p) => p === item).length;

  const send = (items: ItemId[], isReady: boolean) => void ctx.send({ kind: 'pack', items, ready: isReady });
  const change = (items: ItemId[]) => {
    current.current = items;
    setPacked(items);
    send(items, false);
  };

  return {
    owned,
    packed,
    left: (item) => leftIn(packed, item),
    ready,
    full: packed.length >= MAX_PACKED,
    add: (item) => {
      const items = current.current;
      if (ready || items.length >= MAX_PACKED || leftIn(items, item) <= 0) return;
      change([...items, item]);
    },
    remove: (slot) => {
      const items = current.current;
      if (ready || slot < 0 || slot >= items.length) return;
      change(items.filter((_, i) => i !== slot));
    },
    done: () => send(current.current, true),
    reopen: () => send(current.current, false),
  };
}
