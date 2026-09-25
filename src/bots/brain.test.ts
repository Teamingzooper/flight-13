import { describe, expect, it } from 'vitest';
import { applyIntent, botIntents, viewFor, type GameState } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { BotBrain } from './brain';
import { TalkLimiter } from './limiter';

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

const chat = (s: GameState, from: string, text: string, now: number, channel: 'cabin' | 'saboteurs' = 'cabin') =>
  expect(applyIntent(s, from, { kind: 'chat', channel, text }, now)).toEqual({ ok: true });

describe('a bot brain', () => {
  it('answers an accusation after a few seconds of typing, and only once', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    const brain = new BotBrain('nia', 5);
    const limiter = new TalkLimiter();
    brain.think(viewFor(s, 'nia', 100_000), 100_000, limiter);
    chat(s, 'p1', 'Nia is the bomber', 101_000);
    const heard: { at: number; text: string }[] = [];
    for (let t = 101_000; t <= 110_000; t += 250) {
      for (const line of brain.think(viewFor(s, 'nia', t), t, limiter).chat) heard.push({ at: t, text: line.text });
    }
    const answer = heard.find((h) => /nurse|not me|why me|wrong person/i.test(h.text))!;
    expect(answer).toBeDefined();
    expect(answer.at - 101_000).toBeGreaterThanOrEqual(2_000);
    expect(answer.at - 101_000).toBeLessThanOrEqual(6_000);
    expect(heard.filter((h) => h === answer)).toHaveLength(1);
  });

  it('a saboteur bot follows a teammate’s order to plant, and says so in the team channel', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    const brain = new BotBrain('bea', 9);
    const limiter = new TalkLimiter();
    brain.think(viewFor(s, 'bea', 200_000), 200_000, limiter);
    chat(s, 'max', 'Bea, plant 5C', 201_000, 'saboteurs');
    const turns = [];
    for (let t = 201_000; t <= 208_000; t += 500) turns.push(brain.think(viewFor(s, 'bea', t), t, limiter));
    const intents = turns.flatMap((x) => x.intents);
    expect(intents).toContainEqual({ kind: 'act', action: expect.objectContaining({ kind: 'plant', where: 'seat' }) });
    for (const intent of intents) expect(applyIntent(s, 'bea', intent, 208_000)).toEqual({ ok: true });
    const said = turns.flatMap((x) => x.chat);
    expect(said.some((c) => c.channel === 'saboteurs' && /on it|got it|will do/i.test(c.text))).toBe(true);
    expect(said.every((c) => c.channel === 'saboteurs')).toBe(true);
  });

  it('votes once, with a reason, and announces it once', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'bea', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 2 } }, 0);
    applyIntent(s, 'ivy', { kind: 'act', action: { kind: 'sweep' } }, 0);
    advanceTo(s, 'day_discuss', 1);
    const brain = new BotBrain('ivy', 3);
    const limiter = new TalkLimiter();
    for (let t = 300_000; t < 330_000; t += 1000) brain.think(viewFor(s, 'ivy', t), t, limiter);
    advanceTo(s, 'day_vote', 1);
    const planned = brain.adjust(viewFor(s, 'ivy', 331_000), botIntents(s, 'ivy', { rng: 4 }), 331_000);
    expect(planned.filter((i) => i.kind === 'vote')).toEqual([{ kind: 'vote', target: 'bea' }]);
    const said: string[] = [];
    for (let t = 331_000; t < 345_000; t += 500) said.push(...brain.think(viewFor(s, 'ivy', t), t, limiter).chat.map((c) => c.text));
    expect(said.filter((text) => /bea/i.test(text) && /vot|bea\./i.test(text))).toHaveLength(1);
  });
});
