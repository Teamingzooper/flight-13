import { describe, expect, it } from 'vitest';
import { LOOK_LIMITS, cleanLook, randomLook } from '../net/protocol';
import { ACCESSORIES, ACCESSORY_SLOTS, accessoryAt, slotSize } from './accessories';
import { buyAccessory, cleanBag, newBag } from './bag';

describe('accessories', () => {
  it('number each slot 1…n with no gaps, and fit what a look can hold', () => {
    for (const { slot } of ACCESSORY_SLOTS) {
      const indices = ACCESSORIES.filter((a) => a.slot === slot).map((a) => a.index);
      expect(indices).toEqual(indices.map((_, i) => i + 1));
      expect(LOOK_LIMITS[slot]).toBe(slotSize(slot) + 1);
    }
    expect(new Set(ACCESSORIES.map((a) => a.id)).size).toBe(ACCESSORIES.length);
    expect(accessoryAt('hat', 2)?.id).toBe('captain');
    expect(accessoryAt('hat', 0)).toBeUndefined();
  });

  it('are bought once each, with credits', () => {
    const bag = { ...newBag(), credits: 210 };
    const hat = buyAccessory(bag, 'captain')!;
    expect(hat).toMatchObject({ credits: 60, wardrobe: ['captain'] });
    expect(buyAccessory(hat, 'captain')).toBeNull();
    expect(buyAccessory(hat, 'cowboy')).toBeNull();
    expect(buyAccessory(hat, 'party')).toMatchObject({ credits: 0, wardrobe: ['captain', 'party'] });
    expect(buyAccessory(bag, 'jetpack')).toBeNull();
  });

  it('survive a trip through storage, and older bags start with none', () => {
    expect(newBag().wardrobe).toEqual([]);
    const { wardrobe: _gone, ...older } = newBag();
    expect(cleanBag(older).wardrobe).toEqual([]);
    expect(cleanBag({ ...newBag(), wardrobe: ['fedora', 'jetpack', 'fedora', 3] }).wardrobe).toEqual(['fedora']);
  });

  it('travel in a look: kept when known, dropped when not, and missing from older players', () => {
    const base = { body: 1, skin: 2, hair: 3, hairColor: 4, top: 5, topStyle: 1, bottom: 2 };
    expect(cleanLook({ ...base, hat: 2, eyes: 5, neck: 6 })).toMatchObject({ hat: 2, eyes: 5, neck: 6 });
    expect(cleanLook({ ...base, hat: 99, eyes: -1, neck: 'lei' })).toMatchObject({ hat: 0, eyes: 0, neck: 0 });
    expect(cleanLook(base)).toMatchObject({ hat: 0, eyes: 0, neck: 0 });
  });

  it('only dress up random looks when asked (bots yes, new passengers no)', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const plain = Array.from({ length: 20 }, () => randomLook(random));
    expect(plain.every((l) => !l.hat && !l.eyes && !l.neck)).toBe(true);
    const bots = Array.from({ length: 40 }, () => randomLook(random, true));
    expect(bots.some((l) => l.hat)).toBe(true);
    expect(bots.some((l) => !l.hat)).toBe(true);
    for (const l of bots) expect(cleanLook(l)).toEqual(l);
  });
});
