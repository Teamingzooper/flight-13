import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { BLAST_RADIUS, allSeats, isAisleSeat, placesWithin, rowSeats } from './grid';
import { PLANES, rowsFor } from './planes';
import { presetCards, validateCards } from './roles';
import { defaultSettings } from './settings';
import { checkTakeoff, createGame } from './setup';
import { TEST_LOOK, advanceTo, makeGame } from './testkit';
import type { GameState, NightAction } from './types';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const JET = PLANES.jet.cols;

describe('plane types', () => {
  it('lay out the private jet two by two across a wide aisle', () => {
    expect(rowsFor(6, 'jet')).toBe(5);
    expect(allSeats(2, JET)).toEqual(['1A', '1B', '1E', '1F', '2A', '2B', '2E', '2F']);
    expect(rowSeats(3, 'right', JET)).toEqual(['3E', '3F']);
    expect(isAisleSeat('2B', JET)).toBe(true);
    expect(isAisleSeat('2C')).toBe(true);
    expect(isAisleSeat('2A', JET)).toBe(false);
    // A blast under B never reaches across the aisle.
    const blast = placesWithin([{ row: 3, col: 1 }], BLAST_RADIUS, 5, JET);
    expect(blast.filter((p) => !p.startsWith('Aisle'))).toEqual(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B']);
  });

  it('seat everyone on the private jet in its own seats, and its aisle seats are next to the cart', () => {
    const settings = { ...defaultSettings(), plane: 'jet' as const, maxPassengers: 6 };
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, look: TEST_LOOK }));
    const s = createGame({ settings, players, seed: 3, now: 0 });
    expect(s.cabin).toMatchObject({ rows: 5, cols: [0, 1, 5, 6] });
    for (const p of s.players) if (p.seat && /^\d/.test(p.seat)) expect(p.seat).toMatch(/^[1-5][ABEF]$/);
    const jet = makeGame(
      [
        { id: 'bomber', role: 'bomber', seat: '2B' },
        { id: 'a', role: 'passenger', seat: '4A' },
        { id: 'b', role: 'passenger', seat: '5F' },
        { id: 'c', role: 'passenger', seat: '3E' },
      ],
      { settings: { plane: 'jet', maxPassengers: 6 } },
    );
    advanceTo(jet, 'night_act', 1);
    expect(act(jet, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 })).toEqual({ ok: true });
    expect(applyIntent(jet, 'a', { kind: 'move', to: '2C' }, 0).ok).toBe(false);
  });

  it('fly the jumbo with up to 24, the saboteurs still outnumbered', () => {
    expect(rowsFor(16, 'jumbo')).toBe(14);
    expect(rowsFor(24, 'jumbo')).toBe(16);
    for (let n = 17; n <= 24; n++) expect(validateCards(presetCards(n), n, 1)).toBeNull();
    const settings = { ...defaultSettings(), plane: 'jumbo' as const, maxPassengers: 24 };
    const few = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    expect(checkTakeoff(settings, few)).toBe('Need at least 10 passengers to take off in the jumbo.');
    const all = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    expect(checkTakeoff(settings, all)).toBeNull();
    expect(createGame({ settings, players: all, seed: 5, now: 0 }).cabin.rows).toBe(16);
  });
});
