import { grid, type SeatId } from '../engine';

/** Metres. Row 1 is at z = 0, rows run toward +z, passengers face -z. */
export const PITCH = 0.82;
export const SEAT_WIDTH = 0.46;
export const AISLE_WIDTH = 0.5;
export const CABIN_HALF_WIDTH = 1.82;
export const EYE_HEIGHT = 1.12;
export const SCREEN_HEIGHT = 0.98;
/** Galley bulkhead in front of row 1. */
export const BULKHEAD_Z = -0.62;

/** x centre of grid column 0..6 (3 is the aisle). */
export function colX(col: number): number {
  if (col === grid.AISLE_COL) return 0;
  const side = col < grid.AISLE_COL ? -1 : 1;
  const fromAisle = col < grid.AISLE_COL ? grid.AISLE_COL - 1 - col : col - grid.AISLE_COL - 1;
  return side * (AISLE_WIDTH / 2 + SEAT_WIDTH / 2 + fromAisle * SEAT_WIDTH);
}

export function rowZ(row: number): number {
  return (row - 1) * PITCH;
}

export function seatPose(id: SeatId): { x: number; z: number } {
  const cell = grid.parseSeat(id);
  if (!cell) throw new Error(`Bad seat ${id}`);
  return { x: colX(cell.col), z: rowZ(cell.row) };
}

/** Where a seated passenger's eyes are. */
export function eyePosition(id: SeatId): { x: number; y: number; z: number } {
  const { x, z } = seatPose(id);
  return { x, y: EYE_HEIGHT, z: z + 0.1 };
}

/** Centre of the screen a passenger uses: the back of the seat ahead, or the bulkhead for row 1. */
export function screenPose(id: SeatId): { x: number; y: number; z: number } {
  const cell = grid.parseSeat(id);
  if (!cell) throw new Error(`Bad seat ${id}`);
  const x = colX(cell.col);
  return cell.row > 1 ? { x, y: SCREEN_HEIGHT, z: rowZ(cell.row - 1) + 0.3 } : { x, y: SCREEN_HEIGHT, z: BULKHEAD_Z + 0.03 };
}
