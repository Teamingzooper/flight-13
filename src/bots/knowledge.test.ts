import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type GameState, type NightAction } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { bombsAt, know } from './knowledge';

const act = (s: GameState, id: string, action: NightAction) => applyIntent(s, id, { kind: 'act', action }, 0);

function cabin() {
  return makeGame([
    { id: 'bomber', role: 'bomber', seat: '5D' },
    { id: 'master', role: 'mastermind', seat: '8A' },
    { id: 'inv', role: 'investigator', seat: '4E' },
    { id: 'nurse', role: 'nurse', seat: '6D' },
    { id: 'p1', role: 'passenger', seat: '1A' },
    { id: 'p2', role: 'passenger', seat: '2A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
  ]);
}

describe('what a bot knows', () => {
  it('its own findings, with the bomb they turned up', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'inv', { kind: 'sweep' });
    act(s, 'nurse', { kind: 'treat', target: 'nurse' });
    advanceTo(s, 'day_discuss', 1);
    const k = know(viewFor(s, 'inv', 0));
    expect(k.findings).toHaveLength(1);
    expect(k.findings[0]).toMatchObject({ night: 1, where: 'seat', bombs: [s.bombs[0].id] });
    expect(k.findings[0].seats).toContain('5D');
    expect(bombsAt(k, '5D')).toHaveLength(1);
    expect(know(viewFor(s, 'nurse', 0)).treated).toEqual([{ night: 1, target: 'nurse' }]);
    // Nobody else's results.
    expect(know(viewFor(s, 'p1', 0)).findings).toEqual([]);
  });

  it('a saboteur knows the team; a passenger does not', () => {
    const s = cabin();
    advanceTo(s, 'day_discuss', 1);
    expect(know(viewFor(s, 'bomber', 0)).team).toEqual(['master']);
    expect(know(viewFor(s, 'bomber', 0)).roleOf.get('master')).toBe('mastermind');
    expect(know(viewFor(s, 'p1', 0)).team).toEqual([]);
    expect(know(viewFor(s, 'p1', 0)).roleOf.size).toBe(0);
  });

  it('who voted for whom, and who was restrained and revealed', () => {
    const s = cabin();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['inv', 'nurse', 'p1', 'p2', 'p3']) applyIntent(s, v, { kind: 'vote', target: 'bomber' }, 0);
    applyIntent(s, 'master', { kind: 'vote', target: 'p1' }, 0);
    advanceTo(s, 'verdict', 1);
    const k = know(viewFor(s, 'p2', 0));
    expect(k.verdicts).toEqual([{ night: 1, restrained: 'bomber', votes: { inv: 'bomber', nurse: 'bomber', p1: 'bomber', p2: 'bomber', p3: 'bomber', master: 'p1' } }]);
    expect(k.roleOf.get('bomber')).toBe('bomber');
    expect(k.others.map((p) => p.id)).not.toContain('bomber');
  });

  it('deaths from blasts and poison', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    advanceTo(s, 'dawn', 2);
    const k = know(viewFor(s, 'p1', 0));
    expect(k.deaths.some((d) => d.cause === 'explosion')).toBe(true);
    expect(k.bombs.some((b) => b.exploded)).toBe(true);
  });
});
