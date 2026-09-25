import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../engine';
import { TEST_LOOK, makeGame } from '../engine/testkit';
import { newHostSnapshot } from './host';
import { flightResults, statsRole } from './results';

function landed(winner: 'passengers' | 'saboteurs' | 'draw') {
  const s = newHostSnapshot('7K2Q', 'ann-token', defaultSettings(), false);
  s.players = [
    { id: 'a', token: 'ann-token', name: 'Ann', look: TEST_LOOK, bot: false },
    { id: 'b', token: 'bob-token', name: 'Bob', look: TEST_LOOK, bot: false },
    { id: 'c', token: '', name: 'Cal (bot)', look: TEST_LOOK, bot: true },
    { id: 'd', token: '', name: 'Dot (bot)', look: TEST_LOOK, bot: true },
  ];
  s.game = makeGame([
    { id: 'a', role: 'nurse', seat: '1A' },
    { id: 'b', role: 'bomber', seat: '2A' },
    { id: 'c', role: 'passenger', seat: '3A' },
    { id: 'd', role: 'passenger', seat: '4A' },
  ]);
  s.game.phase = { ...s.game.phase, kind: 'ended' };
  s.game.result = { winner, reason: 'landed', night: 3 };
  return s;
}

describe('flight results', () => {
  it("counts each person's role and whether their team won, but not the bots", () => {
    expect(flightResults(landed('passengers'))).toEqual([
      { token: 'ann-token', role: 'nurse', won: true },
      { token: 'bob-token', role: 'bomber', won: false },
    ]);
    expect(flightResults(landed('draw'))!.every((r) => !r.won)).toBe(true);
  });

  it('has nothing to say before landing, or for the tutorial', () => {
    const flying = landed('passengers');
    flying.game!.phase.kind = 'day_vote';
    expect(flightResults(flying)).toBeNull();
    const tutorial = landed('passengers');
    tutorial.tutorial = true;
    expect(flightResults(tutorial)).toBeNull();
  });

  it('counts roles made up for a flight by their team', () => {
    expect(statsRole('custom_s1' as never)).toBe('custom-saboteurs');
    expect(statsRole('custom_p2' as never)).toBe('custom-passengers');
    expect(statsRole('pilot')).toBe('pilot');
  });
});
