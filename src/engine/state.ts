import { allSeats, parseSeat } from './grid';
import { ROLES } from './roles';
import { normalizeSettings, phaseDurationMs } from './settings';
import type { Bomb, Cell, DeathCause, GameState, LogAudience, LogTag, PhaseKind, PlayerState, PlayerStats, SeatId } from './types';

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
  return allSeats(s.cabin.rows).filter((id) => !taken.has(id));
}

export function cellOf(p: PlayerState): Cell {
  const cell = p.seat ? parseSeat(p.seat) : null;
  if (!cell) throw new Error(`${p.name} has no seat`);
  return cell;
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
export function label(p: PlayerState): string {
  return p.revealed ? `${p.name} (${ROLES[p.role].name})` : p.name;
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

/** Fill in fields that games saved by an older version do not have. */
export function normalizeGame(s: GameState): GameState {
  s.settings = normalizeSettings(s.settings);
  s.id ??= `old-${s.rng.toString(36)}`;
  s.packed ??= {};
  s.stats ??= {};
  s.awards ??= null;
  s.night.searched ??= {};
  s.night.asleep ??= {};
  s.night.mirrors ??= {};
  s.night.flashlights ??= {};
  s.night.freed ??= {};
  s.night.defused ??= {};
  s.day.doubled ??= {};
  for (const b of s.bombs) b.defused ??= false;
  for (const p of s.players) {
    p.note ??= '';
    p.cuffsUsed ??= false;
    p.items ??= [];
    p.usedItems ??= [];
    p.poisonedBy ??= null;
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
