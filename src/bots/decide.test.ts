import { describe, expect, it } from 'vitest';
import { applyIntent, botIntents, phaseDue, tick, viewFor, type GameState, type NightAction, type PlayerView } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { createGame } from '../engine/setup';
import { defaultSettings } from '../engine/settings';
import { TEST_LOOK } from '../engine/testkit';
import { chooseNight, chooseVote, followOrder } from './decide';
import { hear } from './hear';
import { know } from './knowledge';
import { believe, type HeardLine, type SeatHistory } from './mind';

const act = (s: GameState, id: string, action: NightAction) => applyIntent(s, id, { kind: 'act', action }, 0);
const flat = () => 0.5;
const rng = (seed = 1) => {
  let s = seed * 48271 + 11;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};
const seats = (view: PlayerView): SeatHistory => {
  const map = new Map(view.players.filter((p) => p.seat).map((p) => [p.id, p.seat!]));
  return new Map([[1, map], [2, map]]);
};
const said = (view: PlayerView, lines: [string, string][]): HeardLine[] => {
  const roster = view.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
  return lines.map(([from, text], i) => ({ id: i, t: i, night: view.phase.night, from, channel: 'cabin', heard: hear(text, from, roster, 'cabin') }));
};
const mind = (view: PlayerView, lines: [string, string][] = [], skill: 'easy' | 'normal' | 'hard' = 'normal') => {
  const k = know(view);
  return { k, b: believe(k, said(view, lines), seats(view), skill, flat) };
};

function cabin() {
  return makeGame([
    { id: 'bomber', role: 'bomber', seat: '5C' },
    { id: 'master', role: 'mastermind', seat: '8A' },
    { id: 'inv', role: 'investigator', seat: '4C' },
    { id: 'nurse', role: 'nurse', seat: '6D' },
    { id: 'p1', role: 'passenger', seat: '1A' },
    { id: 'p2', role: 'passenger', seat: '2A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
  ]);
}

describe('votes', () => {
  it('a passenger bot votes for the player the evidence points at, and skips without any', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'inv', { kind: 'sweep' });
    advanceTo(s, 'day_vote', 1);
    const view = viewFor(s, 'inv', 0);
    const { k, b } = mind(view);
    expect(chooseVote(view, k, b, 'normal', rng())).toEqual({ target: 'bomber', reason: { kind: 'bomb', seat: '5C' } });
    const clueless = viewFor(s, 'p3', 0);
    const m = mind(clueless);
    expect(chooseVote(clueless, m.k, m.b, 'normal', rng()).target).toBe('skip');
  });

  it('a saboteur bot never votes for a teammate, even the one the cabin blames', () => {
    const s = cabin();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) applyIntent(s, v, { kind: 'vote', target: 'master' }, 0);
    const view = viewFor(s, 'bomber', 0);
    for (const skill of ['easy', 'normal'] as const) {
      const { k, b } = mind(view, [['p1', 'master is the bomber']], skill);
      for (let seed = 1; seed < 30; seed++) expect(chooseVote(view, k, b, skill, rng(seed)).target).not.toBe('master');
    }
  });
});

describe('night choices', () => {
  it('a Hard Investigator moves next to its top suspect', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    const view = viewFor(s, 'inv', 0);
    const { k, b } = mind(view, [['p1', 'p3 is the bomber'], ['nurse', 'p3 is sus'], ['p2', 'p3 did it']], 'hard');
    const choice = chooseNight(view, k, b, 'hard', rng());
    expect(choice.move).toBeDefined();
    expect(['2A', '2B', '3B', '4A', '4B']).toContain(choice.move);
  });

  it('only ever picks legal options, over whole flights', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const settings = { ...defaultSettings(), maxPassengers: 8 };
      const s = createGame({ settings, players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK })), seed, now: 0 });
      const h = { rng: seed };
      let now = 0;
      for (let step = 0; step < 200 && s.phase.kind !== 'ended'; step++) {
        for (const p of s.players) {
          const view = viewFor(s, p.id, now);
          if (!view.you || view.you.status !== 'alive') continue;
          const { k, b } = mind(view, [], 'hard');
          const choice = chooseNight(view, k, b, 'hard', rng(seed + step));
          if (choice.move) expect(applyIntent(s, p.id, { kind: 'move', to: choice.move }, now)).toEqual({ ok: true });
          if (choice.act) expect(applyIntent(s, p.id, { kind: 'act', action: choice.act }, now)).toEqual({ ok: true });
          for (const call of choice.calls ?? []) expect(applyIntent(s, p.id, call, now)).toEqual({ ok: true });
          for (const intent of botIntents(s, p.id, h)) {
            if (intent.kind === 'act' && choice.act) continue;
            if (intent.kind === 'move' && choice.move) continue;
            applyIntent(s, p.id, intent, now);
          }
        }
        now = phaseDue(s);
        tick(s, now);
      }
    }
  });
});

describe('orders', () => {
  it('plants when told to plant at its own seat, and says why it cannot elsewhere', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    const view = viewFor(s, 'bomber', 0);
    const k = know(view);
    const order = (text: string) => hear(text, 'master', view.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })), 'saboteurs').order!;
    expect(followOrder(view, k, order('bomber, plant 5C'))).toMatchObject({ ok: true, act: { kind: 'plant', where: 'seat' } });
    expect(followOrder(view, k, order('bomber, plant 9A'))).toEqual({ ok: false, why: "I'm not in 9A" });
    expect(followOrder(view, k, order('everyone lay low'))).toEqual({ ok: true, act: null });
  });

  it('moves in the dark to where it was told to plant', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    const view = viewFor(s, 'bomber', 0);
    const order = hear('bomber, plant 7D', 'master', view.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })), 'saboteurs').order!;
    expect(followOrder(view, know(view), order)).toEqual({ ok: true, move: '7D' });
  });
});
