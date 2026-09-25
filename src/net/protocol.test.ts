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
