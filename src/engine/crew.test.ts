import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import type { ItemUse } from './items';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { TEST_LOOK, advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, ItemId, MoveTarget, NightAction } from './types';
import { viewFor } from './view';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: MoveTarget) => applyIntent(s, id, { kind: 'move', to }, 0);
const pack = (s: GameState, id: string, items: ItemId[]) => applyIntent(s, id, { kind: 'pack', items, ready: true }, 0);
const use = (s: GameState, id: string, u: ItemUse) => applyIntent(s, id, { kind: 'use', ...u }, 0);

/** A rogue Stewardess working row 5 of an 8-row cabin, with people on both sides of her. */
function cabin(extra: TestPlayer[] = [], stewardess: TestPlayer['role'] = 'stewardess_rogue'): GameState {
  return makeGame([
    { id: 'stew', role: stewardess, seat: 'Aisle 5' },
    { id: 'bomber', role: 'bomber', seat: '8B' },
    { id: 'left', role: 'passenger', seat: '5C' },
    { id: 'right', role: 'passenger', seat: '5D' },
    { id: 'front', role: 'passenger', seat: '2A' },
    { id: 'back', role: 'passenger', seat: '7F' },
    ...extra,
  ]);
}

describe('the Stewardess works the aisle', () => {
  it('starts in the aisle with the cart instead of a seat', () => {
    const settings = { ...defaultSettings(), maxPassengers: 8, rolesMode: 'custom' as const, cards: { ...defaultSettings().cards, bomber: 1, stewardess: 2 } };
    const roster = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
    const s = createGame({ settings, players: roster, seed: 3, now: 0 });
    const crew = s.players.filter((p) => p.role.startsWith('stewardess'));
    expect(crew.map((p) => p.seat)).toEqual(['Aisle 1', 'Aisle 8']);
    expect(s.players.filter((p) => !p.role.startsWith('stewardess')).every((p) => /^\d+[A-F]$/.test(p.seat!))).toBe(true);
    expect(s.cabin.cartRow).toBe(1);
  });

  it('walks up and down the aisle, and nobody else can stand there', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'stew', '6B')).toEqual({ ok: false, error: 'Crew stay in the aisle. Pick a row to walk the cart to.' });
    expect(move(s, 'stew', 'Aisle 9').ok).toBe(false);
    expect(move(s, 'front', 'Aisle 3')).toEqual({ ok: false, error: 'That seat does not exist.' });
    expect(viewFor(s, 'stew', 0).options?.seats).toEqual(['Aisle 1', 'Aisle 2', 'Aisle 3', 'Aisle 4', 'Aisle 6', 'Aisle 7', 'Aisle 8']);
    expect(move(s, 'stew', 'Aisle 2')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    expect(player(s, 'stew').seat).toBe('Aisle 2');
    expect(s.cabin.cartRow).toBe(2);
    expect(logTexts(s, 'all')).toContain('The drink cart is now at row 2.');
  });

  it('a rogue Stewardess can only poison someone sitting in her row', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'stew', { kind: 'serve', target: 'back' })).toEqual({ ok: false, error: 'back is not sitting in your row. Walk the cart to them first.' });
    expect(act(s, 'stew', { kind: 'check', side: 'left' }).ok).toBe(false);
    expect(viewFor(s, 'stew', 0).options?.actions).toEqual([
      { kind: 'serve', target: 'left' },
      { kind: 'serve', target: 'right' },
    ]);
    expect(act(s, 'stew', { kind: 'serve', target: 'right' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'right').poisonedNight).toBe(1);
  });

  it('a loyal Stewardess checks the left or right of her row and has no seat to look under', () => {
    const s = cabin([], 'stewardess_loyal');
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'stew', 0).options?.actions).toEqual([
      { kind: 'check', side: 'left' },
      { kind: 'check', side: 'right' },
    ]);
    expect(act(s, 'stew', { kind: 'search' })).toEqual({ ok: false, error: 'You have no seat to look under.' });
  });

  it('is in reach of blasts, the Nurse and the handcuffs from the aisle', () => {
    const s = cabin([
      { id: 'nurse', role: 'nurse', seat: '4C' },
      { id: 'marshal', role: 'marshal', seat: '3D' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'nurse', { kind: 'treat', target: 'stew' })).toEqual({ ok: true });
    expect(act(s, 'marshal', { kind: 'cuff', target: 'stew' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'stew').status).toBe('restrained');
  });

  it('dies in a blast two cells from her aisle spot', () => {
    const s = cabin([{ id: 'b2', role: 'bomber', seat: '3E' }]);
    advanceTo(s, 'night_act', 1);
    act(s, 'b2', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    move(s, 'b2', '1F');
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'stew').status).toBe('dead');
    expect(player(s, 'right').status).toBe('dead');
    expect(player(s, 'left').status).toBe('alive');
  });

  it('the Pilot can hold her at her post for the night', () => {
    const s = cabin([{ id: 'pilot', role: 'pilot', seat: '1A' }]);
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'stew' }, 0);
    move(s, 'stew', 'Aisle 2');
    advanceTo(s, 'night_act', 1);
    expect(player(s, 'stew').seat).toBe('Aisle 5');
    expect(logTexts(s, 'stew')).toContain(
      'Ding. The captain told the crew to stay put. You are stuck at your post tonight and cannot use an ability.',
    );
    expect(act(s, 'stew', { kind: 'serve', target: 'left' }).ok).toBe(false);
  });
});

