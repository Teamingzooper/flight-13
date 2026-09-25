import { CUFF_RADIUS, aisleRow, aisleSpot, cartBlocks, cartCell, distance, distanceToAny, isAisleSeat, isAisleSpot, isCockpit, isSeatInCabin, lavatoryCells, parseSeat } from './grid';
import { canCuff, canPlantBombs, isPilot, isSaboteur, isStewardess } from './roles';
import { activePlayers, bombsLeft, cellOf, emptySeats, getPlayer, inWashroom, isActive, isGuest, liveBombAt, occupantOf, onFlightDeck } from './state';
import type { GameState, MoveTarget, NightAction, PlayerState, SeatId } from './types';

/** Why the drink cart stops you walking from your row to `toRow` (crew squeeze past their own cart). */
function cartInTheWay(s: GameState, p: PlayerState, toRow: number): string | null {
  if (s.cabin.cartDestroyed || isStewardess(p.role)) return null;
  return cartBlocks(cellOf(p).row, toRow, s.cabin.cartRow) ? `The drink cart is blocking the aisle at row ${s.cabin.cartRow}.` : null;
}

/** Once per flight, spend the night locked in the lavatory. */
export function checkWashroom(s: GameState, p: PlayerState): string | null {
  if (isPilot(p.role)) return 'You cannot leave the flight deck.';
  if (p.washroomUsed) return 'You already used the washroom on this flight.';
  if (s.cabin.lavatoryDestroyed) return 'The lavatory is destroyed.';
  if (!p.seat) return 'You are out of play.';
  return cartInTheWay(s, p, s.cabin.rows + 1);
}

export function checkMove(s: GameState, p: PlayerState, to: MoveTarget): string | null {
  if (to === 'stay') return null;
  if (isPilot(p.role)) return 'The Pilot stays on the flight deck.';
  if (to === 'washroom') return checkWashroom(s, p);
  if (typeof to !== 'string') return 'That seat does not exist.';
  if (isStewardess(p.role)) {
    const row = aisleRow(to);
    if (row === null || row > s.cabin.rows) return 'Crew stay in the aisle. Pick a row to walk the cart to.';
    if (p.seat === to) return 'You are already working that row.';
    if (activePlayers(s).some((o) => o.seat === to)) return 'Another stewardess is working that row.';
    return null;
  }
  if (!isSeatInCabin(to, s.cabin.rows, s.cabin.cols)) return 'That seat does not exist.';
  if (p.seat === to) return 'You are already sitting there.';
  if (occupantOf(s, to)) return 'That seat is taken.';
  return cartInTheWay(s, p, parseSeat(to)!.row);
}

/** Every seat (or, for crew, aisle spot) a player could move to right now. */
export function possibleMoves(s: GameState, p: PlayerState): SeatId[] {
  if (isPilot(p.role)) return [];
  const places = isStewardess(p.role) ? Array.from({ length: s.cabin.rows }, (_, i) => aisleSpot(i + 1)) : emptySeats(s);
  return places.filter((to) => checkMove(s, p, to) === null);
}

/** Why the Pilot cannot make flight deck calls (or watch the cameras) right now, or null. */
export function flightDeckError(s: GameState, p: PlayerState): string | null {
  if (!isPilot(p.role)) return 'Only the Pilot flies the plane.';
  if (!isActive(p)) return 'You are out of play.';
  if (s.night.buckled[p.id]) return 'Turbulence has you fighting the controls tonight.';
  if (s.night.drowsy[p.id]) return 'You nodded off at the controls after lunch. The autopilot has the plane tonight.';
  if (p.knockedOutNight === s.phase.night) return 'You are still out cold.';
  return null;
}

export function checkJumpseat(s: GameState, pilot: PlayerState, target: string): string | null {
  const error = flightDeckError(s, pilot);
  if (error || target === 'none') return error;
  const t = getPlayer(s, target);
  if (!t || !isActive(t)) return 'Pick someone who is still in play.';
  if (t.id === pilot.id) return 'You are already on the flight deck.';
  return null;
}

