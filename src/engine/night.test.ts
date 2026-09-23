import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, NightAction } from './types';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: string) => applyIntent(s, id, { kind: 'move', to }, 0);

/** One bomber among six passengers in an 8-row cabin. */
function cabin(): GameState {
  return makeGame([
    { id: 'bomber', role: 'bomber', seat: '4B' },
    { id: 'near1', role: 'passenger', seat: '5C' },
    { id: 'near2', role: 'passenger', seat: '6A' },
    { id: 'far', role: 'passenger', seat: '4E' },
    { id: 'nurse', role: 'nurse', seat: '1F' },
    { id: 'pilot', role: 'pilot', seat: '8F' },
    { id: 'inv', role: 'investigator', seat: '2E' },
  ]);
}

describe('bombs', () => {
  it('a seat bomb with fuse 1 goes off at the end of the next night, and the bomber can flee', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].exploded).toBe(false);
    expect(player(s, 'near1').status).toBe('alive');
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'bomber', '1A')).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(s.bombs[0].exploded).toBe(true);
    expect(player(s, 'near1').status).toBe('dead');
    expect(player(s, 'near2').status).toBe('dead');
    expect(player(s, 'far').status).toBe('alive');
    expect(player(s, 'bomber').status).toBe('alive');
    expect(logTexts(s, 'all').some((t) => t.startsWith('BOOM! A bomb went off under seat 4B.'))).toBe(true);
    expect(s.cabin.scorched).toEqual([{ row: 4, col: 1 }]);
  });

  it('a bomber buckled in by the Pilot cannot flee their own bomb', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'bomber' }, 0)).toEqual({ ok: true });
    expect(move(s, 'bomber', '1A')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 2);
    expect(player(s, 'bomber').seat).toBe('4B');
    expect(logTexts(s, 'bomber').some((t) => t.includes('seatbelt sign lit up'))).toBe(true);
    expect(act(s, 'bomber', null).ok).toBe(false);
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'bomber').status).toBe('dead');
    expect(s.result).toMatchObject({ winner: 'passengers', reason: 'eliminated' });
  });

  it('a fuse of 2 waits two nights', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1A');
    advanceTo(s, 'dawn', 2);
    expect(s.bombs[0].exploded).toBe(false);
    advanceTo(s, 'dawn', 3);
    expect(s.bombs[0].exploded).toBe(true);
    expect(player(s, 'near1').status).toBe('dead');
  });

  it('each bomber gets one bomb per game', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You already used your bomb.' });
  });

  it('cart and lavatory bombs require sitting next to them', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 }).ok).toBe(false);
    expect(act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 1 }).ok).toBe(false);
  });

  it('a cart bomb goes off wherever the Stewardess rolled the cart', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '2C' },
      { id: 'stew', role: 'stewardess_loyal', seat: '8A' },
      { id: 'target', role: 'passenger', seat: '6E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '3F' },
      { id: 'p3', role: 'passenger', seat: '8F' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 })).toEqual({ ok: true });
    expect(act(s, 'stew', { kind: 'serve', target: 'target' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(s.cabin.cartRow).toBe(6);
    advanceTo(s, 'dawn', 2);
    expect(s.cabin.cartDestroyed).toBe(true);
    expect(player(s, 'target').status).toBe('dead');
    expect(player(s, 'stew').status).toBe('alive');
    expect(player(s, 'bomber').status).toBe('alive');
    expect(player(s, 'p3').status).toBe('alive');
  });

  it('a lavatory bomb destroys the lavatory and hits the back rows', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '8B' },
      { id: 'back', role: 'passenger', seat: '7D' },
      { id: 'safe', role: 'passenger', seat: '8E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '2A' },
      { id: 'p3', role: 'passenger', seat: '3A' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 1 })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1B');
    advanceTo(s, 'dawn', 2);
    expect(s.cabin.lavatoryDestroyed).toBe(true);
    expect(player(s, 'back').status).toBe('dead');
    expect(player(s, 'safe').status).toBe('alive');
    expect(player(s, 'bomber').status).toBe('alive');
  });

  it('the Nurse must sit next to a patient, and treatment survives a blast', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    expect(act(s, 'nurse', { kind: 'treat', target: 'near1' }).ok).toBe(false);
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1A');
    move(s, 'nurse', '5B');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'nurse', { kind: 'treat', target: 'near1' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'near1').status).toBe('alive');
    expect(player(s, 'nurse').status).toBe('dead');
    expect(logTexts(s, 'near1').some((t) => t.includes('kept you alive'))).toBe(true);
  });
});

