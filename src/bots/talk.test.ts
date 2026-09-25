import { describe, expect, it } from 'vitest';
import { viewFor, type PlayerView } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { hear } from './hear';
import { know } from './knowledge';
import { TalkLimiter } from './limiter';
import { believe, type HeardLine } from './mind';
import { personality } from './personality';
import { choose, newMemory, record, wants, type Say, type TalkContext } from './talk';

const seq = (seed: number) => {
  let s = seed * 48271 + 11;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

// (Names that are not role words: a player called "Nurse" would read as a name, not a role.)
function cabin() {
  return makeGame([
    { id: 'bea', role: 'bomber', seat: '5C' },
    { id: 'max', role: 'mastermind', seat: '8A' },
    { id: 'ivy', role: 'investigator', seat: '4C' },
    { id: 'nia', role: 'nurse', seat: '6D' },
    { id: 'p1', role: 'passenger', seat: '1A' },
    { id: 'p2', role: 'passenger', seat: '2A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
  ]);
}

function line(view: PlayerView, from: string, text: string, t: number, id = t): HeardLine {
  const roster = view.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
  return { id, t, night: view.phase.night, from, channel: 'cabin', heard: hear(text, from, roster, 'cabin') };
}

function context(view: PlayerView, fresh: HeardLine[], over: Partial<TalkContext> = {}): TalkContext {
  const k = know(view);
  return {
    view,
    k,
    b: believe(k, fresh, new Map(), 'normal', () => 0.5),
    fresh,
    memory: newMemory(),
    chatter: 'normal',
    skill: 'normal',
    now: 10_000,
    phaseStart: 0,
    me: personality(k.me.id),
    rng: seq(7),
    name: (id) => id,
    ...over,
  };
}

describe('when bots talk', () => {
  it('an accused bot answers, a few seconds after the accusation', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'nia', 0);
    const says = wants(context(view, [line(view, 'p1', 'nia is the bomber', 9_000)]));
    const reply = says.find((x) => x.kind === 'defend_self')!;
    expect(reply).toMatchObject({ reply: true, channel: 'cabin', line: 9_000 });
    expect(reply.fill.why).toBe("I'm the Nurse");
    expect(reply.at - 9_000).toBeGreaterThanOrEqual(2_000);
    expect(reply.at - 9_000).toBeLessThanOrEqual(5_000);
  });

  it('answers a question put to it', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'nia', 0);
    const says = wants(context(view, [line(view, 'p1', 'nia, what is your role?', 9_000)]));
    expect(says.find((x) => x.reply)).toMatchObject({ kind: 'claim', fill: { role: 'Nurse' } });
  });

  it('a saboteur keeps a cover story', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const view = viewFor(s, 'bea', 0);
    const ctx = context(view, [line(view, 'p1', 'bea is sus', 9_000)]);
    const first = wants(ctx).find((x) => x.kind === 'defend_self')!.fill.why!;
    expect(first).not.toMatch(/bomber/i);
    const again = wants({ ...ctx, fresh: [line(view, 'p2', 'bea, what is your role?', 9_500, 9_500)] }).find((x) => x.reply)!;
    expect(again.kind).toBe('claim');
    // Same story both times: a Passenger who searched their own seat, or the role it claimed.
    if (again.fill.role === 'Passenger') expect(first).toMatch(/searched 5C|sitting here/);
    else expect(first).toContain(again.fill.role!);
  });

  it('says nothing in the cabin at night', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    for (const id of ['bea', 'ivy', 'p1']) expect(wants(context(viewFor(s, id, 0), []))).toEqual([]);
  });

  it('a quiet bot says one thing a day unprompted; a lively one says more than a normal one', () => {
    const count = (chatter: 'quiet' | 'normal' | 'lively') => {
      const pool: Say[] = Array.from({ length: 12 }, (_, i) => ({
        kind: 'banter',
        channel: 'cabin',
        fill: {},
        priority: i,
        key: `k${i}`,
        at: 0,
        reply: false,
      }));
      const memory = newMemory();
      const limiter = new TalkLimiter();
      let said = 0;
      for (let now = 0; now < 120_000; now += 1000) {
        const pick = choose(pool, memory, chatter, limiter, 'bot', now, 1);
        if (!pick) continue;
        record(memory, pick);
        limiter.spoke('bot', now);
        said++;
      }
      return said;
    };
    expect(count('quiet')).toBe(1);
    expect(count('normal')).toBe(4);
    expect(count('lively')).toBeGreaterThan(count('normal'));
  });

  it('spaces lines out across bots and for each bot', () => {
    const limiter = new TalkLimiter();
    expect(limiter.may('a', 0, false)).toBe(true);
    limiter.spoke('a', 0);
    expect(limiter.may('b', 2_000, false)).toBe(false);
    expect(limiter.may('b', 2_600, false)).toBe(true);
    // An answer can come sooner, but never twice from the same bot within 6 s.
    expect(limiter.may('b', 1_000, true)).toBe(true);
    expect(limiter.may('a', 5_000, true)).toBe(false);
    expect(limiter.may('a', 6_000, false)).toBe(true);
  });
});
