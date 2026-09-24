import { grid, type SeatId } from '../engine';

/** Metres. Row 1 is at z = 0, rows run toward +z, passengers face -z. */
export const PITCH = 0.82;
export const SEAT_WIDTH = 0.46;
export const AISLE_WIDTH = 0.5;
export const CABIN_HALF_WIDTH = 1.82;
export const EYE_HEIGHT = 1.2;
export const SCREEN_HEIGHT = 0.9;
/** Galley bulkhead in front of row 1. */
export const BULKHEAD_Z = -0.62;
/** Eye height standing up. */
export const STANDING_EYE = 1.58;
/** The Stewardess stands this far behind the drink cart (towards the back), hands on its handle. */
export const CREW_BEHIND = 0.62;
/** The crew tablet on the cart: where it sits (from the cart's centre) and how far it tilts back. */
export const TABLET = { y: 1.22, z: 0.05, tilt: -0.6 };

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

/** Where a seat is on the cabin floor (for the Stewardess's aisle spot: where she stands, behind the cart). */
export function seatPose(id: SeatId): { x: number; z: number } {
  const cell = grid.parsePlace(id);
  if (!cell) throw new Error(`Bad seat ${id}`);
  return { x: colX(cell.col), z: rowZ(cell.row) + (cell.col === grid.AISLE_COL ? CREW_BEHIND : 0) };
}

/** Where a seated passenger's eyes are (standing, for crew). */
export function eyePosition(id: SeatId): { x: number; y: number; z: number } {
  const { x, z } = seatPose(id);
  return grid.isAisleSpot(id) ? { x, y: STANDING_EYE, z: z - 0.05 } : { x, y: EYE_HEIGHT, z: z + 0.1 };
}

/** Centre of the screen a passenger uses: the back of the seat ahead, or the bulkhead for row 1. */
export function screenPose(id: SeatId): { x: number; y: number; z: number } {
  const cell = grid.parsePlace(id);
  if (!cell) throw new Error(`Bad seat ${id}`);
  // Crew use the tablet on the drink cart.
  if (cell.col === grid.AISLE_COL) return { x: 0, y: TABLET.y, z: rowZ(cell.row) + TABLET.z };
  const x = colX(cell.col);
  return cell.row > 1 ? { x, y: SCREEN_HEIGHT, z: rowZ(cell.row - 1) + 0.3 } : { x, y: SCREEN_HEIGHT, z: BULKHEAD_Z + 0.03 };
}
