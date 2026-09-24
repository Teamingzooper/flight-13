import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { presetCards, validateCards } from './roles';
import { normalizeGame } from './state';
import { advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, NightAction, PlayerState, Settings } from './types';
import { viewFor } from './view';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: string) => applyIntent(s, id, { kind: 'move', to }, 0);
const note = (s: GameState, id: string, text: string) => applyIntent(s, id, { kind: 'note', text }, 0);
const voteAll = (s: GameState, target: string) => {
  for (const p of s.players) if (p.status === 'alive' && p.id !== target) applyIntent(s, p.id, { kind: 'vote', target }, 0);
};

/** Eight passengers in an 8-row cabin: a Bomber and a Mastermind among them. */
function cabin(extra: TestPlayer[] = [], settings: Partial<Settings> = {}): GameState {
  return makeGame(
    [
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'mastermind', role: 'mastermind', seat: '8A' },
      { id: 'marshal', role: 'marshal', seat: '4E' },
      { id: 'pilot', role: 'pilot', seat: '8F' },
      { id: 'nurse', role: 'nurse', seat: '1F' },
      { id: 'p1', role: 'passenger', seat: '6A' },
      { id: 'p2', role: 'passenger', seat: '2D' },
      { id: 'p3', role: 'passenger', seat: '7C' },
      ...extra,
    ],
    { settings },
  );
}

describe('look under your seat', () => {
  it('finds a bomb left by the previous occupant at once, and uses up the night', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 }).ok).toBe(true);
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'bomber', '1A').ok).toBe(true);
    advanceTo(s, 'night_move', 3);
    expect(move(s, 'p1', '4B').ok).toBe(true);
    advanceTo(s, 'night_act', 3);
    expect(player(s, 'p1').seat).toBe('4B');

    expect(act(s, 'p1', { kind: 'search' })).toEqual({ ok: true });
    const bomb = s.bombs[0];
    expect(player(s, 'p1').knownBombIds).toEqual([bomb.id]);
    expect(logTexts(s, 'p1').some((t) => t.startsWith('You looked under 4B and found a bomb'))).toBe(true);
    expect(viewFor(s, 'p1', 0).bombs.map((b) => b.id)).toEqual([bomb.id]);
    expect(viewFor(s, 'p1', 0).you?.searched).toBe(true);
    // The answer came at once, so the night is spent: no switching to something else.
    expect(act(s, 'p1', null).ok).toBe(false);
    expect(act(s, 'p1', { kind: 'search' }).ok).toBe(false);
  });

  it('finds nothing under a clean seat', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'p2', { kind: 'search' }).ok).toBe(true);
    expect(logTexts(s, 'p2').some((t) => t.startsWith('You looked under 2D. Nothing'))).toBe(true);
    expect(player(s, 'p2').knownBombIds).toEqual([]);
  });

  it('is open to every role, but not while buckled in', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'p2' }, 0).ok).toBe(true);
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'nurse', 0).options?.actions).toContainEqual({ kind: 'search' });
    expect(act(s, 'p2', { kind: 'search' }).ok).toBe(false);
  });
});

describe('Air Marshal', () => {
  it('handcuffs someone within 2 seats: their action is cancelled and they are restrained at dawn', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'marshal', '4C').ok).toBe(true);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 }).ok).toBe(true);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'bomber' }).ok).toBe(true);
    advanceTo(s, 'dawn', 1);
    const bomber = player(s, 'bomber');
    expect(bomber.status).toBe('restrained');
    expect(bomber.seat).toBeNull();
    expect(s.bombs).toHaveLength(0);
    expect(player(s, 'marshal').cuffsUsed).toBe(true);
    expect(logTexts(s, 'all').some((t) => t.startsWith('The Air Marshal handcuffed bomber'))).toBe(true);
    expect(logTexts(s, 'bomber').some((t) => t.includes('handcuffed before you could'))).toBe(true);
    expect(s.result).toBeNull();
  });

  it('has one pair of handcuffs, a reach of 2 seats, and nobody else carries any', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    // 4E to 4B is four columns away.
    expect(act(s, 'marshal', { kind: 'cuff', target: 'bomber' }).ok).toBe(false);
    expect(act(s, 'p1', { kind: 'cuff', target: 'bomber' }).ok).toBe(false);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'p2' }).ok).toBe(true);
    advanceTo(s, 'night_act', 2);
    expect(player(s, 'p2').status).toBe('restrained');
    expect(act(s, 'marshal', { kind: 'cuff', target: 'nurse' })).toEqual({ ok: false, error: 'You already used your handcuffs.' });
  });

  it('stops anyone else getting to the person in cuffs that night', () => {
    const s = cabin([{ id: 'stew', role: 'stewardess_loyal', seat: '6F' }]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'p2' }).ok).toBe(true);
    expect(act(s, 'stew', { kind: 'serve', target: 'p2' }).ok).toBe(true);
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'p2').status).toBe('restrained');
    expect(logTexts(s, 'stew').some((t) => t.includes('handcuffed and led away before you got to them'))).toBe(true);
  });

  it('comes with bigger flights', () => {
    expect(presetCards(9).marshal).toBe(0);
    expect(presetCards(10).marshal).toBe(1);
    expect(presetCards(16).marshal).toBe(1);
    for (let n = 4; n <= 16; n++) expect(validateCards(presetCards(n), n, 0.5)).toBeNull();
  });
});

