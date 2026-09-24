import { describe, expect, it } from 'vitest';
import { endingFor } from './endings';

describe('endings', () => {
  it('picks the cutscene for how the game ended', () => {
    expect(endingFor({ winner: 'passengers', reason: 'eliminated', night: 3 })).toBe('arrest');
    expect(endingFor({ winner: 'saboteurs', reason: 'landed', night: 5 })).toBe('escape');
    expect(endingFor({ winner: 'saboteurs', reason: 'parity', night: 2 })).toBe('hijack');
    expect(endingFor({ winner: 'saboteurs', reason: 'pilot', night: 2 })).toBe('hijack');
    expect(endingFor({ winner: 'draw', reason: 'no_survivors', night: 4 })).toBe('ghost');
  });
});
