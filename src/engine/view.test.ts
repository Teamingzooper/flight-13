import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, makeGame } from './testkit';
import type { GameState } from './types';
import { viewFor, type PlayerView } from './view';

function secrets(): GameState {
  return makeGame([
    { id: 'b1', role: 'bomber', seat: '2B' },
    { id: 'rogue', role: 'stewardess_rogue', seat: 'Aisle 5' },
    { id: 'inv', role: 'investigator', seat: '3B' },
    { id: 'pilot', role: 'pilot', seat: '2A' },
    { id: 'p2', role: 'passenger', seat: '7A' },
    { id: 'p3', role: 'passenger', seat: '8C' },
    { id: 'p4', role: 'passenger', seat: '5E' },
  ]);
}

const roleOf = (v: PlayerView, id: string) => v.players.find((p) => p.id === id)!.role;

describe('viewFor redaction', () => {
  it('passengers only know their own role', () => {
    const v = viewFor(secrets(), 'p2', 0);
    expect(v.you?.role).toBe('passenger');
    expect(roleOf(v, 'b1')).toBeNull();
    expect(roleOf(v, 'rogue')).toBeNull();
    expect(v.players.filter((p) => p.team !== null).map((p) => p.id)).toEqual(['p2']);
  });

  it('saboteurs see each other and every bomb', () => {
    const s = secrets();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'b1', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 2 } }, 0);
    advanceTo(s, 'dawn', 1);
    const v = viewFor(s, 'rogue', 0);
    expect(roleOf(v, 'b1')).toBe('bomber');
    expect(v.bombs).toHaveLength(1);
    expect(v.bombs[0].planterId).toBe('b1');
    expect(viewFor(s, 'p2', 0).bombs).toHaveLength(0);
  });

  it('the Investigator sees only the bombs they found, without the planter', () => {
    const s = secrets();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'b1', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 2 } }, 0);
    applyIntent(s, 'inv', { kind: 'act', action: { kind: 'sweep' } }, 0);
    advanceTo(s, 'dawn', 1);
    const v = viewFor(s, 'inv', 0);
    expect(v.bombs).toHaveLength(1);
    expect(v.bombs[0].planterId).toBeNull();
    expect(v.bombs[0].plantedNight).toBeNull();
  });

  it('keeps whispers, the saboteur channel and the black box private', () => {
    const s = secrets();
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'b1', { kind: 'chat', channel: 'saboteurs', text: 'plant near 3B' }, 0);
    applyIntent(s, 'p3', { kind: 'move', to: '8D' }, 0);
    advanceTo(s, 'day_discuss', 1);
    applyIntent(s, 'pilot', { kind: 'whisper', to: 'b1', text: 'I trust you' }, s.phase.startedAt);
    const outsider = viewFor(s, 'p2', 0);
    expect(outsider.chat.some((m) => m.channel === 'saboteurs')).toBe(false);
    expect(outsider.chat.find((m) => m.channel === 'whisper')!.text).toBe('');
    expect(viewFor(s, 'b1', 0).chat.find((m) => m.channel === 'whisper')!.text).toBe('I trust you');
    expect(s.log.some((e) => e.to === 'end')).toBe(true);
    expect(outsider.log.some((e) => e.to === 'end')).toBe(false);
  });

  it('only the poisoned passenger knows about the poison', () => {
    const s = secrets();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'rogue', { kind: 'act', action: { kind: 'serve', target: 'p4' } }, 0);
    advanceTo(s, 'dawn', 1);
    expect(viewFor(s, 'p4', 0).you?.poisoned).toBe(true);
    const other = viewFor(s, 'p2', 0);
    expect(other.log.some((e) => /poison/i.test(e.text))).toBe(false);
  });

  it('the control tower sees public information only, and everything once the flight is over', () => {
    const s = secrets();
    const tower = viewFor(s, null, 0);
    expect(tower.you).toBeNull();
    expect(tower.mine).toBeNull();
    expect(tower.players.every((p) => p.role === null)).toBe(true);
    s.phase.kind = 'ended';
    s.result = { winner: 'passengers', reason: 'eliminated', night: 1 };
    const after = viewFor(s, null, 0);
    expect(after.players.every((p) => p.role !== null)).toBe(true);
    expect(after.result).not.toBeNull();
  });
});

describe('viewFor options', () => {
  it('lists only legal choices for the current phase', () => {
    const s = secrets();
    advanceTo(s, 'night_move', 1);
    const pilot = viewFor(s, 'pilot', 0).options!;
    expect(pilot.seatbelt).not.toContain('pilot');
    expect(pilot.seatbelt).toHaveLength(6);
    expect(pilot.seats).not.toContain('2B');
    expect(pilot.actions).toEqual([]);
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'inv', 0).options!.actions).toContainEqual({ kind: 'sweep' });
    // Plain passengers can still look under their own seat.
    expect(viewFor(s, 'p2', 0).options!.actions).toEqual([{ kind: 'search' }]);
    advanceTo(s, 'day_vote', 1);
    const voter = viewFor(s, 'p2', 0).options!;
    expect(voter.vote).not.toContain('p2');
    expect(voter.vote).toHaveLength(6);
  });
});
