import { SEAT_COLS } from './grid';
import type { PlaneId } from './types';

/** What a flight is flown in: how many can board, and how the seats are laid out. */
export interface Plane {
  id: PlaneId;
  name: string;
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  /** Grid columns that have seats (3 is the aisle). */
  cols: readonly number[];
}

export const PLANES: Record<PlaneId, Plane> = {
  airliner: {
    id: 'airliner',
    name: 'Airliner',
    blurb: 'Three seats either side of the aisle. The classic.',
    minPlayers: 4,
    maxPlayers: 16,
    cols: SEAT_COLS,
  },
  jet: {
    id: 'jet',
    name: 'Private jet',
    blurb: 'Four to six in leather seats, two by two with a wide aisle: nothing reaches across it.',
    minPlayers: 4,
    maxPlayers: 6,
    cols: [0, 1, 5, 6],
  },
  jumbo: {
    id: 'jumbo',
    name: 'Jumbo',
    blurb: 'Up to 24 on a long double-decker, with a spiral staircase up to the flight deck.',
    minPlayers: 10,
    maxPlayers: 24,
    cols: SEAT_COLS,
  },
};

export const PLANE_ORDER: readonly PlaneId[] = ['airliner', 'jet', 'jumbo'];

export function isPlaneId(id: unknown): id is PlaneId {
  return typeof id === 'string' && id in PLANES;
}

/** Cabin length for a flight booked for `maxPassengers` in `plane`. */
export function rowsFor(maxPassengers: number, plane: PlaneId = 'airliner'): number {
  if (plane === 'jet') return 5;
  if (plane === 'jumbo') return maxPassengers <= 16 ? 14 : 16;
  if (maxPassengers <= 8) return 8;
  if (maxPassengers <= 12) return 10;
  return 12;
}
