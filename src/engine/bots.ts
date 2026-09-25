import { ITEM_ORDER, MAX_PACKED, possibleItemUses } from './items';
import { inReach, lunchOpen, tamperReach } from './meal';
import { isPilot, isSaboteur } from './roles';
import { nextFloat, pick, type RngHolder } from './rng';
import { checkCourse, checkSeatbelt, checkWashroom, flightDeckError, possibleActions, possibleMoves } from './rules';
import { activePlayers, getPlayer, isActive, isGuest } from './state';
import type { GameState, Intent, ItemId, PlayerState } from './types';

/** Use an item now and then (always legal: computed from the current state). */
function maybeUse(s: GameState, p: PlayerState, h: RngHolder, item: ItemId, chance: number): Intent[] {
  const uses = possibleItemUses(s, p).filter((u) => u.item === item);
  if (uses.length === 0 || nextFloat(h) >= chance) return [];
  return [{ kind: 'use', ...pick(h, uses) }];
}

/** A bot Pilot's lights-out calls: the seatbelt sign, often the jump seat, now and then rough air, and a course change near the end. */
function pilotCalls(s: GameState, p: PlayerState, h: RngHolder): Intent[] {
  if (flightDeckError(s, p) !== null) return [];
  const intents: Intent[] = [];
  const targets = activePlayers(s).filter((t) => checkSeatbelt(s, p, t.id) === null);
  intents.push({ kind: 'seatbelt', target: targets.length > 0 && nextFloat(h) < 0.8 ? pick(h, targets).id : 'none' });
  const guests = activePlayers(s).filter((t) => t.id !== p.id);
  if (guests.length > 0 && nextFloat(h) < 0.5) intents.push({ kind: 'jumpseat', target: pick(h, guests).id });
  if (!p.roughAirUsed && nextFloat(h) < 0.1) intents.push({ kind: 'roughair', startRow: 1 + Math.floor(nextFloat(h) * (s.cabin.rows - 2)) });
  // A loyal Pilot buys time; a rogue one lands early while his team is free.
  const change = p.role === 'pilot_rogue' ? 'shortcut' : 'hold';
  if (!p.courseUsed && s.phase.night === s.nights - 1 && checkCourse(s, p, change) === null && nextFloat(h) < 0.5) intents.push({ kind: 'course', change });
  return [...intents, ...maybeUse(s, p, h, 'mirror', 0.3)];
}

/**
 * Lunch: now and then (a saboteur, while the team has not yet) drug the dish it was not handed, around the row where
 * that puts the most of the other side to sleep.
 */
function lunch(s: GameState, p: PlayerState, h: RngHolder): Intent[] {
  if (!lunchOpen(s)) return [];
  const m = s.meal!;
  const intents: Intent[] = [];
  const reach = tamperReach(p);
  if (reach === null || m.tamper || nextFloat(h) >= 0.5) return intents;
  const dish = m.orders[p.id] === 'chicken' ? 'pasta' : 'chicken';
  const rows = reach === 'any' ? Array.from({ length: s.cabin.rows }, (_, i) => i + 1) : [reach];
  // Where it would put the most of the other side to sleep, and the fewest of its own team (by the orders so far).
  let best: { row: number; hits: number } | null = null;
  for (const row of rows) {
    const eaters = activePlayers(s).filter((o) => o.id !== p.id && m.orders[o.id] === dish && inReach(s, { by: p.id, row }, o));
    const hits = eaters.reduce((n, o) => n + (isSaboteur(o.role) ? -1 : 1), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { row, hits };
  }
  if (!best) return intents;
  return [...intents, { kind: 'tamper', dish, ...(reach === 'any' ? { row: best.row } : {}) }];
}

/** Random legal choices for one player in the current phase (simulation and dev bots). */
export function botIntents(s: GameState, playerId: string, h: RngHolder): Intent[] {
  const p = getPlayer(s, playerId);
  if (!p || !isActive(p)) return [];
  switch (s.phase.kind) {
    case 'packing': {
      if (s.packed[p.id]) return [];
      const count = Math.floor(nextFloat(h) * (MAX_PACKED + 1));
      return [{ kind: 'pack', items: Array.from({ length: count }, () => pick(h, ITEM_ORDER)), ready: true }];
    }
    case 'night_move': {
      // Drugged at lunch: fast asleep all night.
      if (s.night.drowsy[p.id]) return [];
      if (isPilot(p.role)) return pilotCalls(s, p, h);
      const intents: Intent[] = s.night.buckled[p.id] ? maybeUse(s, p, h, 'extender', 0.9) : [];
      if (s.night.buckled[p.id] && intents.length === 0) return [];
      const seats = possibleMoves(s, p);
      // A poisoned bot heads for the washroom if it can; now and then one goes anyway.
      const washroom = checkWashroom(s, p) === null && nextFloat(h) < (p.poisonedNight !== null ? 0.9 : 0.08);
      intents.push({ kind: 'move', to: washroom ? 'washroom' : seats.length > 0 && nextFloat(h) < 0.4 ? pick(h, seats) : 'stay' });
      return [...intents, ...maybeUse(s, p, h, 'mirror', 0.3)];
    }
    case 'night_act': {
      if (s.night.drowsy[p.id]) return [];
      if (isGuest(s, p.id)) {
        // Up in the jump seat: now and then a saboteur knocks the Pilot out; a Nurse treats him if he is poisoned.
        const actions = possibleActions(s, p);
        const knock = actions.find((a) => a.kind === 'knockout');
        const treat = actions.find((a) => a.kind === 'treat');
        const pilot = activePlayers(s).find((o) => isPilot(o.role));
        const action = knock && nextFloat(h) < 0.3 ? knock : treat && pilot && pilot.poisonedNight !== null ? treat : null;
        return [{ kind: 'act', action }];
      }
      const intents: Intent[] = s.night.buckled[p.id] ? maybeUse(s, p, h, 'extender', 0.9) : [];
      if (s.night.buckled[p.id] && intents.length === 0) return [];
      intents.push(
        ...maybeUse(s, p, h, 'defuser', 1),
        ...maybeUse(s, p, h, 'flashlight', 0.4),
        ...maybeUse(s, p, h, 'pills', 0.25),
        ...maybeUse(s, p, h, 'mirror', 0.2),
      );
      const actions = possibleActions(s, p);
      intents.push({ kind: 'act', action: actions.length > 0 && nextFloat(h) < 0.85 ? pick(h, actions) : null });
      return intents;
    }
    case 'day_discuss':
      return [...lunch(s, p, h), { kind: 'ready' }];
    case 'day_vote': {
      const targets = activePlayers(s).filter((t) => t.id !== p.id);
      return [...maybeUse(s, p, h, 'ffcard', 0.3), { kind: 'vote', target: targets.length > 0 && nextFloat(h) < 0.6 ? pick(h, targets).id : 'skip' }];
    }
    default:
      return [];
  }
}