describe('the drink cart', () => {
  it('blocks the aisle: nobody walks past it, but you can get into or out of its row', () => {
    const s = cabin([{ id: 'mid', role: 'passenger', seat: '5A' }]);
    advanceTo(s, 'night_move', 2);
    expect(s.cabin.cartRow).toBe(5);
    expect(move(s, 'front', '7A')).toEqual({ ok: false, error: 'The drink cart is blocking the aisle at row 5.' });
    expect(move(s, 'back', '1A')).toEqual({ ok: false, error: 'The drink cart is blocking the aisle at row 5.' });
    expect(move(s, 'front', '5B')).toEqual({ ok: true });
    expect(move(s, 'back', '5E')).toEqual({ ok: true });
    expect(move(s, 'mid', '1A')).toEqual({ ok: true });
    const seats = viewFor(s, 'front', 0).options!.seats;
    expect(seats).toContain('4F');
    expect(seats).toContain('5F');
    expect(seats).not.toContain('6A');
  });

  it('rolls with the Stewardess wherever she walks', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 2);
    move(s, 'stew', 'Aisle 8');
    advanceTo(s, 'night_act', 2);
    expect(s.cabin.cartRow).toBe(8);
  });

  it('stays where it was once nobody is left to push it', () => {
    const s = cabin();
    advanceTo(s, 'day_vote', 1);
    for (const p of s.players) if (p.id !== 'stew') applyIntent(s, p.id, { kind: 'vote', target: 'stew' }, 0);
    advanceTo(s, 'night_act', 2);
    expect(player(s, 'stew').status).toBe('restrained');
    expect(s.cabin.cartRow).toBe(5);
  });
});