describe('poison', () => {
  function poisonCabin(): GameState {
    return makeGame([
      { id: 'rogue', role: 'stewardess_rogue', seat: '1A' },
      { id: 'bomber', role: 'bomber', seat: '1F' },
      { id: 'victim', role: 'passenger', seat: '5E' },
      { id: 'nurse', role: 'nurse', seat: '7A' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '3F' },
      { id: 'p3', role: 'passenger', seat: '8F' },
    ]);
  }

  it('kills at the second dawn unless the Nurse treats the victim', () => {
    const s = poisonCabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'rogue', { kind: 'serve', target: 'victim' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'victim').poisonedNight).toBe(1);
    expect(logTexts(s, 'victim').some((t) => t.startsWith('You feel sick'))).toBe(true);
    expect(s.cabin.cartRow).toBe(5);
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'victim').status).toBe('dead');
    expect(player(s, 'victim').cause).toBe('poison');
  });

  it('is cured by a treatment the next night', () => {
    const s = poisonCabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'rogue', { kind: 'serve', target: 'victim' });
    advanceTo(s, 'night_move', 2);
    move(s, 'nurse', '5F');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'nurse', { kind: 'treat', target: 'victim' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'victim').status).toBe('alive');
    expect(player(s, 'victim').poisonedNight).toBeNull();
  });

  it('fails when the victim is treated the same night', () => {
    const s = poisonCabin();
    advanceTo(s, 'night_move', 1);
    move(s, 'nurse', '5F');
    advanceTo(s, 'night_act', 1);
    act(s, 'rogue', { kind: 'serve', target: 'victim' });
    act(s, 'nurse', { kind: 'treat', target: 'victim' });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'victim').poisonedNight).toBeNull();
    expect(logTexts(s, 'victim').some((t) => t.includes('neutralized'))).toBe(true);
  });
});

describe('investigation', () => {
  it('a sweep finds seat bombs within 1, including ones planted the same night', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '5D' },
      { id: 'inv', role: 'investigator', seat: '4E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '2A' },
      { id: 'p3', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'inv', { kind: 'sweep' });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'inv').knownBombIds).toEqual([s.bombs[0].id]);
    expect(logTexts(s, 'inv').some((t) => t.includes('under seat 5D'))).toBe(true);
  });

  it('inspecting the cart needs adjacency and finds cart bombs', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '2C' },
      { id: 'inv', role: 'investigator', seat: '3E' },
      { id: 'p1', role: 'passenger', seat: '6A' },
      { id: 'p2', role: 'passenger', seat: '7A' },
      { id: 'p3', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'inv', { kind: 'inspect', what: 'cart' }).ok).toBe(false);
    act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    move(s, 'inv', '2D');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'inv', { kind: 'inspect', what: 'cart' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'inv').knownBombIds).toHaveLength(1);
  });

  it('the loyal Stewardess learns teams, and the Mastermind passes as a passenger', () => {
    const s = makeGame([
      { id: 'stew', role: 'stewardess_loyal', seat: '1A' },
      { id: 'mm', role: 'mastermind', seat: '3C' },
      { id: 'bomber', role: 'bomber', seat: '6F' },
      { id: 'p1', role: 'passenger', seat: '4A' },
      { id: 'p2', role: 'passenger', seat: '5A' },
      { id: 'p3', role: 'passenger', seat: '7A' },
      { id: 'p4', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'stew', { kind: 'serve', target: 'mm' });
    advanceTo(s, 'night_act', 2);
    act(s, 'stew', { kind: 'serve', target: 'bomber' });
    advanceTo(s, 'dawn', 2);
    const results = logTexts(s, 'stew').filter((t) => t.startsWith('You served'));
    expect(results[0]).toContain('Passenger team');
    expect(results[1]).toContain('Saboteur team');
  });
});

describe('moving seats and the seatbelt sign', () => {
  it('a seat can only be taken if it was empty, and ties are settled at random', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'far', '4B').ok).toBe(false);
    expect(move(s, 'near1', '2A')).toEqual({ ok: true });
    expect(move(s, 'near2', '2A')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    const winners = ['near1', 'near2'].filter((id) => player(s, id).seat === '2A');
    expect(winners).toHaveLength(1);
    const loser = winners[0] === 'near1' ? 'near2' : 'near1';
    expect(logTexts(s, loser).some((t) => t.startsWith('Someone beat you to 2A'))).toBe(true);
  });

  it('the Pilot cannot buckle themselves or the same passenger two nights running', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'pilot' }, 0).ok).toBe(false);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'far' }, 0)).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'far' }, 0).ok).toBe(false);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'near1' }, 0)).toEqual({ ok: true });
  });
});

describe('destination twists', () => {
  const crew = (): TestPlayer[] => [
    { id: 'bomber', role: 'bomber', seat: '4B' },
    { id: 'p1', role: 'passenger', seat: '1A' },
    { id: 'p2', role: 'passenger', seat: '2A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
    { id: 'p4', role: 'passenger', seat: '5A' },
  ];

  it('Honolulu buckles a random passenger in at the start of each night', () => {
    const s = makeGame(crew(), { destination: 'HNL' });
    advanceTo(s, 'night_move', 1);
    const buckled = Object.keys(s.night.buckled);
    expect(buckled).toHaveLength(1);
    expect(s.night.buckled[buckled[0]]).toBe('turbulence');
    expect(move(s, buckled[0], '8F').ok).toBe(false);
    expect(logTexts(s, 'all').some((t) => t.startsWith('Turbulence!'))).toBe(true);
  });

  it('Bermuda can send the cart rolling or black out the seat map', () => {
    const s = makeGame(crew(), { destination: 'BDA' });
    advanceTo(s, 'night_move', 1);
    s.night.anomaly = 'runaway_cart';
    s.night.buckled = {};
    advanceTo(s, 'dawn', 1);
    expect(logTexts(s, 'all').some((t) => t.includes('broke loose'))).toBe(true);
    advanceTo(s, 'night_move', 2);
    s.night.anomaly = 'blackout';
    s.night.buckled = {};
    advanceTo(s, 'dawn', 2);
    expect(s.blackoutNight).toBe(2);
  });
});
