/** Anything that carries a PRNG state (the GameState does). */
export interface RngHolder {
  rng: number;
}

/** mulberry32: small, fast, deterministic. Advances `h.rng`. */
export function nextFloat(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(h: RngHolder, n: number): number {
  return Math.floor(nextFloat(h) * n);
}

export function pick<T>(h: RngHolder, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from an empty list');
  return items[nextInt(h, items.length)];
}

export function shuffle<T>(h: RngHolder, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(h, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
