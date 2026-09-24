import type { Cell, SeatId } from './types';

export const AISLE_COL = 3;
export const SEAT_COLS = [0, 1, 2, 4, 5, 6] as const;
export const BLAST_RADIUS = 2;
export const SWEEP_RADIUS = 1;
export const WHISPER_RADIUS = 2;
/** How far the Air Marshal can reach with the handcuffs. */
export const CUFF_RADIUS = 2;

const LETTER_BY_COL: Record<number, string> = { 0: 'A', 1: 'B', 2: 'C', 4: 'D', 5: 'E', 6: 'F' };
const COL_BY_LETTER: Record<string, number> = { A: 0, B: 1, C: 2, D: 4, E: 5, F: 6 };

/** Cabin length for a flight booked for `maxPassengers`. */
export function rowsFor(maxPassengers: number): number {
  if (maxPassengers <= 8) return 8;
  if (maxPassengers <= 12) return 10;
  return 12;
}

export function seatId(cell: Cell): SeatId {
  const letter = LETTER_BY_COL[cell.col];
  if (!letter) throw new Error(`Column ${cell.col} has no seats`);
  return `${cell.row}${letter}`;
}

export function parseSeat(id: SeatId): Cell | null {
  const m = /^([1-9]\d?)([A-F])$/.exec(id);
  if (!m) return null;
  return { row: Number(m[1]), col: COL_BY_LETTER[m[2]] };
}

export function isSeatInCabin(id: SeatId, rows: number): boolean {
  const cell = parseSeat(id);
  return cell !== null && cell.row <= rows;
}

export function allSeats(rows: number): SeatId[] {
  const seats: SeatId[] = [];
  for (let row = 1; row <= rows; row++) {
    for (const col of SEAT_COLS) seats.push(seatId({ row, col }));
  }
  return seats;
}

/** Chebyshev distance: diagonals count as 1 and the aisle is a cell of its own. */
export function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

export function distanceToAny(a: Cell, cells: readonly Cell[]): number {
  let best = Infinity;
  for (const c of cells) best = Math.min(best, distance(a, c));
  return best;
}

export function seatDistance(a: SeatId, b: SeatId): number {
  const ca = parseSeat(a);
  const cb = parseSeat(b);
  if (!ca || !cb) throw new Error(`Bad seat id: ${a} / ${b}`);
  return distance(ca, cb);
}

export function cartCell(row: number): Cell {
  return { row, col: AISLE_COL };
}

export function lavatoryCells(rows: number): Cell[] {
  return [0, 1, 2].map((col) => ({ row: rows + 1, col }));
}

/** Seats whose cell is within `radius` of any of `centers`. */
export function seatsWithin(centers: readonly Cell[], radius: number, rows: number): SeatId[] {
  return allSeats(rows).filter((id) => distanceToAny(parseSeat(id)!, centers) <= radius);
}

export function isAisleSeat(id: SeatId): boolean {
  const cell = parseSeat(id);
  return cell !== null && (cell.col === 2 || cell.col === 4);
}

/** Stable front-to-back, left-to-right ordering key. */
export function seatOrder(id: SeatId): number {
  const cell = parseSeat(id);
  return cell ? cell.row * 10 + cell.col : Number.MAX_SAFE_INTEGER;
}
