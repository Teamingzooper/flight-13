import { describe, expect, it } from 'vitest';
import { FIXED_TIMERS } from '../engine';
import { BOARDING_SHOTS, boardingMoment } from './boarding';

describe('boarding sequence', () => {
  it('fills the boarding phase exactly, shot after shot', () => {
    expect(BOARDING_SHOTS[0].start).toBe(0);
    for (let i = 1; i < BOARDING_SHOTS.length; i++) expect(BOARDING_SHOTS[i].start).toBe(BOARDING_SHOTS[i - 1].end);
    expect(BOARDING_SHOTS.at(-1)!.end).toBe(FIXED_TIMERS.boarding);
  });

  it('plays the bag, the queue, the scanner and the aisle, black in between', () => {
    expect(boardingMoment(0)).toMatchObject({ shot: 'pack', t: 0, black: 0 });
    expect(boardingMoment(3.19).black).toBeCloseTo(1, 1);
    expect(boardingMoment(3.2)).toMatchObject({ shot: 'queue', t: 0, black: 1 });
    expect(boardingMoment(5)).toMatchObject({ shot: 'queue', black: 0 });
    expect(boardingMoment(10)).toMatchObject({ shot: 'scan', black: 0 });
    expect(boardingMoment(16).shot).toBe('aisle');
    expect(boardingMoment(22)).toMatchObject({ shot: 'aisle', black: 1 });
    // Past the end (a late tick) it holds on black in your seat.
    expect(boardingMoment(30)).toMatchObject({ shot: 'aisle', black: 1 });
  });
});
