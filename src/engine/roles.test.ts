import { describe, expect, it } from 'vitest';
import { emptyCards, presetCards, teamOf, validateCards } from './roles';
import { defaultSettings, phaseDurationMs, validateSettings } from './settings';

describe('roles', () => {
  it('every preset from 4 to 16 players is valid', () => {
    for (let n = 4; n <= 16; n++) expect(validateCards(presetCards(n), n, 0.5)).toBeNull();
  });

  it('requires someone with a bomb', () => {
    expect(validateCards({ ...emptyCards(), pilot: 1 }, 6, 0.5)).toMatch(/Bomber/);
  });

  it('rejects more special cards than players', () => {
    expect(validateCards({ ...emptyCards(), bomber: 1, pilot: 3, nurse: 2 }, 5, 0)).toMatch(/Too many special/);
  });

  it('saboteurs must start as a minority, counting stewardesses that could turn rogue', () => {
    expect(validateCards({ ...emptyCards(), bomber: 2, stewardess: 1 }, 6, 0.5)).toMatch(/minority/);
    expect(validateCards({ ...emptyCards(), bomber: 2, stewardess: 1 }, 6, 0)).toBeNull();
  });

  it('the Mastermind is a saboteur', () => {
    expect(teamOf('mastermind')).toBe('saboteurs');
    expect(teamOf('stewardess_rogue')).toBe('saboteurs');
  });
});

describe('settings', () => {
  it('defaults are valid', () => {
    expect(validateSettings(defaultSettings())).toBeNull();
  });

  it('rejects out-of-range passenger counts', () => {
    expect(validateSettings({ ...defaultSettings(), maxPassengers: 3 })).toBe('The airliner takes 4 to 16 passengers.');
    expect(validateSettings({ ...defaultSettings(), maxPassengers: 17 })).toBe('The airliner takes 4 to 16 passengers.');
    // Each plane has its own range.
    expect(validateSettings({ ...defaultSettings(), plane: 'jet', maxPassengers: 7 })).toBe('The private jet takes 4 to 6 passengers.');
    expect(validateSettings({ ...defaultSettings(), plane: 'jet', maxPassengers: 6 })).toBeNull();
    expect(validateSettings({ ...defaultSettings(), plane: 'jumbo', maxPassengers: 24 })).toBeNull();
    expect(validateSettings({ ...defaultSettings(), plane: 'jumbo', maxPassengers: 9 })).toBe('The jumbo takes 10 to 24 passengers.');
    expect(validateSettings({ ...defaultSettings(), plane: 'glider' as never })).toBe('Unknown plane.');
  });

  it('the red-eye to Tokyo shortens discussion', () => {
    expect(phaseDurationMs(defaultSettings(), 'day_discuss')).toBe(90_000);
    expect(phaseDurationMs({ ...defaultSettings(), destination: 'HND' }, 'day_discuss')).toBe(54_000);
    expect(phaseDurationMs({ ...defaultSettings(), timers: 'quick' }, 'night_act')).toBe(30_000);
    expect(phaseDurationMs(defaultSettings(), 'takeoff')).toBe(12_000);
  });
});
