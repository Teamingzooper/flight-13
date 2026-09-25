import { describe, expect, it } from 'vitest';
import { viewFor } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { skyFor } from './weather';

function flight(destination: 'LHR' | 'HNL' = 'LHR') {
  return makeGame(
    [
      { id: 'bomber', role: 'bomber', seat: '4B' },
      { id: 'a', role: 'passenger', seat: '1A' },
      { id: 'b', role: 'passenger', seat: '2A' },
      { id: 'c', role: 'passenger', seat: '3A' },
      { id: 'd', role: 'passenger', seat: '6F' },
    ],
    { destination },
  );
}

describe('the weather', () => {
  it('follows the day: the runway, then sunrise, day, sunset over the verdict, and night', () => {
    const s = flight();
    expect(skyFor(viewFor(s, 'a', 0), false)).toBe('runway');
    advanceTo(s, 'dawn', 1);
    expect(skyFor(viewFor(s, 'a', 0), false)).toBe('dawn');
    advanceTo(s, 'day_discuss', 1);
    expect(['day', 'cloudy']).toContain(skyFor(viewFor(s, 'a', 0), false));
    advanceTo(s, 'verdict', 1);
    expect(skyFor(viewFor(s, 'a', 0), false)).toBe('sunset');
    advanceTo(s, 'night_move', 2);
    expect(['night', 'storm']).toContain(skyFor(viewFor(s, 'a', 0), false));
    expect(skyFor(viewFor(s, 'a', 0), true)).toBe('aurora');
  });

  it('storms on every turbulent night, the same for everyone', () => {
    const s = flight('HNL');
    for (let night = 1; night <= 3; night++) {
      advanceTo(s, 'night_act', night);
      expect(skyFor(viewFor(s, 'a', 0), false)).toBe('storm');
      expect(skyFor(viewFor(s, 'bomber', 0), false)).toBe('storm');
    }
  });
});
