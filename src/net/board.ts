import { PLANES, destinationOf } from '../engine';
import type { HostSnapshot } from './host';

/**
 * The departures board: flights the server runs that are still boarding and listed by their captain. Rooms report
 * their row to the board (server/src/index.ts); the home page shows them.
 */
export interface BoardFlight {
  code: string;
  /** Where it flies: the city and its airport code. */
  city: string;
  airport: string;
  plane: string;
  /** The captain's name (empty for a control tower flight). */
  captain: string;
  /** Passengers aboard (bots too) and the most the plane takes. */
  aboard: number;
  max: number;
  /** How many are people, not bots. */
  people: number;
}

/** The flight's row on the board, or null if it should not be there (unlisted, in the air, or nobody aboard). */
export function boardRow(s: HostSnapshot, connected: number): BoardFlight | null {
  if (!s.settings.listed || s.game || s.tutorial || connected === 0) return null;
  const destination = destinationOf(s.settings);
  const captain = s.controlTower ? '' : (s.players.find((p) => !p.bot && p.token === s.hostToken)?.name ?? '');
  return {
    code: s.code,
    city: destination.city,
    airport: destination.code,
    plane: PLANES[s.settings.plane].name,
    captain,
    aboard: s.players.length,
    max: s.settings.maxPassengers,
    people: s.players.filter((p) => !p.bot).length,
  };
}

/** Rows the board no longer hears about drop off after this long (rooms report every minute). */
export const BOARD_STALE_MS = 3 * 60_000;

/** The board: flights with seats left first, the busiest first. */
export function sortBoard(rows: BoardFlight[]): BoardFlight[] {
  return [...rows].sort((a, b) => Number(a.aboard >= a.max) - Number(b.aboard >= b.max) || b.people - a.people || a.code.localeCompare(b.code));
}

/** Shape-check a board row from the network. */
export function isBoardFlight(x: unknown): x is BoardFlight {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.code === 'string' &&
    typeof r.city === 'string' &&
    typeof r.airport === 'string' &&
    typeof r.plane === 'string' &&
    typeof r.captain === 'string' &&
    Number.isInteger(r.aboard) &&
    Number.isInteger(r.max) &&
    Number.isInteger(r.people)
  );
}
