import { describe, expect, it } from 'vitest';
import { botIntents } from './bots';
import { applyIntent } from './engine';
import { mealDay } from './meal';
import { advanceTo, endPhase, logTexts, makeGame, player } from './testkit';
import type { Dish, GameState, Intent } from './types';
import { viewFor } from './view';

const order = (s: GameState, id: string, dish: Dish) => applyIntent(s, id, { kind: 'order', dish }, 0);
const tamper = (s: GameState, id: string, dish: Dish | null, row?: number) => applyIntent(s, id, { kind: 'tamper', dish, ...(row ? { row } : {}) }, 0);

/**
 * London: five nights, so lunch comes on day 2. The Bomber sits in row 4 (reaching rows 3-5), the Mastermind at the
 * back, a loyal Stewardess works the aisle and the Pilot flies.
 */
function flight(opts: { stewardess?: 'stewardess_loyal' | 'stewardess_rogue'; mealService?: boolean } = {}): GameState {
  return makeGame(
    [
      { id: 'bomb', role: 'bomber', seat: '4C' },
      { id: 'mind', role: 'mastermind', seat: '8A' },
      { id: 'stew', role: opts.stewardess ?? 'stewardess_loyal', seat: 'Aisle 6' },
      { id: 'pilot', role: 'pilot', seat: 'Cockpit' },
      { id: 'three', role: 'passenger', seat: '3A' },
      { id: 'four', role: 'passenger', seat: '4D' },
      { id: 'five', role: 'passenger', seat: '5F' },
      { id: 'seven', role: 'passenger', seat: '7B' },
      { id: 'nurse', role: 'nurse', seat: '4A' },
    ],
    { settings: { mealService: opts.mealService ?? true } },
  );
}

