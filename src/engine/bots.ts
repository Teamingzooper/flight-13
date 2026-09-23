import { nextFloat, pick, type RngHolder } from './rng';
import { checkSeatbelt, possibleActions } from './rules';
import { activePlayers, emptySeats, getPlayer, isActive } from './state';
import type { GameState, Intent } from './types';

/** Random legal choices for one player in the current phase (simulation and dev bots). */
export function botIntents(s: GameState, playerId: string, h: RngHolder): Intent[] {
  const p = getPlayer(s, playerId);
  if (!p || !isActive(p)) return [];
  switch (s.phase.kind) {
    case 'night_move': {
      if (s.night.buckled[p.id]) return [];
      const seats = emptySeats(s);
      const intents: Intent[] = [{ kind: 'move', to: seats.length > 0 && nextFloat(h) < 0.4 ? pick(h, seats) : 'stay' }];
      if (p.role === 'pilot') {
        const targets = activePlayers(s).filter((t) => checkSeatbelt(s, p, t.id) === null);
        intents.push({ kind: 'seatbelt', target: targets.length > 0 && nextFloat(h) < 0.8 ? pick(h, targets).id : 'none' });
      }
      return intents;
    }
    case 'night_act': {
      if (s.night.buckled[p.id]) return [];
      const actions = possibleActions(s, p);
      return [{ kind: 'act', action: actions.length > 0 && nextFloat(h) < 0.85 ? pick(h, actions) : null }];
    }
    case 'day_discuss':
      return [{ kind: 'ready' }];
    case 'day_vote': {
      const targets = activePlayers(s).filter((t) => t.id !== p.id);
      return [{ kind: 'vote', target: targets.length > 0 && nextFloat(h) < 0.6 ? pick(h, targets).id : 'skip' }];
    }
    default:
      return [];
  }
}
