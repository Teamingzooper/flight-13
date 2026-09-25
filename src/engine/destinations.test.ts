import { describe, expect, it } from 'vitest';
import { DESTINATIONS, bombsFor, destinationOf } from './destinations';
import { defaultSettings, phaseDurationMs, validateCustomDestination, validateSettings } from './settings';
import { advanceTo, logTexts, makeGame } from './testkit';
import type { CustomDestination, Settings } from './types';

const custom = (c: Partial<CustomDestination> = {}): Settings => ({
  ...defaultSettings(),
  destination: 'custom',
  customDestination: { city: 'Atlantis', code: 'ATL', nights: 4, twists: [], ...c },
});

describe('destinations', () => {
  it('gives one bomb for every three nights, from one to four', () => {
    expect([2, 3, 4, 6, 7, 9, 10].map(bombsFor)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('a host-made destination sets the city, code, nights and effects', () => {
    expect(destinationOf(defaultSettings())).toBe(DESTINATIONS.LHR);
    const d = destinationOf(custom({ nights: 8, twists: ['redeye', 'turbulence'] }));
    expect(d).toMatchObject({ id: 'custom', city: 'Atlantis', code: 'ATL', nights: 8, twists: ['turbulence', 'redeye'] });
    expect(d.blurb).toBe('Turbulence: each night one random passenger is buckled in. Red-eye: shorter days.');
    expect(destinationOf(custom()).blurb).toBe('Classic rules.');
  });

  it('red-eye shortens the days of a custom flight too', () => {
    const plain = phaseDurationMs(custom(), 'day_discuss');
    expect(phaseDurationMs(custom({ twists: ['redeye'] }), 'day_discuss')).toBe(Math.round((plain / 1000) * 0.6) * 1000);
  });

  it('refuses a bad custom destination', () => {
    expect(validateSettings(custom())).toBeNull();
    expect(validateSettings({ ...custom(), customDestination: null })).toBe('Describe your destination.');
    expect(validateCustomDestination(custom({ city: '   ' }).customDestination)).toBe('The city needs 1 to 24 characters.');
    expect(validateCustomDestination(custom({ city: 'x'.repeat(25) }).customDestination)).toBe('The city needs 1 to 24 characters.');
    for (const code of ['AT', 'ATLA', 'A1L', 'atl']) {
      expect(validateCustomDestination(custom({ code }).customDestination)).toBe('The code must be three letters.');
    }
    for (const nights of [1, 11, 4.5]) {
      expect(validateCustomDestination(custom({ nights }).customDestination)).toBe('A flight lasts 2 to 10 nights.');
    }
    const odd = custom({ twists: ['storm' as never] }).customDestination;
    expect(validateCustomDestination(odd)).toBe('Unknown effect.');
    expect(validateCustomDestination(custom({ twists: ['redeye', 'redeye'] }).customDestination)).toBe('Unknown effect.');
  });

  it('flies a custom destination: its nights, its landing, and every effect', () => {
    const s = makeGame(
      [
        { id: 'bomber', role: 'bomber', seat: '4B' },
        { id: 'a', role: 'passenger', seat: '1A' },
        { id: 'b', role: 'passenger', seat: '2A' },
        { id: 'c', role: 'passenger', seat: '3A' },
        { id: 'd', role: 'passenger', seat: '6F' },
      ],
      { settings: custom({ nights: 2, twists: ['turbulence', 'redeye', 'triangle'] }) },
    );
    expect(s.nights).toBe(2);
    advanceTo(s, 'night_move', 1);
    expect(s.night.anomaly).not.toBeNull();
    expect(Object.values(s.night.buckled)).toContain('turbulence');
    advanceTo(s, 'ended');
    expect(logTexts(s, 'all')).toContain('Flight 13 has landed in Atlantis.');
  });
});