describe('lunch', () => {
  it('comes halfway through the flight', () => {
    expect([2, 3, 4, 5, 8, 10].map(mealDay)).toEqual([1, 1, 2, 2, 4, 5]);
    expect(flight().meal).toMatchObject({ day: 2, orders: {}, tamper: null, served: false });
    expect(flight({ mealService: false }).meal).toBeNull();
  });

  it('is served during the discussion on its day, and everyone hears the orders', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 1);
    expect(order(s, 'four', 'pasta')).toEqual({ ok: false, error: 'Lunch is not being served right now.' });
    expect(viewFor(s, 'four', 0).meal).toBeNull();
    advanceTo(s, 'day_discuss', 2);
    expect(logTexts(s, 'all')).toContain('Lunch is served: chicken or pasta? Order before the vote.');
    expect(order(s, 'four', 'pasta')).toEqual({ ok: true });
    expect(order(s, 'four', 'chicken')).toEqual({ ok: true });
    expect(order(s, 'three', 'soup' as Dish)).toEqual({ ok: false, error: 'Chicken or pasta?' });
    const seen = viewFor(s, 'seven', 0).meal!;
    expect(seen).toMatchObject({ day: 2, open: true, orders: { four: 'chicken' }, tamper: null, reach: null });
  });

  it('lets one saboteur drug one dish around their row, in secret', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 2);
    expect(tamper(s, 'four', 'pasta')).toEqual({ ok: false, error: 'Only a saboteur would drug the food.' });
    expect(viewFor(s, 'bomb', 0).meal!.reach).toBe(4);
    expect(tamper(s, 'bomb', 'pasta')).toEqual({ ok: true });
    expect(s.meal!.tamper).toEqual({ by: 'bomb', dish: 'pasta', row: 4 });
    expect(logTexts(s, 'bomb')).toContain('You slipped a sleeping draught into the pasta around row 4. Whoever eats it there will sleep through tonight.');
    // The team sees it; nobody else does.
    expect(viewFor(s, 'mind', 0).meal!.tamper).toEqual({ by: 'bomb', dish: 'pasta', row: 4 });
    expect(viewFor(s, 'four', 0).meal!.tamper).toBeNull();
    expect(tamper(s, 'mind', 'chicken')).toEqual({ ok: false, error: 'bomb already drugged the pasta.' });
    // Called off, it is anyone's again.
    expect(tamper(s, 'bomb', null)).toEqual({ ok: true });
    expect(s.meal!.tamper).toBeNull();
    expect(tamper(s, 'mind', 'chicken')).toEqual({ ok: true });
    expect(s.meal!.tamper).toEqual({ by: 'mind', dish: 'chicken', row: 8 });
  });

  it('puts whoever ate the drugged dish around that row to sleep for the next night', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 2);
    for (const [id, dish] of [
      ['three', 'pasta'],
      ['four', 'pasta'],
      ['five', 'chicken'],
      ['seven', 'pasta'],
      ['nurse', 'pasta'],
      ['bomb', 'chicken'],
      ['pilot', 'pasta'],
    ] as const) {
      expect(order(s, id, dish).ok).toBe(true);
    }
    tamper(s, 'bomb', 'pasta');
    endPhase(s);
    // Lunch is over: the stragglers got something, the trays are gone, and the loyal Stewardess noticed.
    expect(s.meal!.served).toBe(true);
    expect(Object.keys(s.meal!.orders).sort()).toEqual(['bomb', 'five', 'four', 'mind', 'nurse', 'pilot', 'seven', 'stew', 'three']);
    expect(order(s, 'five', 'pasta').ok).toBe(false);
    // Rows 3-5 only: not the pasta in row 7, not the chicken in row 5, and never the Pilot's tray (only crew carry it).
    expect([...s.meal!.drugged].sort()).toEqual(['four', 'nurse', 'three']);
    expect(logTexts(s, 'stew')).toContain('Clearing the trays, you noticed someone had been at the pasta around row 4.');
    expect(logTexts(s, 'all')).toContain('The lunch trays are cleared away.');
    expect(logTexts(s, 'end')).toContain('Day 2: bomb drugged the pasta around row 4.');

    advanceTo(s, 'night_move', 3);
    expect(Object.keys(s.night.drowsy).sort()).toEqual(['four', 'nurse', 'three']);
    const view = viewFor(s, 'nurse', 0);
    expect(view.you).toMatchObject({ asleep: true, drowsy: true });
    expect(view.options?.seats).toEqual([]);
    expect(logTexts(s, 'nurse')).toContain('You can barely keep your eyes open. Something in the pasta at lunch: you will sleep through tonight.');
    expect(applyIntent(s, 'three', { kind: 'move', to: '2A' }, 0)).toEqual({ ok: false, error: 'You are fast asleep tonight.' });
    expect(viewFor(s, 'seven', 0).you).toMatchObject({ asleep: false, drowsy: false });
    advanceTo(s, 'night_act', 3);
    expect(applyIntent(s, 'nurse', { kind: 'act', action: { kind: 'treat', target: 'four' } }, 0)).toEqual({ ok: false, error: 'You are fast asleep tonight.' });
    expect(viewFor(s, 'nurse', 0).options?.actions).toEqual([]);
    expect(logTexts(s, 'end')).toContain('Night 3: three, four, nurse slept through the night after the drugged pasta.');
    // One night only.
    advanceTo(s, 'night_move', 4);
    expect(s.night.drowsy).toEqual({});
  });

  it('does not wait for the sleepers before the night can end early', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 2);
    order(s, 'four', 'pasta');
    tamper(s, 'bomb', 'pasta');
    advanceTo(s, 'night_move', 3);
    expect(s.night.drowsy.four).toBe('bomb');
    for (const p of s.players) {
      // (Whoever the crew handed the drugged pasta sleeps too.)
      if (s.night.drowsy[p.id]) continue;
      const intent: Intent = p.role === 'pilot' ? { kind: 'seatbelt', target: 'none' } : { kind: 'move', to: 'stay' };
      expect(applyIntent(s, p.id, intent, 0).ok).toBe(true);
    }
    expect(s.phase.earlyEndAt).not.toBeNull();
  });

  it('lets the drugger eat their own dish to look innocent', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 2);
    order(s, 'bomb', 'pasta');
    tamper(s, 'bomb', 'pasta');
    endPhase(s);
    expect(s.meal!.drugged).toContain('bomb');
  });

  it('lets a rogue Stewardess drug any row, and the flight deck’s tray through row 1', () => {
    const s = flight({ stewardess: 'stewardess_rogue' });
    advanceTo(s, 'day_discuss', 2);
    expect(viewFor(s, 'stew', 0).meal!.reach).toBe('any');
    expect(tamper(s, 'stew', 'pasta')).toEqual({ ok: false, error: 'Pick a row to serve it to.' });
    expect(tamper(s, 'stew', 'pasta', 1)).toEqual({ ok: true });
    order(s, 'pilot', 'pasta');
    order(s, 'three', 'pasta');
    endPhase(s);
    expect(s.meal!.drugged).toEqual(['pilot']);
    advanceTo(s, 'night_move', 3);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'four' }, 0)).toEqual({
      ok: false,
      error: 'You nodded off at the controls after lunch. The autopilot has the plane tonight.',
    });
  });

  it('keeps the rogue Pilot away from the trays', () => {
    const s = flight();
    player(s, 'pilot').role = 'pilot_rogue';
    advanceTo(s, 'day_discuss', 2);
    expect(viewFor(s, 'pilot', 0).meal!.reach).toBeNull();
    expect(tamper(s, 'pilot', 'pasta')).toEqual({ ok: false, error: 'You cannot get at the trays from the flight deck.' });
  });

  it('has nothing to serve on flights without meal service', () => {
    const s = flight({ mealService: false });
    advanceTo(s, 'day_discuss', 2);
    expect(order(s, 'four', 'pasta')).toEqual({ ok: false, error: 'Lunch is not being served right now.' });
    expect(viewFor(s, 'four', 0).meal).toBeNull();
    expect(logTexts(s, 'all').some((t) => t.startsWith('Lunch'))).toBe(false);
  });

  it('gets bots to order legal lunches', () => {
    const s = flight();
    advanceTo(s, 'day_discuss', 2);
    const h = { rng: 7 };
    for (const p of s.players) for (const intent of botIntents(s, p.id, h)) expect(applyIntent(s, p.id, intent, 0)).toEqual({ ok: true });
    expect(Object.keys(s.meal!.orders)).toHaveLength(s.players.length);
  });
});
