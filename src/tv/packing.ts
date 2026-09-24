import { useEffect, useRef, useState } from 'preact/hooks';
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
 * time runs out flies with you); Done marks you ready.
 */
export function usePacking(ctx: TVContext): Packing {
  const bag = useBag();
  const you = ctx.game.you;
  const [packed, setPacked] = useState<ItemId[]>(() => you?.items ?? []);
  const ready = you?.packed ?? false;
  const sent = useRef(JSON.stringify(packed));

  // After a reload the host still has your bag: pick up from there.
  useEffect(() => {
    const theirs = JSON.stringify(you?.items ?? []);
    if (theirs !== sent.current) {
      sent.current = theirs;
      setPacked(you?.items ?? []);
    }
  }, [you?.items.join(',')]);

  const owned = Object.fromEntries(ITEM_ORDER.map((id) => [id, countOf(bag, id)])) as Record<ItemId, number>;
  const left = (item: ItemId) => owned[item] - packed.filter((p) => p === item).length;

  const send = (items: ItemId[], isReady: boolean) => {
    sent.current = JSON.stringify(items);
    void ctx.send({ kind: 'pack', items, ready: isReady });
  };
  const change = (items: ItemId[]) => {
    setPacked(items);
    send(items, false);
  };

  return {
    owned,
    packed,
    left,
    ready,
    full: packed.length >= MAX_PACKED,
    add: (item) => {
      if (ready || packed.length >= MAX_PACKED || left(item) <= 0) return;
      change([...packed, item]);
    },
    remove: (slot) => {
      if (ready || slot < 0 || slot >= packed.length) return;
      change(packed.filter((_, i) => i !== slot));
    },
    done: () => send(packed, true),
    reopen: () => send(packed, false),
  };
}
