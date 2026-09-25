import { describe, expect, it } from 'vitest';
import { emptyCards, isPilot, validateCards } from './roles';
import { defaultSettings, validateSettings } from './settings';
import { dealRoles } from './setup';

describe('rogue Pilots', () => {
  it('turn rogue by the odds, but only while the saboteurs stay outnumbered', () => {
    const cards = { ...emptyCards(), bomber: 1, pilot: 1 };
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 1)).toContain('pilot_rogue');
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 0)).toContain('pilot');
    // Four passengers: a second saboteur would be half the cabin, so the Pilot stays loyal.
    expect(dealRoles({ rng: 1 }, cards, 4, 0, 1)).toContain('pilot');
    expect(isPilot('pilot_rogue')).toBe(true);
    expect(isPilot('stewardess_rogue')).toBe(false);
  });

  it('fit one to a flight deck, with odds the host can set', () => {
    expect(validateCards({ ...emptyCards(), bomber: 1, pilot: 2 }, 8, 0)).toBe('Only one Pilot fits on the flight deck.');
    expect(defaultSettings().pilotRogueChance).toBe(0.3);
    expect(validateSettings({ ...defaultSettings(), pilotRogueChance: 2 })).toBe('Pilot odds must be between 0 and 1.');
  });
});
