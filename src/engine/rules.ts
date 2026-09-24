import { CUFF_RADIUS, cartCell, distance, distanceToAny, isSeatInCabin, lavatoryCells } from './grid';
import { canCuff, canPlantBombs, isStewardess } from './roles';
import { activePlayers, cellOf, getPlayer, isActive, occupantOf } from './state';
import type { GameState, NightAction, PlayerState, SeatId } from './types';

export function checkMove(s: GameState, p: PlayerState, to: SeatId | 'stay'): string | null {
  if (to === 'stay') return null;
  if (typeof to !== 'string' || !isSeatInCabin(to, s.cabin.rows)) return 'That seat does not exist.';
  if (p.seat === to) return 'You are already sitting there.';
  if (occupantOf(s, to)) return 'That seat is taken.';
  return null;
}

export function checkSeatbelt(s: GameState, pilot: PlayerState, target: string): string | null {
  if (target === 'none') return null;
  const t = getPlayer(s, target);
  if (!t || !isActive(t)) return 'Pick someone who is still in play.';
  if (t.id === pilot.id) return 'You cannot buckle yourself in.';
  if (pilot.lastSeatbeltTarget === t.id) return 'You buckled them in last night. Pick someone else.';
  return null;
}

function nextToCart(s: GameState, p: PlayerState): boolean {
  return distance(cellOf(p), cartCell(s.cabin.cartRow)) <= 1;
}

function nextToLavatory(s: GameState, p: PlayerState): boolean {
  return distanceToAny(cellOf(p), lavatoryCells(s.cabin.rows)) <= 1;
}

export function checkAction(s: GameState, p: PlayerState, action: NightAction): string | null {
  switch (action?.kind) {
    case 'treat': {
      if (p.role !== 'nurse') return 'Only the Nurse can treat people.';
      const t = getPlayer(s, action.target);
      if (!t || !isActive(t)) return 'Pick someone who is still in play.';
      if (t.id === p.id) return p.selfTreatUsed ? 'You already treated yourself once.' : null;
      if (distance(cellOf(p), cellOf(t)) > 1) return `${t.name} is too far away. Sit next to them first.`;
      return null;
    }
    case 'sweep':
      return p.role === 'investigator' ? null : 'Only the Investigator can sweep for bombs.';
    case 'inspect': {
      if (p.role !== 'investigator') return 'Only the Investigator can inspect.';
      if (action.what === 'cart') {
        if (s.cabin.cartDestroyed) return 'The drink cart is gone.';
        if (!nextToCart(s, p)) return 'You must be sitting next to the drink cart.';
        return null;
      }
      if (action.what === 'lavatory') {
        if (s.cabin.lavatoryDestroyed) return 'The lavatory is destroyed.';
        if (!nextToLavatory(s, p)) return 'You must be sitting next to the lavatory.';
        return null;
      }
      return 'Inspect the cart or the lavatory.';
    }
    case 'serve': {
      if (!isStewardess(p.role)) return 'Only the Stewardess serves drinks.';
      const t = getPlayer(s, action.target);
      if (!t || !isActive(t)) return 'Pick someone who is still in play.';
      if (t.id === p.id) return 'You cannot serve yourself.';
      return null;
    }
    case 'plant': {
      if (!canPlantBombs(p.role)) return 'You have no bomb.';
      if (p.bombUsed) return 'You already used your bomb.';
      if (action.fuse !== 1 && action.fuse !== 2) return 'The fuse must be 1 or 2 nights.';
      if (action.where === 'cart') {
        if (s.cabin.cartDestroyed) return 'The drink cart is gone.';
        if (!nextToCart(s, p)) return 'You must be in an aisle seat next to the drink cart.';
        return null;
      }
      if (action.where === 'lavatory') {
        if (s.cabin.lavatoryDestroyed) return 'The lavatory is destroyed.';
        if (!nextToLavatory(s, p)) return 'You must be in a seat next to the lavatory.';
        return null;
      }
      return action.where === 'seat' ? null : 'Unknown place to plant a bomb.';
    }
    case 'search':
      return p.seat ? null : 'You have no seat to look under.';
    case 'cuff': {
      if (!canCuff(p.role)) return 'Only the Air Marshal carries handcuffs.';
      if (p.cuffsUsed) return 'You already used your handcuffs.';
      const t = getPlayer(s, action.target);
      if (!t || !isActive(t)) return 'Pick someone who is still in play.';
      if (t.id === p.id) return 'You cannot handcuff yourself.';
      if (distance(cellOf(p), cellOf(t)) > CUFF_RADIUS) return `${t.name} is too far away. Get within ${CUFF_RADIUS} seats first.`;
      return null;
    }
    default:
      return 'Unknown action.';
  }
}

/** Every legal action for a player right now (bots and the TV UI use this). */
export function possibleActions(s: GameState, p: PlayerState): NightAction[] {
  const candidates: NightAction[] = [];
  const everyone = activePlayers(s);
  switch (p.role) {
    case 'nurse':
      for (const t of everyone) candidates.push({ kind: 'treat', target: t.id });
      break;
    case 'investigator':
      candidates.push({ kind: 'sweep' }, { kind: 'inspect', what: 'cart' }, { kind: 'inspect', what: 'lavatory' });
      break;
    case 'stewardess_loyal':
    case 'stewardess_rogue':
      for (const t of everyone) candidates.push({ kind: 'serve', target: t.id });
      break;
    case 'bomber':
    case 'mastermind':
      for (const where of ['seat', 'cart', 'lavatory'] as const) {
        for (const fuse of [1, 2] as const) candidates.push({ kind: 'plant', where, fuse });
      }
      break;
    case 'marshal':
      for (const t of everyone) candidates.push({ kind: 'cuff', target: t.id });
      break;
    default:
      break;
  }
  // Anyone can look under their own seat instead.
  candidates.push({ kind: 'search' });
  return candidates.filter((a) => checkAction(s, p, a) === null);
}
