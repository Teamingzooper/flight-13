import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { normalizeGame } from './state';
import { advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { DestinationId, GameState, NightAction, PlayerState } from './types';
import { viewFor } from './view';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: string) => applyIntent(s, id, { kind: 'move', to }, 0);

/** One bomber among six passengers in an 8-row cabin, flying to London (5 nights) unless told otherwise. */
function cabin(destination: DestinationId = 'LHR'): GameState {
  return makeGame(
    [
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'near1', role: 'passenger', seat: '5C' },
      { id: 'near2', role: 'passenger', seat: '6A' },
      { id: 'far', role: 'passenger', seat: '4E' },
      { id: 'nurse', role: 'nurse', seat: '1F' },
      { id: 'pilot', role: 'pilot', seat: '8F' },
      { id: 'inv', role: 'investigator', seat: '2E' },
    ],
    { destination },
  );
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

  it('a Bomber carries a bomb for every three nights and plants at most one a night', () => {
    const s = cabin();
    expect(viewFor(s, 'bomber', 0).you?.bombsLeft).toBe(2);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    expect(viewFor(s, 'bomber', 0).you?.bombsLeft).toBe(1);
    move(s, 'bomber', '1A');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 })).toEqual({ ok: true });
    advanceTo(s, 'night_act', 3);
    expect(player(s, 'bomber').bombsPlanted).toBe(2);
    expect(s.bombs.map((b) => b.location)).toEqual([
      { kind: 'seat', seat: '4B' },
      { kind: 'seat', seat: '1A' },
    ]);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You have no bombs left.' });
    expect(viewFor(s, 'bomber', 0).you?.bombsLeft).toBe(0);
  });

  it('a three-night flight gives one bomb', () => {
    const s = cabin('LAS');
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1A');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You have no bombs left.' });
  });

  it('a seat holds one live bomb at a time', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'There is already a bomb there.' });
  });

  it('two saboteurs picking the lavatory on the same night: the second one keeps their bomb', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '8B' },
      { id: 'mm', role: 'mastermind', seat: '8C' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '2A' },
      { id: 'p3', role: 'passenger', seat: '3A' },
      { id: 'p4', role: 'passenger', seat: '4A' },
      { id: 'p5', role: 'passenger', seat: '5A' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 2 })).toEqual({ ok: true });
    expect(act(s, 'mm', { kind: 'plant', where: 'lavatory', fuse: 2 })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(s.bombs).toHaveLength(1);
    const kept = [player(s, 'bomber'), player(s, 'mm')].find((p) => p.bombsPlanted === 0)!;
    expect(kept).toBeDefined();
    expect(logTexts(s, kept.id)).toContain('Someone had already planted a bomb in the lavatory. You kept yours.');
    advanceTo(s, 'night_act', 2);
    expect(act(s, kept.id, { kind: 'plant', where: 'lavatory', fuse: 1 })).toEqual({ ok: false, error: 'There is already a bomb there.' });
  });

  it('a game saved before bomb counts treats a used bomb as one planted', () => {
    const s = cabin('LAS');
    const old = player(s, 'bomber') as Partial<PlayerState> & { bombUsed?: boolean };
    delete old.bombsPlanted;
    old.bombUsed = true;
    normalizeGame(s);
    expect(player(s, 'bomber').bombsPlanted).toBe(1);
    expect('bombUsed' in player(s, 'bomber')).toBe(false);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You have no bombs left.' });
  });

  it('cart and lavatory bombs require sitting next to them', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 }).ok).toBe(false);
    expect(act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 1 }).ok).toBe(false);
  });

  it('a cart bomb goes off wherever the Stewardess walked the cart, and takes her with it', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '2C' },
      { id: 'stew', role: 'stewardess_loyal', seat: 'Aisle 1' },
      { id: 'target', role: 'passenger', seat: '6E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '3F' },
      { id: 'p3', role: 'passenger', seat: '8F' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'stew', 'Aisle 6')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 2);
    expect(s.cabin.cartRow).toBe(6);
    advanceTo(s, 'dawn', 2);
    expect(s.cabin.cartDestroyed).toBe(true);
    expect(player(s, 'target').status).toBe('dead');
    expect(player(s, 'stew').status).toBe('dead');
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
      { id: 'rogue', role: 'stewardess_rogue', seat: 'Aisle 5' },
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
    // Each result says who it was about, as data.
    const mine = (id: string, tag: string) => s.log.find((e) => e.tag === tag && Array.isArray(e.to) && e.to.includes(id))!;
    expect(mine('rogue', 'serve').data).toEqual({ target: 'victim' });
    expect(mine('nurse', 'treat').data).toEqual({ target: 'victim' });
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
    // The seats the sweep covered, as data (the eight around 4E, and 4E itself).
    const entry = s.log.find((e) => e.tag === 'sweep' && Array.isArray(e.to) && e.to.includes('inv'))!;
    expect(entry.data!.bombs).toEqual([s.bombs[0].id]);
    expect([...(entry.data!.seats as string[])].sort()).toEqual(['3D', '3E', '3F', '4D', '4E', '4F', '5D', '5E', '5F']);
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

  it('the loyal Stewardess checks one side of her row, and misses the Mastermind', () => {
    const s = makeGame([
      { id: 'stew', role: 'stewardess_loyal', seat: 'Aisle 5' },
      { id: 'mm', role: 'mastermind', seat: '3C' },
      { id: 'bomber', role: 'bomber', seat: '5E' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '5A' },
      { id: 'p3', role: 'passenger', seat: '7A' },
      { id: 'p4', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'mm', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    expect(act(s, 'stew', { kind: 'serve', target: 'bomber' }).ok).toBe(false);
    expect(act(s, 'stew', { kind: 'check', side: 'right' })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'stew', 'Aisle 3')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 2);
    act(s, 'stew', { kind: 'check', side: 'left' });
    advanceTo(s, 'dawn', 2);
    const bomb = s.bombs.find((b) => b.planterId === 'bomber')!;
    expect(player(s, 'stew').knownBombIds).toEqual([bomb.id]);
    expect(logTexts(s, 'stew')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^You worked row 5, checked under 5D, 5E and 5F and found a bomb: under seat 5E/),
        'You worked row 3 and checked under 3A, 3B and 3C. No bombs.',
      ]),
    );
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
