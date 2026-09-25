import { useEffect, useState } from 'preact/hooks';

/**
 * Your own settings for this browser (not the flight's rules): sound and voice, the people you muted, graphics, and
 * accessibility. Changed from the settings screen (on the home page and on the seatback TV) and applied as they change.
 */
export type Quality = 'basic' | 'low' | 'medium' | 'high' | 'ultra';
export type TextSize = 'normal' | 'large' | 'larger';

export interface Prefs {
  /** Cabin sounds (engines, chimes, blasts), 0..1. */
  sound: number;
  /** Everyone else's voices, 0..1. */
  voice: number;
  /** Which microphone to use ('' for the browser's default). */
  mic: string;
  /** Talk only while holding V (or the Talk button), instead of an open microphone. */
  pushToTalk: boolean;
  /** How loud each person is to you, by flight and player (0 mutes them); missing means full volume. */
  people: Record<string, number>;
  quality: Quality;
  /** Field of view: degrees added to the usual (negative to narrow it). */
  fov: number;
  textSize: TextSize;
  /** No camera shake or head bob, and gentler cutscene camera moves. */
  reduceMotion: boolean;
  highContrast: boolean;
  /** Blasts and lightning barely flash. */
  fewerFlashes: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  sound: 0.9,
  voice: 1,
  mic: '',
  pushToTalk: false,
  people: {},
  quality: 'high',
  fov: 0,
  textSize: 'normal',
  reduceMotion: false,
  highContrast: false,
  fewerFlashes: false,
};

export const QUALITIES: readonly Quality[] = ['basic', 'low', 'medium', 'high', 'ultra'];
export const TEXT_SIZES: Record<TextSize, number> = { normal: 1, large: 1.15, larger: 1.3 };
export const FOV_RANGE = { min: -10, max: 20 } as const;
/** Mutes and volumes kept, at most (the oldest go first). */
const PEOPLE_KEPT = 300;

const KEY = 'flight13.prefs';

const num = (x: unknown, lo: number, hi: number, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback);

/** Settings as saved (anything missing or odd gets its default). */
export function cleanPrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const people: Record<string, number> = {};
  if (r.people && typeof r.people === 'object') {
    for (const [key, v] of Object.entries(r.people as Record<string, unknown>).slice(-PEOPLE_KEPT)) {
      if (typeof v === 'number' && v >= 0 && v <= 1) people[key] = v;
    }
  }
  return {
    sound: num(r.sound, 0, 1, DEFAULT_PREFS.sound),
    voice: num(r.voice, 0, 1, DEFAULT_PREFS.voice),
    mic: typeof r.mic === 'string' ? r.mic.slice(0, 200) : '',
    pushToTalk: r.pushToTalk === true,
    people,
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : DEFAULT_PREFS.quality,
    fov: Math.round(num(r.fov, FOV_RANGE.min, FOV_RANGE.max, 0)),
    textSize: (r.textSize as string) in TEXT_SIZES ? (r.textSize as TextSize) : 'normal',
    reduceMotion: r.reduceMotion === true,
    highContrast: r.highContrast === true,
    fewerFlashes: r.fewerFlashes === true,
  };
}

function read(): Prefs {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return cleanPrefs(JSON.parse(saved));
  } catch {
    // Unreadable: defaults.
  }
  // First visit: follow the system's reduced-motion setting.
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { ...DEFAULT_PREFS, reduceMotion: reduce };
}

let current: Prefs | null = null;
const listeners = new Set<(prefs: Prefs) => void>();

export function getPrefs(): Prefs {
  current ??= read();
  return current;
}

export function setPrefs(patch: Partial<Prefs>): void {
  const next = cleanPrefs({ ...getPrefs(), ...patch });
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Lasts for this visit only.
  }
  applyPage(next);
  for (const fn of [...listeners]) fn(next);
}

// Changed in another tab: this one follows.
if (typeof addEventListener === 'function') {
  addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    applyPage(current);
    for (const fn of [...listeners]) fn(current);
  });
}

export function subscribePrefs(fn: (prefs: Prefs) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function usePrefs(): Prefs {
  const [prefs, set] = useState(getPrefs);
  useEffect(() => {
    set(getPrefs());
    return subscribePrefs(set);
  }, []);
  return prefs;
}

/** The key a person's volume is kept under. */
export const personKey = (code: string, playerId: string) => `${code}:${playerId}`;

/** How loud a person is to you (1 unless you turned them down or muted them). */
export function personVolume(prefs: Prefs, code: string, playerId: string): number {
  return prefs.people[personKey(code, playerId)] ?? 1;
}

export function setPersonVolume(code: string, playerId: string, volume: number): void {
  const people = { ...getPrefs().people };
  const key = personKey(code, playerId);
  delete people[key];
  if (volume < 1) people[key] = Math.max(0, Math.min(1, volume));
  setPrefs({ people });
}

/** Text size and contrast apply to the whole page (see base.css). */
export function applyPage(prefs: Prefs = getPrefs()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--ui-zoom', String(TEXT_SIZES[prefs.textSize]));
  root.classList.toggle('high-contrast', prefs.highContrast);
  root.classList.toggle('reduce-motion', prefs.reduceMotion);
}
