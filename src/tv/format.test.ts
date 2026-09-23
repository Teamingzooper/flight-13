import { describe, expect, it } from 'vitest';
import { clock, shortName } from './format';

describe('tv formatting', () => {
  it('formats countdowns', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(999)).toBe('0:01');
    expect(clock(61_000)).toBe('1:01');
    expect(clock(-5)).toBe('0:00');
  });

  it('shortens names for seat cells', () => {
    expect(shortName('Ann Marie')).toBe('Ann');
    expect(shortName('Bartholomew')).toBe('Bartho…');
  });
});
