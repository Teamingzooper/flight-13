import { describe, expect, it } from 'vitest';
import { applyIntent, tick } from './engine';
import { advanceTo, endPhase, makeGame, player } from './testkit';
import type { ChatChannel, GameState, Settings } from './types';

function smallFlight(settings: Partial<Settings> = {}): GameState {
  return makeGame(
    [
      { id: 'bomber', role: 'bomber', seat: '1A' },
      { id: 'pilot', role: 'pilot', seat: '2A' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '3B' },
      { id: 'p3', role: 'passenger', seat: '7F' },
    ],
    { settings },
  );
}

const say = (s: GameState, id: string, channel: ChatChannel, text: string, t: number) =>
  applyIntent(s, id, { kind: 'chat', channel, text }, t);

describe('phase flow', () => {
  it('packing (50 s), boarding (6 s) and takeoff (12 s), then the lights go out', () => {
    const s = smallFlight();
    expect(s.phase).toMatchObject({ kind: 'packing', night: 0, endsAt: 50_000 });
    expect(tick(s, 49_999)).toBe(false);
    expect(tick(s, 50_000)).toBe(true);
    expect(s.phase).toMatchObject({ kind: 'boarding', night: 0, endsAt: 56_000 });
    expect(tick(s, 56_000)).toBe(true);
    expect(s.phase).toMatchObject({ kind: 'takeoff', night: 0, endsAt: 68_000 });
    expect(s.log.at(-1)?.tag).toBe('takeoff');
    expect(tick(s, 67_999)).toBe(false);
    expect(tick(s, 68_000)).toBe(true);
    expect(s.phase).toMatchObject({ kind: 'night_move', night: 1, startedAt: 68_000, endsAt: 88_000 });
  });

  it('a phase ends 3 seconds after everyone has submitted', () => {
    const s = smallFlight();
    advanceTo(s, 'night_move', 1);
    const t = s.phase.startedAt + 1000;
    for (const id of ['bomber', 'pilot', 'p1', 'p2', 'p3']) applyIntent(s, id, { kind: 'move', to: 'stay' }, t);
    expect(s.phase.earlyEndAt).toBeNull();
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'none' }, t);
    expect(s.phase.earlyEndAt).toBe(t + 3000);
    expect(tick(s, t + 3000)).toBe(true);
    expect(s.phase.kind).toBe('night_act');
  });

  it('every passenger must press Done at night, even without an ability', () => {
    const s = smallFlight();
    advanceTo(s, 'night_act', 1);
    for (const id of ['bomber', 'pilot', 'p1', 'p2']) applyIntent(s, id, { kind: 'act', action: null }, s.phase.startedAt);
    expect(s.phase.earlyEndAt).toBeNull();
    applyIntent(s, 'p3', { kind: 'act', action: null }, s.phase.startedAt);
    expect(s.phase.earlyEndAt).not.toBeNull();
  });

  it('"after incident" mode skips the vote after a quiet night', () => {
    const s = smallFlight({ voteMode: 'afterIncident' });
    advanceTo(s, 'day_discuss', 1);
    expect(endPhase(s)).toBe('night_move');
    expect(s.phase.night).toBe(2);
  });

  it('rejects input from players who are out or not aboard', () => {
    const s = smallFlight();
    advanceTo(s, 'night_move', 1);
    player(s, 'p3').status = 'dead';
    expect(applyIntent(s, 'p3', { kind: 'move', to: 'stay' }, 0).ok).toBe(false);
    expect(applyIntent(s, 'ghost', { kind: 'move', to: 'stay' }, 0).ok).toBe(false);
  });
});

describe('chat', () => {
  it('the cabin is silent at night; saboteurs have their own channel', () => {
    const s = smallFlight();
    advanceTo(s, 'night_move', 1);
    expect(say(s, 'p1', 'cabin', 'hello', 0).ok).toBe(false);
    expect(say(s, 'bomber', 'saboteurs', 'row 3 looks crowded', 0)).toEqual({ ok: true });
    expect(say(s, 'p1', 'saboteurs', 'let me in', 0).ok).toBe(false);
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    expect(say(s, 'p1', 'cabin', 'who moved?', t)).toEqual({ ok: true });
    expect(say(s, 'bomber', 'saboteurs', 'shh', t).ok).toBe(false);
  });

  it('rate-limits and caps message length', () => {
    const s = smallFlight();
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    expect(say(s, 'p1', 'cabin', 'one', t)).toEqual({ ok: true });
    expect(say(s, 'p1', 'cabin', 'two', t + 500).ok).toBe(false);
    expect(say(s, 'p1', 'cabin', 'x'.repeat(201), t + 2000).ok).toBe(false);
    expect(say(s, 'p1', 'cabin', '   ', t + 3000).ok).toBe(false);
  });

  it('ghosts talk among themselves', () => {
    const s = smallFlight();
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    player(s, 'p3').status = 'dead';
    expect(say(s, 'p3', 'cabin', 'boo', t).ok).toBe(false);
    expect(say(s, 'p3', 'ghosts', 'boo', t)).toEqual({ ok: true });
    expect(say(s, 'p1', 'ghosts', 'hi', t).ok).toBe(false);
  });

  it('whispers reach seats within 2 during the day', () => {
    const s = smallFlight();
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    expect(applyIntent(s, 'p1', { kind: 'whisper', to: 'p2', text: 'psst' }, t)).toEqual({ ok: true });
    expect(applyIntent(s, 'p2', { kind: 'whisper', to: 'p3', text: 'too far' }, t).ok).toBe(false);
  });
});
