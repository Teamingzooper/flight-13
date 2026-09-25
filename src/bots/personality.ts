/** How a bot talks: its tone, how fast it types, and (for babble in 3D) its voice. Seeded from its id. */

export type Tone = 'blunt' | 'nervous' | 'chatty' | 'formal';

export interface Personality {
  tone: Tone;
  /** Seconds to type ten characters. */
  typing: number;
  /** 0..1, low to high voice. */
  pitch: number;
}

const TONES: readonly Tone[] = ['blunt', 'nervous', 'chatty', 'formal'];

/** FNV-1a: a small stable hash, so the same bot always has the same personality. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stable number in [0, 1) for any text (noise per bot, player and day). */
export function hash01(text: string): number {
  return hash(text) / 2 ** 32;
}

export function personality(id: string): Personality {
  const h = hash(`personality:${id}`);
  return {
    tone: TONES[h % TONES.length],
    typing: 0.35 + ((h >>> 3) % 100) / 100 * 0.45,
    pitch: ((h >>> 11) % 1000) / 1000,
  };
}
