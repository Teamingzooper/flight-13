import { describe, expect, it } from 'vitest';
import { headline, outcome, postcardFileName, rosterLayout } from './postcard';

describe('the landing postcard', () => {
  it('says who won', () => {
    expect(headline({ result: { winner: 'passengers', reason: 'landed', night: 5 } })).toBe('The passengers win');
    expect(headline({ result: { winner: 'saboteurs', reason: 'parity', night: 3 } })).toBe('The saboteurs win');
    expect(headline({ result: { winner: 'draw', reason: 'no_survivors', night: 2 } })).toBe('No survivors');
    expect(headline({ result: null })).toBe('Flight over');
  });

  it('says how everyone got off', () => {
    expect(outcome({ status: 'alive', cause: null })).toBe('made it');
    expect(outcome({ status: 'restrained', cause: 'restrained' })).toBe('restrained');
    expect(outcome({ status: 'dead', cause: 'poison' })).toBe('poisoned');
    expect(outcome({ status: 'dead', cause: 'explosion' })).toBe('blown up');
  });

  it('fits up to 24 aboard in the roster column', () => {
    expect(rosterLayout(6, 534)).toEqual({ columns: 1, perColumn: 6, rowHeight: 68 });
    expect(rosterLayout(8, 534)).toEqual({ columns: 1, perColumn: 8, rowHeight: 66 });
    expect(rosterLayout(9, 534)).toEqual({ columns: 2, perColumn: 5, rowHeight: 68 });
    const full = rosterLayout(24, 534);
    expect(full).toEqual({ columns: 2, perColumn: 12, rowHeight: 44 });
    expect(full.perColumn * full.rowHeight).toBeLessThanOrEqual(534);
  });

  it('names the file after the destination', () => {
    expect(postcardFileName('Reykjavík')).toBe('flight-13-reykjavik.png');
    expect(postcardFileName('Flight School')).toBe('flight-13-flight-school.png');
    expect(postcardFileName('!!!')).toBe('flight-13-postcard.png');
  });
});

describe('the class photo (no 3D view)', () => {
  it('lines everyone up in up to three rows that fit the photo', async () => {
    const { classRows } = await import('./postcard');
    for (let n = 1; n <= 24; n++) {
      const { rows, perRow, size, spacing, rise } = classRows(n);
      expect(rows * perRow).toBeGreaterThanOrEqual(n);
      expect(rows).toBeLessThanOrEqual(3);
      // The widest row fits across, and the stack of rows fits up the picture.
      expect(size * spacing * (perRow - 1) + size).toBeLessThanOrEqual(900 - 40);
      expect(size * (1 + (rows - 1) * rise)).toBeLessThanOrEqual(562.5);
    }
    expect(classRows(24).size).toBeGreaterThan(120);
    expect(classRows(4).size).toBe(220);
  });
});
