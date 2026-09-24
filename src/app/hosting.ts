import { normalizeGame, normalizeSettings } from '../engine';
import type { HostSnapshot } from '../net/host';
import { randomToken } from './profile';

const snapshotKey = (code: string) => `flight13.host.${code}`;
const lockKey = (code: string) => `flight13.lock.${code}`;
const LOCK_STALE_MS = 6000;
const LOCK_BEAT_MS = 2000;

/** Stable across reloads of the same tab, different for every other tab. */
const TAB_ID = (() => {
  try {
    const existing = sessionStorage.getItem('flight13.tab');
    if (existing) return existing;
    const id = randomToken().slice(0, 12);
    sessionStorage.setItem('flight13.tab', id);
    return id;
  } catch {
    return randomToken().slice(0, 12);
  }
})();

const pending = new Map<string, { snapshot: HostSnapshot; timer: ReturnType<typeof setTimeout> }>();

function write(snapshot: HostSnapshot): void {
  try {
    localStorage.setItem(snapshotKey(snapshot.code), JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked: the flight still runs, it just cannot survive a reload.
  }
}

/** Save the host's flight (debounced unless `immediate`). */
export function saveHostSnapshot(snapshot: HostSnapshot, immediate = false): void {
  const previous = pending.get(snapshot.code);
  if (previous) clearTimeout(previous.timer);
  if (immediate) {
    pending.delete(snapshot.code);
    write(snapshot);
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(snapshot.code);
    write(snapshot);
  }, 1000);
  pending.set(snapshot.code, { snapshot, timer });
}

export function flushHostSnapshots(): void {
  for (const { snapshot, timer } of pending.values()) {
    clearTimeout(timer);
    write(snapshot);
  }
  pending.clear();
}

export function loadHostSnapshot(code: string): HostSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(code));
    const snapshot = raw ? (JSON.parse(raw) as HostSnapshot) : null;
    if (!snapshot || snapshot.v !== 1 || snapshot.code !== code) return null;
    // Saved by an older version: fill in rules and fields added since.
    snapshot.settings = normalizeSettings(snapshot.settings);
    if (snapshot.game) normalizeGame(snapshot.game);
    return snapshot;
  } catch {
    return null;
  }
}

export function deleteHostSnapshot(code: string): void {
  const previous = pending.get(code);
  if (previous) {
    clearTimeout(previous.timer);
    pending.delete(code);
  }
  try {
    localStorage.removeItem(snapshotKey(code));
  } catch {
    // Nothing else to do.
  }
}

export interface HostLock {
  /** Refresh the lock; call regularly (it throttles itself). */
  beat(): void;
  release(): void;
}

/** Only one tab may host a flight. Returns null when another live tab holds it. */
export function acquireHostLock(code: string): HostLock | null {
  const key = lockKey(code);
  const read = (): { tab: string; at: number } | null => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  const current = read();
  if (current && current.tab !== TAB_ID && Date.now() - current.at < LOCK_STALE_MS) return null;
  let last = 0;
  const beat = () => {
    const now = Date.now();
    if (now - last < LOCK_BEAT_MS) return;
    last = now;
    try {
      localStorage.setItem(key, JSON.stringify({ tab: TAB_ID, at: now }));
    } catch {
      // Ignore: worst case another tab could also host.
    }
  };
  beat();
  return {
    beat,
    release() {
      try {
        if (read()?.tab === TAB_ID) localStorage.removeItem(key);
      } catch {
        // Ignore.
      }
    },
  };
}

addEventListener('pagehide', flushHostSnapshots);
