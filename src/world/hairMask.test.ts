import { describe, expect, it } from 'vitest';
import { HAIR_STYLES } from '../app/Avatar';
import { FACE_SIZE } from '../net/face';
import { hairMask } from './hairMask';

const covered = (mask: Uint8Array, x: number, y: number) => mask[y * FACE_SIZE + x] === 1;

describe('hair masks', () => {
  it('traces every style over the crown, and nothing for bald', () => {
    for (let style = 0; style < HAIR_STYLES.length; style++) {
      const mask = hairMask(style);
      if (HAIR_STYLES[style] === 'Bald') expect(mask.every((v) => v === 0)).toBe(true);
      else expect(covered(mask, 32, 4), HAIR_STYLES[style]).toBe(true);
    }
  });

  it('never hides eyes or a mouth painted on the guide lines', () => {
    for (let style = 0; style < HAIR_STYLES.length; style++) {
      const mask = hairMask(style);
      for (const [x, y] of [
        [22, 27],
        [42, 27],
        [32, 45],
      ]) {
        expect(covered(mask, x, y), `${HAIR_STYLES[style]} at ${x},${y}`).toBe(false);
      }
    }
  });
});