export function checkRoughAir(s: GameState, pilot: PlayerState, startRow: number | null): string | null {
  const error = flightDeckError(s, pilot);
  if (error || startRow === null) return error;
  if (pilot.roughAirUsed) return 'You already flew through rough air on this flight.';
  if (!Number.isInteger(startRow) || startRow < 1 || startRow > s.cabin.rows - 2) return 'Pick three rows of the cabin.';
  return null;
}

export function checkCourse(s: GameState, pilot: PlayerState, change: 'hold' | 'shortcut' | null): string | null {
  const error = flightDeckError(s, pilot);
  if (error || change === null) return error;
  if (pilot.courseUsed) return 'You already changed course on this flight.';
  if (change === 'hold') return null;
  if (change === 'shortcut') return s.nights - 1 >= s.phase.night ? null : 'Too late for a shortcut: we land after tonight.';
  return 'Hold, or take a shortcut.';
}

export function checkSeatbelt(s: GameState, pilot: PlayerState, target: string): string | null {
  const error = flightDeckError(s, pilot);
  if (error) return error;
  if (target === 'none') return null;
  const t = getPlayer(s, target);
  if (!t || !isActive(t)) return 'Pick someone who is still in play.';
  if (t.id === pilot.id) return 'You cannot buckle yourself in.';
  if (pilot.lastSeatbeltTarget === t.id) return 'You buckled them in last night. Pick someone else.';
  return null;
}

/** Beside the drink cart: a step from it, or in an aisle seat of its row or the next (the private jet's aisle is wide). */
function nextToCart(s: GameState, p: PlayerState): boolean {
  const here = cellOf(p);
  if (distance(here, cartCell(s.cabin.cartRow)) <= 1) return true;
  return !!p.seat && Math.abs(here.row - s.cabin.cartRow) <= 1 && isAisleSeat(p.seat, s.cabin.cols);
}

function nextToLavatory(s: GameState, p: PlayerState): boolean {
  return distanceToAny(cellOf(p), lavatoryCells(s.cabin.rows)) <= 1;
}

/** Someone to use an ability on: still in play and not hiding in the lavatory. */
function reachable(s: GameState, p: PlayerState, target: string): PlayerState | string {
  const t = getPlayer(s, target);
  if (!t || !isActive(t)) return 'Pick someone who is still in play.';
  if (t.id !== p.id && inWashroom(s, t.id)) return `${t.name} is locked in the lavatory tonight.`;
  if (t.id !== p.id && isGuest(s, t.id)) return `${t.name} is up on the flight deck tonight.`;
  return t;
}

/** The row the Stewardess is working, or null for anyone else. */
function crewRow(p: PlayerState): number | null {
  return isStewardess(p.role) ? aisleRow(p.seat) : null;
}

