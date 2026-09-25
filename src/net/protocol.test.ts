import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../engine';
import { cleanLook, cleanName, cleanSettings, parseClientMessage } from './protocol';

describe('protocol sanitising', () => {
  it('cleans names', () => {
    expect(cleanName('  Ann   Marie  ')).toBe('Ann Marie');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName('')).toBe('Passenger');
    expect(cleanName(42)).toBe('Passenger');
  });

  it('clamps looks to the known palettes', () => {
    expect(cleanLook({ body: 2, skin: 99, hair: -1, hairColor: 1.5, top: 3, topStyle: 9 })).toEqual({
      body: 2,
      skin: 0,
      hair: 0,
      hairColor: 0,
      top: 3,
      topStyle: 0,
      bottom: 0,
    });
    // Looks saved before top styles existed keep their sleeves.
    expect(cleanLook({ body: 0, skin: 0, hair: 0, hairColor: 0, top: 5, bottom: 0 }).topStyle).toBe(1);
    expect(cleanLook({ body: 0, skin: 0, hair: 0, hairColor: 0, top: 2, bottom: 0 }).topStyle).toBe(0);
  });

  it('rebuilds valid settings and rejects junk', () => {
    const s = defaultSettings();
    expect(cleanSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(cleanSettings({ ...s, extra: 'ignored' })).toEqual(s);
    expect(cleanSettings({ ...s, destination: 'XXX' })).toBeNull();
    expect(cleanSettings({ ...s, cards: { ...s.cards, bomber: 'lots' } })).toBeNull();
    // Settings from before the Air Marshal and the Pilot rule existed still work.
    const { pilotMustFly: _rule, ...older } = s;
    const { marshal: _card, ...olderCards } = s.cards;
    expect(cleanSettings({ ...older, cards: olderCards })).toEqual({ ...s, pilotMustFly: false, cards: { ...s.cards, marshal: 0 } });
    expect(cleanSettings({ ...s, pilotMustFly: 'yes' })).toBeNull();
    // Settings from before the bot settings existed get Normal bots; junk is refused.
    const { botChatter: _chatter, botSkill: _skill, ...noBots } = s;
    expect(cleanSettings(noBots)).toEqual({ ...s, botChatter: 'normal', botSkill: 'normal' });
    expect(cleanSettings({ ...s, botChatter: 'loud' })).toBeNull();
    expect(cleanSettings({ ...s, botSkill: 'hard' })).toEqual({ ...s, botSkill: 'hard' });
  });

  it('rebuilds a custom destination and rejects a bad one', () => {
    const s = { ...defaultSettings(), destination: 'custom' as const, customDestination: { city: 'Atlantis', code: 'ATL', nights: 7, twists: ['triangle' as const] } };
    expect(cleanSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
    // The code is stored upper-case, the city trimmed, and unknown effects dropped.
    const messy = { ...s, customDestination: { city: '  Atlantis ', code: 'atl', nights: 7, twists: ['triangle', 'storm'] } };
    expect(cleanSettings(messy)).toEqual(s);
    expect(cleanSettings({ ...s, customDestination: null })).toBeNull();
    expect(cleanSettings({ ...s, customDestination: { ...s.customDestination, code: 'AT1' } })).toBeNull();
    expect(cleanSettings({ ...s, customDestination: { ...s.customDestination, nights: 40 } })).toBeNull();
    expect(cleanSettings({ ...s, customDestination: { ...s.customDestination, city: '' } })).toBeNull();
    // A saved custom destination rides along while a real one is picked; junk there is just dropped.
    expect(cleanSettings({ ...s, destination: 'HNL' })).toEqual({ ...s, destination: 'HNL' });
    expect(cleanSettings({ ...s, destination: 'HNL', customDestination: 'junk' })).toEqual({ ...s, destination: 'HNL', customDestination: null });
  });

  it('parses client messages defensively', () => {
    expect(parseClientMessage({ t: 'join', v: 1, token: 'abcdefgh12', name: ' Ann ', look: {}, tower: 'yes' })).toEqual({
      t: 'join',
      v: 1,
      token: 'abcdefgh12',
      name: 'Ann',
      look: { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, topStyle: 0, bottom: 0 },
      face: '',
      tower: false,
    });
    expect(parseClientMessage({ t: 'join', v: 1, token: 'short' })).toBeNull();
    expect(parseClientMessage({ t: 'intent', seq: 3, intent: { kind: 'ready' } })).toEqual({ t: 'intent', seq: 3, intent: { kind: 'ready' } });
    expect(parseClientMessage({ t: 'intent', seq: 'x', intent: {} })).toBeNull();
    expect(parseClientMessage({ t: 'pa', on: true })).toEqual({ t: 'pa', on: true });
    expect(parseClientMessage({ t: 'pa', on: 'yes' })).toBeNull();
    expect(parseClientMessage('hello')).toBeNull();
    expect(parseClientMessage({ t: 'nope' })).toBeNull();
  });
});
