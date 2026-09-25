import { describe, expect, it } from 'vitest';
import { hash01, personality, type Tone } from './personality';
import { MAX_LINE, allTemplates, say, type Fill, type LineKind } from './phrasebook';

const FULL: Fill = {
  name: 'Bartholomew',
  seat: '12F',
  seats: '11E, 11F and 12F',
  role: 'Investigator',
  target: 'Anastasia',
  why: 'a bomb turned up under 12F, right where they sat on the night it was planted',
};
const TONES: Tone[] = ['blunt', 'nervous', 'chatty', 'formal'];
const seq = (seed: number) => {
  let s = seed * 48271 + 11;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

describe('the phrasebook', () => {
  it('fills every line of every kind in every tone, within a bubble', () => {
    const kinds = [...new Set(allTemplates().map(([k]) => k))];
    for (const kind of kinds) {
      for (const tone of TONES) {
        for (let seed = 1; seed < 40; seed++) {
          const line = say(kind, FULL, tone, seq(seed))!;
          expect(line, `${kind}/${tone}`).toBeTruthy();
          expect(line).not.toMatch(/[{}]/);
          expect(line.length).toBeLessThanOrEqual(MAX_LINE);
        }
      }
    }
  });

  it('says things more than one way', () => {
    const lines = new Set(Array.from({ length: 30 }, (_, i) => say('accuse', FULL, 'blunt', seq(i + 1))));
    expect(lines.size).toBeGreaterThan(2);
  });

  it('skips wordings the fill cannot complete', () => {
    expect(say('accuse', { name: 'Jo' }, 'blunt', seq(3))).toBeNull();
    expect(say('order_ok', {}, 'blunt', seq(3))).toMatch(/^(On it|Got it|Will do)\.$/);
  });

  it('a formal bot does not say sus', () => {
    for (let seed = 1; seed < 30; seed++) expect(say('agree' as LineKind, { name: 'Jo' }, 'formal', seq(seed))).not.toMatch(/\bsus\b/);
  });

  it('gives each bot a steady personality', () => {
    expect(personality('p7')).toEqual(personality('p7'));
    const tones = new Set(Array.from({ length: 40 }, (_, i) => personality(`p${i}`).tone));
    expect(tones.size).toBe(4);
    expect(hash01('a')).toBeGreaterThanOrEqual(0);
    expect(hash01('a')).toBeLessThan(1);
  });
});
