import { describe, expect, it } from 'vitest';
import { babbleLength, planBabble } from './babble';

describe('babble', () => {
  it('makes a blip per syllable, in order, within a few seconds', () => {
    const s = planBabble('Found a bomb under 5C!', 0.5);
    expect(s.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < s.length; i++) expect(s[i].at).toBeGreaterThan(s[i - 1].at);
    expect(babbleLength(s)).toBeLessThan(3.2);
    const long = planBabble('word '.repeat(80), 0.5);
    expect(babbleLength(long)).toBeLessThan(3.2);
  });

  it('is the same every time for the same line and voice', () => {
    expect(planBabble('Voting Jo: just a feeling.', 0.3)).toEqual(planBabble('Voting Jo: just a feeling.', 0.3));
  });

  it('a higher voice is higher; a question rises at the end; a shout is louder', () => {
    const low = planBabble('hello there', 0);
    const high = planBabble('hello there', 1);
    expect(high[0].freq).toBeGreaterThan(low[0].freq);
    const flat = planBabble('who sat there', 0.5);
    const asked = planBabble('who sat there?', 0.5);
    expect(asked.at(-1)!.freq).toBeGreaterThan(flat.at(-1)!.freq);
    expect(planBabble('RUN!', 0.5)[0].level).toBeGreaterThan(planBabble('run', 0.5)[0].level);
  });

  it('colours blips by their vowels', () => {
    const [ee] = planBabble('bee', 0.5);
    const [oo] = planBabble('boo', 0.5);
    expect(ee.formant).toBeGreaterThan(oo.formant);
  });

  it('says nothing for a line with no words', () => {
    expect(planBabble('...', 0.5)).toEqual([]);
  });
});
