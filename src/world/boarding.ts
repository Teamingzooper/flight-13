/** The boarding sequence, shot by shot, in seconds from the start of the boarding phase. */
export type BoardingShot = 'pack' | 'queue' | 'scan' | 'aisle';

export const BOARDING_SHOTS: readonly { shot: BoardingShot; start: number; end: number }[] = [
  // The bag zips shut in the hotel room.
  { shot: 'pack', start: 0, end: 2.2 },
  // Standing in line at gate 13.
  { shot: 'queue', start: 2.2, end: 8.2 },
  // Your boarding pass on the scanner.
  { shot: 'scan', start: 8.2, end: 12.8 },
  // In through the front of the cabin, down the aisle, into your seat.
  { shot: 'aisle', start: 12.8, end: 22 },
];

/** Seconds of black between shots (each side). */
export const FADE = 0.55;

export interface BoardingMoment {
  shot: BoardingShot;
  /** Seconds into the shot. */
  t: number;
  /** Seconds the shot lasts. */
  length: number;
  /** How dark the picture is, 0 (clear) to 1 (black). */
  black: number;
}

/** What plays `elapsed` seconds into boarding. Every shot fades in and out, except that the hotel starts clear. */
export function boardingMoment(elapsed: number): BoardingMoment {
  const at = Math.max(0, elapsed);
  const entry = BOARDING_SHOTS.find((s) => at < s.end) ?? BOARDING_SHOTS[BOARDING_SHOTS.length - 1];
  const length = entry.end - entry.start;
  const t = Math.min(length, at - entry.start);
  const fadeIn = entry.shot === 'pack' ? 0 : Math.max(0, 1 - t / FADE);
  const fadeOut = Math.max(0, 1 - (length - t) / (entry.shot === 'pack' ? FADE + 0.15 : FADE));
  return { shot: entry.shot, t, length, black: Math.min(1, Math.max(fadeIn, fadeOut)) };
}
