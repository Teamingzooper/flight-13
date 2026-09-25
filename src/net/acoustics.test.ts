import { describe, expect, it } from 'vitest';
import { BULKHEAD_Z, FLIGHT_DECK, rowZ } from '../world/layout';
import { wallBetween, zoneAt } from './acoustics';

describe('acoustics', () => {
  it('knows which room a point is in', () => {
    const rows = 10;
    expect(zoneAt(0, 3, rows)).toBe('cabin');
    expect(zoneAt(0, BULKHEAD_Z - 0.5, rows)).toBe('galley');
    expect(zoneAt(0, FLIGHT_DECK.doorZ - 0.5, rows)).toBe('deck');
    expect(zoneAt(-1, rowZ(rows) + 1.2, rows)).toBe('lavatory');
    // The rear galley aisle, beside the lavatory, is still the cabin.
    expect(zoneAt(0.1, rowZ(rows) + 1.2, rows)).toBe('cabin');
  });

  it('muffles more through a door than through the galley curtain', () => {
    expect(wallBetween('cabin', 'cabin')).toEqual({ gain: 1, cutoff: 20000 });
    const curtain = wallBetween('cabin', 'galley');
    const lav = wallBetween('lavatory', 'cabin');
    const deck = wallBetween('deck', 'cabin');
    expect(lav.gain).toBeLessThan(curtain.gain);
    expect(lav.cutoff).toBeLessThan(curtain.cutoff);
    expect(deck.gain).toBeLessThan(curtain.gain);
  });
});
