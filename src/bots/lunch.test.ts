import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type GameState } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { know } from './knowledge';
import { believe } from './mind';
import { personality } from './personality';
import { newMemory, wants, type TalkContext } from './talk';

const seq = (seed: number) => {
  let s = seed * 48271 + 11;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

/** London (lunch on day 2): the Bomber in row 4 drugs the pasta; a loyal Stewardess serves it. */
function lunch(): GameState {
  const s = makeGame([
    { id: 'bea', role: 'bomber', seat: '4C' },
    { id: 'max', role: 'mastermind', seat: '8A' },
    { id: 'sue', role: 'stewardess_loyal', seat: 'Aisle 6' },
    { id: 'ivy', role: 'investigator', seat: '4D' },
    { id: 'p1', role: 'passenger', seat: '1A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
    { id: 'p7', role: 'passenger', seat: '7B' },
  ]);
  advanceTo(s, 'day_discuss', 2);
  // (The cart hands dishes out at random: these are the ones the test needs.)
  for (const id of Object.keys(s.meal!.orders)) s.meal!.orders[id] = 'chicken';
  for (const id of ['ivy', 'p3', 'p1']) s.meal!.orders[id] = 'pasta';
  applyIntent(s, 'bea', { kind: 'tamper', dish: 'pasta' }, 0);
  return s;
}

function context(s: GameState, id: string): TalkContext {
  const view = viewFor(s, id, 0);
  const k = know(view);
  return {
    view,
    k,
    b: believe(k, [], new Map(), 'normal', () => 0.5),
    fresh: [],
    memory: newMemory(),
    chatter: 'normal',
    skill: 'normal',
    now: 30_000,
    phaseStart: 0,
    me: personality(k.me.id),
    rng: seq(3),
    name: (x) => x,
  };
}

describe('bots at lunch', () => {
  it('remember being drugged, and what the trays showed', () => {
    const s = lunch();
    advanceTo(s, 'day_vote', 2);
    expect(know(viewFor(s, 'sue', 0)).trays).toEqual({ day: 2, dish: 'pasta', row: 4 });
    advanceTo(s, 'night_move', 3);
    expect(know(viewFor(s, 'ivy', 0)).drugged).toEqual({ night: 3, dish: 'pasta' });
    expect(know(viewFor(s, 'p1', 0)).drugged).toBeNull();
    // (The Bomber's own note says what it did, not that it was drugged.)
    expect(know(viewFor(s, 'bea', 0)).drugged).toBeNull();
  });

  it('say so the next morning, and the Stewardess suspects whoever sat in that row', () => {
    const s = lunch();
    advanceTo(s, 'day_discuss', 3);
    const ivy = wants(context(s, 'ivy'));
    expect(ivy.find((w) => w.kind === 'lunch_drugged')?.fill).toEqual({ dish: 'pasta', seat: '4D' });
    const sue = context(s, 'sue');
    expect(wants(sue).find((w) => w.kind === 'lunch_trays')?.fill).toEqual({ dish: 'pasta', row: '4' });
    // Row 4 at lunch: the Bomber and the Investigator.
    const top = [...sue.b.suspicion].sort((a, z) => z[1] - a[1]).slice(0, 2).map(([id]) => id).sort();
    expect(top).toEqual(['bea', 'ivy']);
    expect(sue.b.why.get('bea')).toEqual({ kind: 'lunch', dish: 'pasta', row: 4 });
  });
});