describe('black box notes', () => {
  it('are read out when a bomb kills the writer', () => {
    const s = cabin();
    expect(note(s, 'p1', '  The bomber sits in 4B.  ').ok).toBe(true);
    expect(viewFor(s, 'p1', 0).you?.note).toBe('The bomber sits in 4B.');
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    // A 1-night fuse goes off at the end of the next night.
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'p1').status).toBe('dead');
    const all = logTexts(s, 'all');
    const boom = all.findIndex((t) => t.startsWith('BOOM!'));
    const read = all.findIndex((t) => t === 'p1’s black box note: “The bomber sits in 4B.”');
    expect(boom).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(boom);
  });

  it('are read out when the writer is restrained, by vote or by handcuffs', () => {
    const s = cabin();
    note(s, 'p2', 'Vote carefully.');
    note(s, 'nurse', 'I am the Nurse.');
    advanceTo(s, 'night_act', 1);
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'p2');
    advanceTo(s, 'verdict', 1);
    expect(logTexts(s, 'all')).toContain('p2’s black box note: “Vote carefully.”');

    advanceTo(s, 'night_move', 2);
    move(s, 'marshal', '2E');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'nurse' }).ok).toBe(true);
    advanceTo(s, 'dawn', 2);
    expect(logTexts(s, 'all')).toContain('nurse’s black box note: “I am the Nurse.”');
  });

  it('stay private until then, and only people in play can write them', () => {
    const s = cabin();
    note(s, 'p3', 'secret');
    expect(JSON.stringify(viewFor(s, 'p2', 0))).not.toContain('secret');
    expect(note(s, 'p3', 'x'.repeat(301)).ok).toBe(false);
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'p3');
    advanceTo(s, 'verdict', 1);
    expect(note(s, 'p3', 'too late').ok).toBe(false);
  });

  it('say nothing when left empty', () => {
    const s = cabin();
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'p3');
    advanceTo(s, 'verdict', 1);
    expect(s.log.some((e) => e.tag === 'note')).toBe(false);
  });
});

describe('Pilot must fly', () => {
  it('hands the saboteurs the win when the passengers restrain the Pilot', () => {
    const s = cabin([], { pilotMustFly: true });
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'pilot');
    advanceTo(s, 'verdict', 1);
    expect(s.result).toMatchObject({ winner: 'saboteurs', reason: 'pilot' });
  });

  it('is off unless the host turns it on', () => {
    const s = cabin();
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'pilot');
    advanceTo(s, 'verdict', 1);
    expect(s.result).toBeNull();
  });

  it('lets a second Pilot keep the plane in the air', () => {
    const s = cabin([{ id: 'copilot', role: 'pilot', seat: '5F' }], { pilotMustFly: true });
    advanceTo(s, 'day_vote', 1);
    voteAll(s, 'pilot');
    advanceTo(s, 'verdict', 1);
    expect(s.result).toBeNull();
  });
});

describe('games saved by an older version', () => {
  it('get the new fields filled in', () => {
    const s = cabin();
    const old = JSON.parse(JSON.stringify(s)) as GameState;
    delete (old.settings as Partial<Settings>).pilotMustFly;
    delete (old.settings.cards as Partial<Settings['cards']>).marshal;
    delete (old.night as Partial<GameState['night']>).searched;
    for (const p of old.players) {
      delete (p as Partial<PlayerState>).note;
      delete (p as Partial<PlayerState>).cuffsUsed;
    }
    const fixed = normalizeGame(old);
    expect(fixed.settings.pilotMustFly).toBe(false);
    expect(fixed.settings.cards.marshal).toBe(0);
    expect(fixed.night.searched).toEqual({});
    expect(fixed.players.every((p) => p.note === '' && p.cuffsUsed === false)).toBe(true);
  });
});
