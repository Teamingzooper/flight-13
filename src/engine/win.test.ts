import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, endPhase, makeGame, player } from './testkit';
import type { DestinationId, GameState } from './types';
import { checkWin } from './win';

function flight(destination: DestinationId = 'LHR'): GameState {
  return makeGame(
    [
      { id: 'b1', role: 'bomber', seat: '1A' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '4A' },
      { id: 'p3', role: 'passenger', seat: '5A' },
    ],
    { destination },
  );
}

describe('win conditions', () => {
  it('passengers win once every saboteur is out', () => {
    const s = flight();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) applyIntent(s, v, { kind: 'vote', target: 'b1' }, 0);
    advanceTo(s, 'verdict', 1);
    expect(s.result).toMatchObject({ winner: 'passengers', reason: 'eliminated' });
    expect(endPhase(s)).toBe('ended');
  });

  it('saboteurs win at parity', () => {
    const s = flight();
    player(s, 'p1').status = 'dead';
    player(s, 'p2').status = 'dead';
    expect(checkWin(s)).toMatchObject({ winner: 'saboteurs', reason: 'parity' });
  });

  it('nobody left is a draw', () => {
    const s = flight();
    for (const p of s.players) p.status = 'dead';
    expect(checkWin(s)).toMatchObject({ winner: 'draw', reason: 'no_survivors' });
  });

  it('saboteurs still aboard at landing win', () => {
    const s = flight('LAS');
    advanceTo(s, 'verdict', 3);
    expect(endPhase(s)).toBe('ended');
    expect(s.result).toMatchObject({ winner: 'saboteurs', reason: 'landed' });
  });
});
