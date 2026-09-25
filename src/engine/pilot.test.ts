import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { COCKPIT, parsePlace } from './grid';
import { TEST_LOOK, advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, MoveTarget, NightAction } from './types';
import { viewFor } from './view';
import { emptyCards, isPilot, validateCards } from './roles';
import { defaultSettings, validateSettings } from './settings';
import { createGame, dealRoles } from './setup';

describe('rogue Pilots', () => {
  it('turn rogue by the odds, but only while the saboteurs stay outnumbered', () => {
    const cards = { ...emptyCards(), bomber: 1, pilot: 1 };
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 1)).toContain('pilot_rogue');
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 0)).toContain('pilot');
    // Four passengers: a second saboteur would be half the cabin, so the Pilot stays loyal.
    expect(dealRoles({ rng: 1 }, cards, 4, 0, 1)).toContain('pilot');
    expect(isPilot('pilot_rogue')).toBe(true);
    expect(isPilot('stewardess_rogue')).toBe(false);
  });

  it('fit one to a flight deck, with odds the host can set', () => {
    expect(validateCards({ ...emptyCards(), bomber: 1, pilot: 2 }, 8, 0)).toBe('Only one Pilot fits on the flight deck.');
    expect(defaultSettings().pilotRogueChance).toBe(0.3);
    expect(validateSettings({ ...defaultSettings(), pilotRogueChance: 2 })).toBe('Pilot odds must be between 0 and 1.');
  });
});


const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: MoveTarget) => applyIntent(s, id, { kind: 'move', to }, 0);

/** A Pilot on the flight deck of an 8-row cabin, a Bomber in row 1, and passengers down the plane. */
function cabin(extra: TestPlayer[] = [], role: TestPlayer['role'] = 'pilot'): GameState {
  return makeGame([
    { id: 'pilot', role, seat: COCKPIT },
    { id: 'bomber', role: 'bomber', seat: '1C' },
    { id: 'front', role: 'passenger', seat: '1D' },
    { id: 'mid', role: 'passenger', seat: '4B' },
    { id: 'back', role: 'passenger', seat: '7F' },
    { id: 'p5', role: 'passenger', seat: '8A' },
    ...extra,
  ]);
}

describe('the flight deck', () => {
  it('seats the Pilot at takeoff', () => {
    const settings = { ...defaultSettings(), maxPassengers: 8, rolesMode: 'custom' as const, cards: { ...emptyCards(), bomber: 1, pilot: 1 } };
    const roster = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    const s = createGame({ settings, players: roster, seed: 5, now: 0 });
    const onDeck = s.players.filter((p) => p.seat === COCKPIT);
    expect(onDeck).toHaveLength(1);
    expect(isPilot(onDeck[0].role)).toBe(true);
  });

  it('is where the Pilot sits, and he never leaves it', () => {
    const s = cabin();
    expect(parsePlace(COCKPIT)).toEqual({ row: -3, col: 3 });
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'pilot', '5A')).toEqual({ ok: false, error: 'The Pilot stays on the flight deck.' });
    expect(move(s, 'pilot', 'washroom').ok).toBe(false);
    expect(viewFor(s, 'pilot', 0).options?.seats).toEqual([]);
    expect(viewFor(s, 'pilot', 0).options?.washroom).toBe('You cannot leave the flight deck.');
  });

  it('is out of reach of blasts in row 1', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'front').status).toBe('dead');
    expect(player(s, 'pilot').status).toBe('alive');
  });

  it('has no seat to look under', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'pilot', { kind: 'search' })).toEqual({ ok: false, error: 'You have no seat to look under.' });
  });
});