export function checkAction(s: GameState, p: PlayerState, action: NightAction): string | null {
  if (inWashroom(s, p.id)) {
    // Locked in the lavatory: search it, or (with a bomb) leave one behind.
    if (action?.kind === 'search') return null;
    if (action?.kind === 'plant' && action.where === 'lavatory' && bombsLeft(s, p) > 0) {
      if (liveBombAt(s, { kind: 'lavatory' })) return 'There is already a bomb in here.';
      return action.fuse === 1 || action.fuse === 2 ? null : 'The fuse must be 1 or 2 nights.';
    }
    return 'You are locked in the lavatory tonight. Search it, or wait for morning.';
  }
  if (isGuest(s, p.id)) {
    // Up in the jump seat: a Nurse can treat the Pilot, a saboteur can knock him out, and that is all.
    const pilot = activePlayers(s).find((o) => isPilot(o.role) && isCockpit(o.seat));
    if (action?.kind === 'treat' && p.role === 'nurse' && pilot && action.target === pilot.id) return null;
    if (action?.kind === 'knockout' && isSaboteur(p.role) && pilot) return null;
    return 'You are on the flight deck tonight.';
  }
  switch (action?.kind) {
    case 'treat': {
      if (p.role !== 'nurse') return 'Only the Nurse can treat people.';
      const t = reachable(s, p, action.target);
      if (typeof t === 'string') return t;
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
      if (p.role !== 'stewardess_rogue') return 'Only a rogue Stewardess poisons drinks.';
      const target = getPlayer(s, action.target);
      if (!target || !isActive(target)) return 'Pick someone who is still in play.';
      if (target.id === p.id) return 'You cannot serve yourself.';
      const row = crewRow(p);
      // Coffee for the flight deck: from row 1 the Pilot and his guest are in reach.
      if (onFlightDeck(s, target)) return row === 1 ? null : `${target.name} is on the flight deck. Take the coffee up from row 1.`;
      const t = reachable(s, p, action.target);
      if (typeof t === 'string') return t;
      if (row === null || isAisleSpot(t.seat) || cellOf(t).row !== row) return `${t.name} is not sitting in your row. Walk the cart to them first.`;
      return null;
    }
    case 'check': {
      if (p.role !== 'stewardess_loyal') return 'Only a loyal Stewardess checks the rows.';
      if (crewRow(p) === null) return 'Walk the cart to a row first.';
      return action.side === 'left' || action.side === 'right' ? null : 'Check the left or the right side of your row.';
    }
    case 'plant': {
      if (!canPlantBombs(p.role)) return 'You have no bomb.';
      if (bombsLeft(s, p) <= 0) return 'You have no bombs left.';
      if (action.fuse !== 1 && action.fuse !== 2) return 'The fuse must be 1 or 2 nights.';
      const taken = 'There is already a bomb there.';
      if (action.where === 'cart') {
        if (s.cabin.cartDestroyed) return 'The drink cart is gone.';
        if (!nextToCart(s, p)) return 'You must be in an aisle seat next to the drink cart.';
        return liveBombAt(s, { kind: 'cart' }) ? taken : null;
      }
      if (action.where === 'lavatory') {
        if (s.cabin.lavatoryDestroyed) return 'The lavatory is destroyed.';
        if (!nextToLavatory(s, p)) return 'You must be in a seat next to the lavatory.';
        return liveBombAt(s, { kind: 'lavatory' }) ? taken : null;
      }
      if (action.where !== 'seat') return 'Unknown place to plant a bomb.';
      return p.seat && liveBombAt(s, { kind: 'seat', seat: p.seat }) ? taken : null;
    }
    case 'search':
      return p.seat && !isAisleSpot(p.seat) && !isCockpit(p.seat) ? null : 'You have no seat to look under.';
    case 'cuff': {
      if (!canCuff(p.role)) return 'Only the Air Marshal carries handcuffs.';
      if (p.cuffsUsed) return 'You already used your handcuffs.';
      const t = reachable(s, p, action.target);
      if (typeof t === 'string') return t;
      if (t.id === p.id) return 'You cannot handcuff yourself.';
      if (distance(cellOf(p), cellOf(t)) > CUFF_RADIUS) return `${t.name} is too far away. Get within ${CUFF_RADIUS} seats first.`;
      return null;
    }
    case 'watch': {
      const error = flightDeckError(s, p);
      if (error) return error;
      return Number.isInteger(action.startRow) && action.startRow >= 1 && action.startRow <= s.cabin.rows - 2 ? null : 'Pick three rows to watch.';
    }
    case 'knockout':
      return 'Only a saboteur up in the jump seat can do that.';
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
      candidates.push({ kind: 'check', side: 'left' }, { kind: 'check', side: 'right' });
      break;
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
    case 'pilot':
    case 'pilot_rogue':
      for (let row = 1; row <= s.cabin.rows - 2; row++) candidates.push({ kind: 'watch', startRow: row });
      break;
    default:
      break;
  }
  // Up in the jump seat, a saboteur can knock the Pilot out.
  if (isSaboteur(p.role)) candidates.push({ kind: 'knockout' });
  // Anyone can look under their own seat (or search the lavatory they are in) instead.
  candidates.push({ kind: 'search' });
  return candidates.filter((a) => checkAction(s, p, a) === null);
}
