import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, makeGame, player } from './testkit';
import type { GameState } from './types';

const vote = (s: GameState, voter: string, target: string) => applyIntent(s, voter, { kind: 'vote', target }, 0);

function jury(): GameState {
  return makeGame([
    { id: 'b1', role: 'bomber', seat: '1A' },
    { id: 'b2', role: 'bomber', seat: '1F' },
    { id: 'p1', role: 'passenger', seat: '3A' },
    { id: 'p2', role: 'passenger', seat: '4A' },
    { id: 'p3', role: 'passenger', seat: '5A' },
    { id: 'p4', role: 'passenger', seat: '6A' },
    { id: 'p5', role: 'passenger', seat: '7A' },
  ]);
}

describe('day vote', () => {
  it('restrains the leader only when they beat Skip, and reveals their role', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3', 'p4']) expect(vote(s, v, 'b1')).toEqual({ ok: true });
    advanceTo(s, 'verdict', 1);
    const b1 = player(s, 'b1');
    expect(b1.status).toBe('restrained');
    expect(b1.seat).toBeNull();
    expect(b1.revealed).toBe(true);
    expect(s.verdict).toMatchObject({ restrained: 'b1', tally: { b1: 4, skip: 3 } });
    // Who voted for whom stays on record (votes are open by default).
    const entry = s.log.find((e) => e.tag === 'verdict')!;
    expect(entry.data).toEqual({ player: 'b1', votes: { p1: 'b1', p2: 'b1', p3: 'b1', p4: 'b1' } });
  });

  it('keeps anonymous votes off the record', () => {
    const s = jury();
    s.settings.anonymousVotes = true;
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3', 'p4']) vote(s, v, 'b1');
    advanceTo(s, 'verdict', 1);
    expect(s.log.find((e) => e.tag === 'verdict')!.data).toEqual({ player: 'b1' });
  });

  it('non-votes count as Skip', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) vote(s, v, 'b1');
    advanceTo(s, 'verdict', 1);
    expect(s.verdict?.restrained).toBeNull();
    expect(player(s, 'b1').status).toBe('alive');
  });

  it('a tie restrains no one', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) vote(s, v, 'b1');
    for (const v of ['p4', 'p5', 'b1']) vote(s, v, 'b2');
    advanceTo(s, 'verdict', 1);
    expect(s.verdict?.restrained).toBeNull();
  });

  it('you cannot vote for yourself or for someone out of play', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    expect(vote(s, 'p1', 'p1').ok).toBe(false);
    expect(vote(s, 'p1', 'nobody').ok).toBe(false);
    expect(vote(s, 'p1', 'skip')).toEqual({ ok: true });
  });
});
