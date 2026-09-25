import { isCockpit, parsePlace } from './grid';
import { isPilot, isSaboteur, isStewardess } from './roles';
import { pick } from './rng';
import { activePlayers, addLog, getPlayer, isActive } from './state';
import type { Dish, GameState, MealState, PlayerState } from './types';

/**
 * Lunch: served once, during the day's discussion halfway through the flight. Everyone orders chicken or pasta, out
 * loud. The saboteurs get one go at the food: drug one dish around a row (the row they sit in, or for a rogue
 * Stewardess, any row she serves), and whoever eats that dish there sleeps through the next night: no seat change,
 * no ability. Crew eat in the galley, out of reach, except that the flight deck's tray goes up through the
 * Stewardess at row 1. The loyal Stewardess, clearing the trays, notices which dish was touched and where.
 */

export const DISHES: readonly Dish[] = ['chicken', 'pasta'];

export function isDish(x: unknown): x is Dish {
  return x === 'chicken' || x === 'pasta';
}

/** Lunch comes halfway through the flight, on the day after this night. */
export function mealDay(nights: number): number {
  return Math.max(1, Math.floor(nights / 2));
}

export function newMeal(nights: number): MealState {
  return { day: mealDay(nights), orders: {}, tamper: null, served: false, drugged: [] };
}

/** Lunch is being served right now: orders and tampering are open. */
export function lunchOpen(s: GameState): boolean {
  const m = s.meal;
  return !!m && !m.served && s.phase.kind === 'day_discuss' && s.phase.night === m.day;
}

/** Where a tray is: the row of the seat. The flight deck counts as row 0, ahead of row 1. */
function trayRow(p: PlayerState): number | null {
  if (!p.seat) return null;
  if (isCockpit(p.seat)) return 0;
  return parsePlace(p.seat)?.row ?? null;
}

/** Does drugging a dish around `row` (by `by`) reach this player's tray? */
export function inReach(s: GameState, tamper: { by: string; row: number }, p: PlayerState): boolean {
  if (isStewardess(p.role)) return false;
  // The flight deck's tray goes up with the Stewardess, from the galley by row 1.
  if (isPilot(p.role)) return tamper.row === 1 && isStewardess(getPlayer(s, tamper.by)?.role ?? 'passenger');
  const row = trayRow(p);
  return row !== null && row >= 1 && Math.abs(row - tamper.row) <= 1;
}

/**
 * Where this player could drug the food: their own row, 'any' row for a rogue Stewardess (she serves them all), or
 * null for someone who cannot (not a saboteur, or shut away on the flight deck).
 */
export function tamperReach(p: PlayerState): number | 'any' | null {
  if (!isSaboteur(p.role) || isPilot(p.role)) return null;
  if (isStewardess(p.role)) return 'any';
  const row = trayRow(p);
  return row !== null && row >= 1 ? row : null;
}

export function checkOrder(s: GameState, dish: unknown): string | null {
  if (!lunchOpen(s)) return 'Lunch is not being served right now.';
  if (!isDish(dish)) return 'Chicken or pasta?';
  return null;
}

export function checkTamper(s: GameState, p: PlayerState, dish: unknown, row: unknown): string | null {
  if (!lunchOpen(s)) return 'Lunch is not being served right now.';
  const reach = tamperReach(p);
  if (reach === null) return isSaboteur(p.role) ? 'You cannot get at the trays from the flight deck.' : 'Only a saboteur would drug the food.';
  const done = s.meal!.tamper;
  if (done && done.by !== p.id) return `${getPlayer(s, done.by)?.name ?? 'Your team'} already drugged the ${done.dish}.`;
  if (dish === null) return null;
  if (!isDish(dish)) return 'Chicken or pasta?';
  if (reach === 'any' && (typeof row !== 'number' || !Number.isInteger(row) || row < 1 || row > s.cabin.rows)) return 'Pick a row to serve it to.';
  return null;
}

/** Order lunch (or change your mind while it is still being served). */
export function orderLunch(s: GameState, p: PlayerState, dish: Dish): void {
  s.meal!.orders[p.id] = dish;
}

/** Drug a dish (checked with `checkTamper`), or leave the food alone again (null). */
export function tamperLunch(s: GameState, p: PlayerState, dish: Dish | null, row: number | undefined, now: number): void {
  const m = s.meal!;
  if (dish === null) {
    if (m.tamper?.by === p.id) m.tamper = null;
    return;
  }
  const reach = tamperReach(p)!;
  const at = reach === 'any' ? row! : reach;
  m.tamper = { by: p.id, dish, row: at };
  addLog(s, now, [p.id], 'meal', `You slipped a sleeping draught into the ${dish} around row ${at}. Whoever eats it there will sleep through tonight.`);
}

/** Lunch opens with the day's discussion: the trays come round. */
export function serveLunch(s: GameState, now: number): void {
  const m = s.meal;
  if (!m || m.served || s.phase.night !== m.day) return;
  addLog(s, now, 'all', 'meal', 'Lunch is served: chicken or pasta? Order before the vote.');
}

/** The end of the discussion: anyone who did not choose gets what they are handed, and the trays are cleared. */
export function closeLunch(s: GameState, now: number): void {
  const m = s.meal;
  if (!m || m.served || s.phase.night !== m.day) return;
  m.served = true;
  for (const p of activePlayers(s)) m.orders[p.id] ??= pick(s, DISHES);
  const t = m.tamper;
  if (t) {
    m.drugged = activePlayers(s)
      .filter((p) => m.orders[p.id] === t.dish && inReach(s, t, p))
      .map((p) => p.id);
    addLog(s, now, 'end', 'meal', `Day ${m.day}: ${getPlayer(s, t.by)?.name ?? 'Someone'} drugged the ${t.dish} around row ${t.row}.`, { ...t });
  }
  // The loyal Stewardess, clearing the trays, notices whether anyone has been at them.
  for (const p of activePlayers(s)) {
    if (p.role !== 'stewardess_loyal') continue;
    addLog(
      s,
      now,
      [p.id],
      'meal',
      t ? `Clearing the trays, you noticed someone had been at the ${t.dish} around row ${t.row}.` : 'Clearing the trays: nobody touched the food today.',
      t ? { dish: t.dish, row: t.row } : undefined,
    );
  }
  addLog(s, now, 'all', 'meal', 'The lunch trays are cleared away.');
}

/** The night after lunch: whoever ate the drugged dish sleeps straight through it. */
export function lunchDrowsiness(s: GameState, night: number, now: number): void {
  const m = s.meal;
  if (!m?.tamper || !m.served || night !== m.day + 1) return;
  const sleepers: PlayerState[] = [];
  for (const id of m.drugged) {
    const p = getPlayer(s, id);
    if (!p || !isActive(p)) continue;
    s.night.drowsy[p.id] = m.tamper.by;
    sleepers.push(p);
    addLog(s, now, [p.id], 'meal', `You can barely keep your eyes open. Something in the ${m.orders[p.id]} at lunch: you will sleep through tonight.`, {
      dish: m.orders[p.id],
    });
  }
  if (sleepers.length > 0) {
    addLog(s, now, 'end', 'meal', `Night ${night}: ${sleepers.map((p) => p.name).join(', ')} slept through the night after the drugged ${m.tamper.dish}.`);
  }
}
