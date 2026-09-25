import { describe, expect, it } from 'vitest';
import { applyIntent, botIntents, emptyCards, phaseDue, tick, viewFor, type BotChatter, type BotSkill, type GameState, type Settings } from '../engine';
import { defaultSettings } from '../engine/settings';
import { createGame } from '../engine/setup';
import { TEST_LOOK } from '../engine/testkit';
import { BotBrain } from './brain';
import { TalkLimiter } from './limiter';
import { BUDGET } from './talk';

const TALK = new Set(['night_move', 'night_act', 'dawn', 'day_discuss', 'day_vote', 'verdict']);

function simulate(seed: number, players: number, botSkill: BotSkill, botChatter: BotChatter, extra: Partial<Settings> = {}) {
  const settings = { ...defaultSettings(), maxPassengers: players, botSkill, botChatter, ...extra };
  const roster = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
  const s: GameState = createGame({ settings, players: roster, seed, now: 0 });
  const brains = new Map(roster.map((p, i) => [p.id, new BotBrain(p.id, seed * 31 + i)]));
  const limiter = new TalkLimiter();
  const rng = { rng: seed * 7919 + 1 };
  const rejected: string[] = [];
  const perDay = new Map<string, number>();
  let now = 0;
  const apply = (id: string, intent: Parameters<typeof applyIntent>[2]) => {
    const r = applyIntent(s, id, intent, now);
    // Two lines within the engine's 1 s chat cooldown lose the race; anything else is a bug.
    if (!r.ok && !(intent.kind === 'chat' && r.error === 'Slow down a little.')) rejected.push(`${s.phase.kind}: ${r.error} ${JSON.stringify(intent)}`);
    if (r.ok && intent.kind === 'chat') {
      const key = `${id}:${s.phase.night}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
  };
  for (let step = 0; step < 400 && s.phase.kind !== 'ended'; step++) {
    const talking = TALK.has(s.phase.kind);
    for (const p of s.players) {
      const planned = botIntents(s, p.id, rng);
      for (const intent of talking ? brains.get(p.id)!.adjust(viewFor(s, p.id, now), planned, now) : planned) apply(p.id, intent);
    }
    if (talking) {
      for (let moment = 0; moment < 4; moment++) {
        now += 1100;
        for (const p of s.players) {
          const turn = brains.get(p.id)!.think(viewFor(s, p.id, now), now, limiter);
          for (const intent of turn.intents) apply(p.id, intent);
          for (const line of turn.chat) apply(p.id, { kind: 'chat', channel: line.channel, text: line.text });
        }
      }
    }
    now = Math.max(now, phaseDue(s));
    tick(s, now);
  }
  return { s, rejected, perDay };
}

describe('talking bots', () => {
  it('play whole flights at every skill and chattiness, legally and within their budgets', () => {
    let lines = 0;
    for (const skill of ['easy', 'normal', 'hard'] as const) {
      for (const chatter of ['quiet', 'normal', 'lively'] as const) {
        for (const [players, seed] of [
          [6, 1],
          [10, 2],
        ] as const) {
          const { s, rejected, perDay } = simulate(seed, players, skill, chatter);
          expect(rejected, `${skill}/${chatter}/${players}`).toEqual([]);
          expect(s.phase.kind).toBe('ended');
          // Proactive budget, plus answers (4), the vote, the verdict and a night plan or order reply or two.
          for (const [, n] of perDay) expect(n).toBeLessThanOrEqual(BUDGET[chatter] + 4 + 4);
          lines += [...perDay.values()].reduce((a, b) => a + b, 0);
        }
      }
    }
    expect(lines).toBeGreaterThan(50);
  }, 60_000);

  it('play the host’s own roles too: a poisoning Chef, a Bodyguard who treats, a Bouncer with cuffs', () => {
    const extra: Partial<Settings> = {
      rolesMode: 'custom',
      cards: { ...emptyCards(), bomber: 1, investigator: 1 },
      customRoles: [
        { name: 'Chef', team: 'saboteurs', ability: 'poison', uses: 'nightly', count: 1 },
        { name: 'Bodyguard', team: 'passengers', ability: 'treat', uses: 2, count: 1 },
        { name: 'Bouncer', team: 'passengers', ability: 'cuff', uses: 1, count: 1 },
      ],
    };
    for (const skill of ['easy', 'normal', 'hard'] as const) {
      for (const seed of [3, 4, 5]) {
        const { s, rejected } = simulate(seed, 8, skill, 'normal', extra);
        expect(rejected, `${skill}/${seed}`).toEqual([]);
        expect(s.phase.kind).toBe('ended');
        expect(s.players.map((p) => p.role)).toEqual(expect.arrayContaining(['custom_s1', 'custom_p2', 'custom_p3']));
      }
    }
  }, 60_000);
});
