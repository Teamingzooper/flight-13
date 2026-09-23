import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, pick, shuffle } from './rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    const seqA = [nextFloat(a), nextFloat(a), nextFloat(a)];
    const seqB = [nextFloat(b), nextFloat(b), nextFloat(b)];
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBe(3);
  });

  it('returns floats in [0, 1)', () => {
    const h = { rng: 7 };
    for (let i = 0; i < 2000; i++) {
      const x = nextFloat(h);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('nextInt covers 0..n-1 only', () => {
    const h = { rng: 3 };
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(nextInt(h, 5));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('shuffle keeps every item exactly once and leaves the input alone', () => {
    const h = { rng: 99 };
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out = shuffle(h, items);
    expect(out.slice().sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('pick throws on an empty list', () => {
    expect(() => pick({ rng: 1 }, [])).toThrow();
  });
});
