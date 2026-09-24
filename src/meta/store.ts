import { useEffect, useState } from 'preact/hooks';
import { cleanBag, newBag, type Bag } from './bag';

/** `?p=2` gives a tab its own identity (see profile.ts), and its own bag. */
const SLOT = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('p') ?? '';
const BAG_KEY = `flight13.bag${SLOT ? `.${SLOT}` : ''}`;

let current: Bag | null = null;
const listeners = new Set<(bag: Bag) => void>();

function read(): Bag {
  try {
    const raw = localStorage.getItem(BAG_KEY);
    if (raw === null) {
      const fresh = newBag();
      localStorage.setItem(BAG_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return cleanBag(JSON.parse(raw));
  } catch {
    return current ?? newBag();
  }
}

function notify(bag: Bag): void {
  for (const fn of [...listeners]) fn(bag);
}

export function getBag(): Bag {
  current ??= read();
  return current;
}

/** Change the bag and save it; returns the new bag. */
export function updateBag(change: (bag: Bag) => Bag): Bag {
  const before = getBag();
  const next = change(before);
  if (next === before) return before;
  current = next;
  try {
    localStorage.setItem(BAG_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the change lasts for this page.
  }
  notify(next);
  return next;
}

export function subscribeBag(fn: (bag: Bag) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// Another tab (a second flight, Duty Free) changed the bag.
if (typeof addEventListener === 'function') {
  addEventListener('storage', (e) => {
    if (e.key !== BAG_KEY) return;
    current = read();
    notify(current);
  });
}

export function useBag(): Bag {
  const [bag, setBag] = useState(getBag);
  useEffect(() => {
    setBag(getBag());
    return subscribeBag(setBag);
  }, []);
  return bag;
}
