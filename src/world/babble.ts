/**
 * Bot "voices": a line of chat turned into a burst of Animal Crossing-style gibberish, one blip per syllable.
 * The vowels colour each blip, a bot's pitch sets its voice, questions rise at the end and shouts are
 * louder. Pure and deterministic; `cabinAudio.babble` plays it.
 */

export interface Syllable {
  /** Seconds from the start. */
  at: number;
  dur: number;
  /** Voice pitch (Hz). */
  freq: number;
  /** The vowel's second formant (Hz): what makes an "ee" differ from an "oo". */
  formant: number;
  level: number;
}

const FORMANT: Record<string, number> = { a: 1250, e: 1900, i: 2350, o: 950, u: 750, y: 2100 };
/** Babble is quicker than reading: a long line is cut short. */
const MAX_SECONDS = 2.8;

/** A small stable hash of a word, for a bit of melody that repeats when the word does. */
function wobble(word: string): number {
  let h = 7;
  for (const c of word) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h / 997 - 0.5;
}

/** `pitch` 0..1 (a bot's personality): low to high voice. */
export function planBabble(text: string, pitch: number): Syllable[] {
  const base = 150 + Math.min(1, Math.max(0, pitch)) * 190;
  const question = /\?\s*$/.test(text);
  const shout = /!\s*$/.test(text) || (text.length > 3 && text === text.toUpperCase() && /[A-Z]/.test(text));
  const out: Syllable[] = [];
  let t = 0;
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  for (const [i, raw] of words.entries()) {
    const word = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    const groups = word.match(/[aeiouy]+/g) ?? ['e'];
    for (const group of groups.slice(0, 3)) {
      const dur = 0.065 + Math.min(3, group.length) * 0.015;
      out.push({
        at: t,
        dur,
        freq: base * (1 + 0.14 * wobble(word + group)),
        formant: FORMANT[group[0]] ?? 1500,
        level: shout ? 1.2 : 1,
      });
      t += dur + 0.025;
    }
    // A pause between words, a longer one at a comma or a full stop.
    t += /[,.;:!?]$/.test(raw) && i < words.length - 1 ? 0.18 : 0.06;
    if (t > MAX_SECONDS) break;
  }
  if (question && out.length > 0) {
    const last = out[out.length - 1];
    last.freq *= 1.28;
    last.dur += 0.05;
  }
  return out;
}

/** How long a planned babble lasts (seconds). */
export function babbleLength(syllables: Syllable[]): number {
  const last = syllables.at(-1);
  return last ? last.at + last.dur : 0;
}
