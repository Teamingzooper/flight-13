import { describe, expect, it } from 'vitest';
import { applyIntent, viewFor, type PlayerView } from '../engine';
import { advanceTo, makeGame } from '../engine/testkit';
import { buy, canPack, cleanBag, newBag, settleGame, settlementFor, spendUsed, type Bag } from './bag';
import { CODES, hashCode, redeem } from './codes';

/** A finished game where the passengers restrained the only saboteur on day 1. */
function finished(): { view: (id: string) => PlayerView } {
  const s = makeGame([
    { id: 'bomber', role: 'bomber', seat: '1A' },
    { id: 'nurse', role: 'nurse', seat: '5A' },
    { id: 'a', role: 'passenger', seat: '5B' },
    { id: 'b', role: 'passenger', seat: '8F' },
  ]);
  advanceTo(s, 'day_vote', 1);
  for (const id of ['nurse', 'a', 'b']) applyIntent(s, id, { kind: 'vote', target: 'bomber' }, 0);
  advanceTo(s, 'ended');
  return { view: (id) => viewFor(s, id, 0) };
}

describe('bag', () => {
  it('starts with a small kit and cleans whatever storage holds', () => {
    expect(newBag()).toMatchObject({ credits: 100, items: { antidote: 1, flashlight: 1, ffcard: 1 } });
    expect(cleanBag(null)).toEqual(newBag());
    expect(cleanBag({ credits: -5, items: { antidote: 2, bogus: 3, pills: 'x' } })).toMatchObject({ credits: 0, items: { antidote: 2 } });
  });

  it('buys at Duty Free only with enough credits', () => {
    const bag = newBag();
    const bought = buy(bag, 'flashlight')!;
    expect(bought).toMatchObject({ credits: 60, items: { flashlight: 2 } });
    expect(buy({ ...bag, credits: 10 }, 'pillow')).toBeNull();
  });

  it('only packs items it has', () => {
    const bag = newBag();
    expect(canPack(bag, ['antidote', 'flashlight'])).toBe(true);
    expect(canPack(bag, ['antidote', 'antidote'])).toBe(false);
    expect(canPack(bag, ['pillow'])).toBe(false);
  });

  it('takes used items out once, however often it is told', () => {
    let bag: Bag = { ...newBag(), items: { antidote: 2, flashlight: 1 } };
    bag = spendUsed(bag, 'g1', ['antidote']);
    bag = spendUsed(bag, 'g1', ['antidote']);
    expect(bag.items).toEqual({ antidote: 1, flashlight: 1 });
    bag = spendUsed(bag, 'g1', ['antidote', 'flashlight']);
    expect(bag.items).toEqual({ antidote: 1, flashlight: 0 });
    bag = spendUsed(bag, 'g2', ['antidote']);
    expect(bag.items.antidote).toBe(0);
  });

  it('pays a finished game once: credits, a souvenir for the win, and first achievements', () => {
    const { view } = finished();
    const first = settleGame(newBag(), view('a'), () => 0);
    const paid = settlementFor(first, view('a').gameId)!;
    expect(paid).toMatchObject({ credits: 150, souvenir: 'antidote' });
    expect(paid.achievements.sort()).toEqual(['first_flight', 'made_it', 'passenger_win']);
    expect(first.credits).toBe(250);
    // Starter antidote + souvenir antidote + Wheels down antidote; Case closed gives a defuser, Made it a mirror.
    expect(first.items).toMatchObject({ antidote: 3, defuser: 1, mirror: 1 });
    expect(first.stats).toEqual({ flights: 1, wins: 1, landed: ['LHR'] });
    expect(settleGame(first, view('a'), () => 0)).toBe(first);
  });

  it('pays losers their credits without a souvenir, and ignores spectators', () => {
    const { view } = finished();
    const bag = settleGame(newBag(), view('bomber'), () => 0);
    expect(settlementFor(bag, view('bomber').gameId)).toMatchObject({ credits: 0, souvenir: null, achievements: ['first_flight'] });
    const tower = viewFor(makeGame([{ id: 'x', role: 'passenger', seat: '1A' }, { id: 'y', role: 'bomber', seat: '2A' }, { id: 'z', role: 'passenger', seat: '3A' }, { id: 'w', role: 'passenger', seat: '4A' }]), null, 0);
    expect(settleGame(newBag(), tower, () => 0)).toEqual(newBag());
  });
});

describe('developer codes', () => {
  it('match by hash, whatever the spacing or case, and work once', async () => {
    const hash = await hashCode('  crew-7q4k ');
    expect(CODES[hash]).toBeDefined();
    const first = await redeem(newBag(), 'crew-7q4k');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.bag.items).toMatchObject({ antidote: 2, pillow: 1, bobbypin: 1 });
    expect(await redeem(first.bag, 'CREW-7Q4K')).toEqual({ ok: false, error: 'You already used that code.' });
    expect(await redeem(newBag(), 'NOT-A-CODE')).toEqual({ ok: false, error: 'That code does not work.' });
    const miles = await redeem(newBag(), 'MILES-9X2A');
    expect(miles.ok && miles.bag.credits).toBe(600);
  });
});