describe('the washroom', () => {
  it('hides you for the night, once per flight, and you are back in your seat by morning', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(viewFor(s, 'back', 0).options?.washroom).toBeNull();
    expect(move(s, 'back', 'washroom')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'front', 0).washroom).toBe('back');
    expect(viewFor(s, 'back', 0).you?.inWashroom).toBe(true);
    expect(logTexts(s, 'all')).toContain('back went to the lavatory. The door is locked for the night.');
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'back').seat).toBe('7F');
    expect(viewFor(s, 'front', 0).washroom).toBeNull();
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'back', 'washroom')).toEqual({ ok: false, error: 'You already used the washroom on this flight.' });
    expect(viewFor(s, 'back', 0).options?.washroom).toBe('You already used the washroom on this flight.');
  });

  it('washes out poison', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'stew', { kind: 'serve', target: 'right' });
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'right', 'washroom')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 2);
    expect(player(s, 'right').poisonedNight).toBeNull();
    expect(logTexts(s, 'right').some((t) => t.includes('You rinsed the poison out at the sink'))).toBe(true);
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'right').status).toBe('alive');
  });

  it('puts you out of reach of drinks, handcuffs, the Nurse and sleeping pills', () => {
    const s = cabin([
      { id: 'marshal', role: 'marshal', seat: '6D' },
      { id: 'nurse', role: 'nurse', seat: '4D' },
    ]);
    pack(s, 'left', ['pills']);
    advanceTo(s, 'night_move', 1);
    move(s, 'right', 'washroom');
    advanceTo(s, 'night_act', 1);
    const locked = { ok: false, error: 'right is locked in the lavatory tonight.' };
    expect(act(s, 'stew', { kind: 'serve', target: 'right' })).toEqual(locked);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'right' })).toEqual(locked);
    expect(act(s, 'nurse', { kind: 'treat', target: 'right' })).toEqual(locked);
    expect(use(s, 'left', { item: 'pills', target: 'right' })).toEqual(locked);
    expect(viewFor(s, 'stew', 0).options?.actions).toEqual([{ kind: 'serve', target: 'left' }]);
  });

  it('you can only search the lavatory (or, with a bomb, leave one there)', () => {
    const s = cabin([{ id: 'inv', role: 'investigator', seat: '1C' }]);
    advanceTo(s, 'night_move', 1);
    move(s, 'inv', 'washroom');
    move(s, 'bomber', 'washroom');
    advanceTo(s, 'night_act', 1);
    const inside = s.night.washroom!;
    expect(viewFor(s, inside, 0).options?.actions).toEqual(
      inside === 'inv'
        ? [{ kind: 'search' }]
        : [
            { kind: 'plant', where: 'lavatory', fuse: 1 },
            { kind: 'plant', where: 'lavatory', fuse: 2 },
            { kind: 'search' },
          ],
    );
    const outside = inside === 'inv' ? 'bomber' : 'inv';
    expect(player(s, outside).washroomUsed).toBe(false);
    expect(logTexts(s, outside)).toContain(`Someone beat you to the lavatory. You stayed in ${player(s, outside).seat}.`);
  });

  it('a blast at your empty seat misses you, but a bomb in the lavatory does not', () => {
    const s = cabin([{ id: 'b2', role: 'bomber', seat: '3A' }]);
    advanceTo(s, 'night_act', 1);
    act(s, 'b2', { kind: 'plant', where: 'seat', fuse: 1 });
    act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    move(s, 'b2', 'washroom');
    move(s, 'front', '3C');
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'front').status).toBe('dead');
    expect(player(s, 'b2').status).toBe('dead');
    expect(s.cabin.lavatoryDestroyed).toBe(true);
  });

  it('you can search the lavatory and defuse what you find', () => {
    const s = cabin([{ id: 'p9', role: 'passenger', seat: '7A' }]);
    pack(s, 'p9', ['defuser']);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'p9', 'washroom')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 2);
    expect(use(s, 'p9', { item: 'defuser' }).ok).toBe(false);
    expect(act(s, 'p9', { kind: 'search' })).toEqual({ ok: true });
    expect(logTexts(s, 'p9').some((t) => t.startsWith('Behind the mirror panel you found a bomb'))).toBe(true);
    expect(use(s, 'p9', { item: 'defuser' })).toEqual({ ok: true });
    expect(logTexts(s, 'p9')).toContain('You cut the wires. The bomb in the lavatory is dead.');
    advanceTo(s, 'dawn', 3);
    expect(s.bombs[0]).toMatchObject({ defused: true, exploded: false });
    expect(s.cabin.lavatoryDestroyed).toBe(false);
  });

  it('is out of reach past the drink cart, or when buckled in', () => {
    const s = cabin([{ id: 'pilot', role: 'pilot', seat: '1B' }]);
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'front', 'washroom')).toEqual({ ok: false, error: 'The drink cart is blocking the aisle at row 5.' });
    expect(move(s, 'left', 'washroom')).toEqual({ ok: true });
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'left' }, 0);
    advanceTo(s, 'night_act', 2);
    expect(s.night.washroom).toBeNull();
    expect(player(s, 'left').washroomUsed).toBe(false);
  });

  it('keeps your seat for you while you are away', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    move(s, 'back', 'washroom');
    expect(move(s, 'front', '7F')).toEqual({ ok: false, error: 'That seat is taken.' });
  });
});
