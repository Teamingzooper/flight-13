import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, cleanPrefs, personKey, personVolume } from './prefs';

describe('your settings', () => {
  it('fills in anything missing and keeps values in range', () => {
    expect(cleanPrefs(null)).toEqual(DEFAULT_PREFS);
    const odd = cleanPrefs({ sound: 3, voice: -1, fov: 99, quality: 'cinematic', textSize: 'huge', pushToTalk: 'yes', people: { 'AB12:p1': 0, 'AB12:p2': 7 } });
    expect(odd.sound).toBe(1);
    expect(odd.voice).toBe(0);
    expect(odd.fov).toBe(20);
    expect(odd.quality).toBe('high');
    expect(odd.textSize).toBe('normal');
    expect(odd.pushToTalk).toBe(false);
    expect(odd.people).toEqual({ 'AB12:p1': 0 });
  });

  it("a person is at full volume unless you turned them down, per flight", () => {
    const prefs = cleanPrefs({ people: { [personKey('AB12', 'p3')]: 0.25 } });
    expect(personVolume(prefs, 'AB12', 'p3')).toBe(0.25);
    expect(personVolume(prefs, 'CD34', 'p3')).toBe(1);
    expect(personVolume(prefs, 'AB12', 'p4')).toBe(1);
  });
});
