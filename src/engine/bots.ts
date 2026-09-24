import { ITEM_ORDER, MAX_PACKED, possibleItemUses } from './items';
import { nextFloat, pick, type RngHolder } from './rng';
import { checkSeatbelt, checkWashroom, possibleActions, possibleMoves } from './rules';
import { activePlayers, getPlayer, isActive } from './state';
import type { GameState, Intent, ItemId, PlayerState } from './types';

/** Use an item now and then (always legal: computed from the current state). */
function maybeUse(s: GameState, p: PlayerState, h: RngHolder, item: ItemId, chance: number): Intent[] {
  const uses = possibleItemUses(s, p).filter((u) => u.item === item);
  if (uses.length === 0 || nextFloat(h) >= chance) return [];
  return [{ kind: 'use', ...pick(h, uses) }];
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
      const intents: Intent[] = s.night.buckled[p.id] ? maybeUse(s, p, h, 'extender', 0.9) : [];
      if (s.night.buckled[p.id] && intents.length === 0) return [];
      const seats = possibleMoves(s, p);
      // A poisoned bot heads for the washroom if it can; now and then one goes anyway.
      const washroom = checkWashroom(s, p) === null && nextFloat(h) < (p.poisonedNight !== null ? 0.9 : 0.08);
      intents.push({ kind: 'move', to: washroom ? 'washroom' : seats.length > 0 && nextFloat(h) < 0.4 ? pick(h, seats) : 'stay' });
      if (p.role === 'pilot') {
        const targets = activePlayers(s).filter((t) => checkSeatbelt(s, p, t.id) === null);
        intents.push({ kind: 'seatbelt', target: targets.length > 0 && nextFloat(h) < 0.8 ? pick(h, targets).id : 'none' });
      }
      return [...intents, ...maybeUse(s, p, h, 'mirror', 0.3)];
    }
    case 'night_act': {
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
      return [{ kind: 'ready' }];
    case 'day_vote': {
      const targets = activePlayers(s).filter((t) => t.id !== p.id);
      return [...maybeUse(s, p, h, 'ffcard', 0.3), { kind: 'vote', target: targets.length > 0 && nextFloat(h) < 0.6 ? pick(h, targets).id : 'skip' }];
    }
    default:
      return [];
  }
}
