import { SEAT_COLS, allSeats, isCockpit, parsePlace } from './grid';
import { bombsFor, destinationOf } from './destinations';
import { hasAbility, roleInfo, usesLeft } from './custom';
import { normalizeSettings, phaseDurationMs } from './settings';
import type { Bomb, BombLocation, Cell, DeathCause, GameState, LogAudience, LogTag, PhaseKind, PlayerState, PlayerStats, SeatId } from './types';

export function getPlayer(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

export function isActive(p: PlayerState): boolean {
  return p.status === 'alive';
}

export function activePlayers(s: GameState): PlayerState[] {
  return s.players.filter(isActive);
}

/** Whoever sits in a seat, living or dead. */
export function occupantOf(s: GameState, seat: SeatId): PlayerState | undefined {
  return s.players.find((p) => p.seat === seat);
}

export function emptySeats(s: GameState): SeatId[] {
  const taken = new Set(s.players.map((p) => p.seat));
  return allSeats(s.cabin.rows, s.cabin.cols).filter((id) => !taken.has(id));
}

/** Where a player is on the grid: their seat, or the Stewardess's aisle spot. */
export function cellOf(p: PlayerState): Cell {
  const cell = p.seat ? parsePlace(p.seat) : null;
  if (!cell) throw new Error(`${p.name} has no seat`);
  return cell;
}

/** Locked in the lavatory tonight: out of everyone's reach, and away from their seat. */
export function inWashroom(s: GameState, id: string): boolean {
  return s.phase.kind === 'night_act' && s.night.washroom === id;
}

/** Up in the jump seat tonight. */
export function isGuest(s: GameState, id: string): boolean {
  return s.phase.kind === 'night_act' && s.night.jumpseat === id;
}

/** On the flight deck right now: the Pilot, or his guest in the jump seat tonight. */
export function onFlightDeck(s: GameState, p: PlayerState): boolean {
  return isCockpit(p.seat) || isGuest(s, p.id);
}

export function newId(s: GameState): number {
  return s.nextId++;
}

export function addLog(
  s: GameState,
  now: number,
  to: LogAudience,
  tag: LogTag,
  text: string,
  data?: Record<string, unknown>,
): void {
  s.log.push({ id: newId(s), t: now, night: s.phase.night, phase: s.phase.kind, to, tag, text, ...(data ? { data } : {}) });
}

export function setPhase(s: GameState, kind: PhaseKind, now: number): void {
  s.phase = { kind, night: s.phase.night, startedAt: now, endsAt: now + phaseDurationMs(s.settings, kind), earlyEndAt: null };
}

/** Name plus role once the role is public. */
export function label(s: GameState, p: PlayerState): string {
  return p.revealed ? `${p.name} (${roleInfo(p.role, s.settings).name})` : p.name;
}

/** Read someone's black box note out to the cabin, once they have left play. */
export function readNote(s: GameState, p: PlayerState, now: number): void {
  const note = (p.note ?? '').trim();
  if (note) addLog(s, now, 'all', 'note', `${p.name}\u2019s black box note: \u201c${note}\u201d`, { player: p.id, note });
}

/** What a player has done that pays out at the end (created on first use). */
export function statsOf(s: GameState, id: string): PlayerStats {
  s.stats[id] ??= { kills: 0, rescues: 0, found: 0, defused: 0 };
  return s.stats[id];
}

export function fuseText(bomb: Bomb, night: number): string {
  const left = bomb.detonateNight - night;
  if (left <= 0) return 'about to go off';
  if (left === 1) return 'set to go off at the end of tomorrow night';
  return `set to go off in ${left} nights`;
}

/** Bombs a Bomber or the Mastermind still carries: one for every three scheduled nights of the flight (a custom bomb role: as many as the host gave it). */
export function bombsLeft(s: GameState, p: PlayerState): number {
  if (!hasAbility(s.settings, p.role, 'bomb')) return 0;
  const custom = usesLeft(s, p);
  if (custom !== null) return custom;
  return Math.max(0, bombsFor(destinationOf(s.settings).nights) - p.bombsPlanted);
}

/** The bomb still ticking at a seat, the cart or the lavatory: each holds one at a time. */
export function liveBombAt(s: GameState, where: BombLocation): Bomb | undefined {
  return s.bombs.find(
    (b) => !b.exploded && !b.defused && b.location.kind === where.kind && (where.kind !== 'seat' || (b.location.kind === 'seat' && b.location.seat === where.seat)),
  );
}

/** Fill in fields that games saved by an older version do not have. */
export function normalizeGame(s: GameState): GameState {
  s.settings = normalizeSettings(s.settings);
  s.id ??= `old-${s.rng.toString(36)}`;
  s.packed ??= {};
  s.stats ??= {};
  s.awards ??= null;
  s.recorder ??= [];
  s.meal ??= null;
  s.cabin.cols ??= [...SEAT_COLS];
  s.night.searched ??= {};
  s.night.asleep ??= {};
  s.night.drowsy ??= {};
  s.night.mirrors ??= {};
  s.night.flashlights ??= {};
  s.night.freed ??= {};
  s.night.defused ??= {};
  s.night.washroom ??= null;
  s.night.jumpseats ??= {};
  s.night.roughair ??= {};
  s.night.courses ??= {};
  s.night.jumpseat ??= null;
  s.day.doubled ??= {};
  for (const b of s.bombs) b.defused ??= false;
  for (const p of s.players) {
    p.note ??= '';
    p.cuffsUsed ??= false;
    p.items ??= [];
    p.usedItems ??= [];
    p.poisonedBy ??= null;
    p.washroomUsed ??= false;
    p.roughAirUsed ??= false;
    p.courseUsed ??= false;
    p.knockedOutNight ??= null;
    p.jamUsed ??= false;
    p.cuffedFrom ??= null;
    p.abilityUses ??= 0;
    // Older games gave each Bomber one bomb and only noted whether it was used.
    const old = p as PlayerState & { bombUsed?: boolean };
    p.bombsPlanted ??= old.bombUsed ? 1 : 0;
    delete old.bombUsed;
  }
  return s;
}

export function removeFromPlay(s: GameState, p: PlayerState, cause: DeathCause, night: number): void {
  p.status = cause === 'restrained' ? 'restrained' : 'dead';
  p.cause = cause;
  p.outNight = night;
  p.poisonedNight = null;
  if (cause === 'restrained') p.seat = null;
  if (s.settings.revealRoles) p.revealed = true;
}
