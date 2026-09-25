import { BULKHEAD_Z, FLIGHT_DECK, rowZ } from '../world/layout';

/**
 * The plane's rooms, as voices hear them. Each has its own echo (a reverb from an impulse response built here, from
 * noise shaped like the room: how long it rings, how bright it stays, how soon the first walls answer), and the walls
 * and doors between them muffle whatever passes through.
 */
export type Zone = 'cabin' | 'galley' | 'lavatory' | 'deck';

export const ZONES: readonly Zone[] = ['cabin', 'galley', 'lavatory', 'deck'];

interface Room {
  /** How long it rings (RT60, seconds). */
  seconds: number;
  /** How much treble the echo keeps, 0..1 (seats and carpet swallow it; tiles and metal do not). */
  bright: number;
  /** When the nearest walls answer (seconds), and how strongly. */
  early: number[];
  earlyLevel: number;
  /** How loud the echo is next to the voice. */
  level: number;
}

const ROOMS: Record<Zone, Room> = {
  // A long, soft tube: seats, carpet and people soak it up.
  cabin: { seconds: 0.55, bright: 0.28, early: [0.006, 0.011, 0.019, 0.031], earlyLevel: 0.35, level: 0.8 },
  // Steel and laminate: brighter, and it rings a little longer.
  galley: { seconds: 0.7, bright: 0.62, early: [0.004, 0.007, 0.013, 0.02], earlyLevel: 0.55, level: 1 },
  // A tiny tiled box: bright and close, walls answering almost at once.
  lavatory: { seconds: 0.42, bright: 0.85, early: [0.0022, 0.0034, 0.0051, 0.0068, 0.009], earlyLevel: 0.8, level: 1.2 },
  // Small and full of panels and seats.
  deck: { seconds: 0.32, bright: 0.45, early: [0.003, 0.005, 0.009], earlyLevel: 0.45, level: 0.7 },
};

/** Which room a point is in: the flight deck past its door, the galley past the curtain, the lavatory at the back. */
export function zoneAt(x: number, z: number, rows: number): Zone {
  if (z < FLIGHT_DECK.doorZ) return 'deck';
  if (z < BULKHEAD_Z - 0.12) return 'galley';
  if (z > rowZ(rows) + 0.62 && x < -0.3) return 'lavatory';
  return 'cabin';
}

/** What gets through between two rooms: how loud and how much treble (a curtain lets most through, a door little). */
export function wallBetween(a: Zone, b: Zone): { gain: number; cutoff: number } {
  if (a === b) return { gain: 1, cutoff: 20000 };
  if (a === 'lavatory' || b === 'lavatory') return { gain: 0.22, cutoff: 650 };
  if (a === 'deck' || b === 'deck') return { gain: a === 'galley' || b === 'galley' ? 0.32 : 0.2, cutoff: 900 };
  // The galley curtain.
  return { gain: 0.75, cutoff: 4200 };
}

/** How loud a room's echo plays back. */
export function roomLevel(zone: Zone): number {
  return ROOMS[zone].level;
}

/** A small random number generator, so every room sounds the same every time. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

/**
 * A room's impulse response (stereo): the first reflections off the nearest walls, then a tail of noise that dies
 * away over the room's ring time, losing its treble faster than its body.
 */
export function roomImpulse(ctx: BaseAudioContext, zone: Zone): AudioBuffer {
  const room = ROOMS[zone];
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * room.seconds * 1.15));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const rand = noise(ZONES.indexOf(zone) * 7919 + channel * 104729 + 17);
    let low = 0;
    const predelay = room.early[0];
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      if (t < predelay) continue;
      const decay = Math.exp((-6.9 * (t - predelay)) / room.seconds);
      // A one-pole low-pass that closes as the tail goes on: the treble dies first.
      const openness = Math.min(1, room.bright * Math.exp(-(t - predelay) * (1 - room.bright) * 9) + 0.02);
      low += openness * (rand() - low);
      data[i] = low * decay;
    }
    // The first walls: a few sharp answers, alternating sides.
    room.early.forEach((delay, k) => {
      const i = Math.floor((delay + (channel ? 0.0007 * (k % 2) : 0.0007 * ((k + 1) % 2))) * rate);
      if (i < length) data[i] += room.earlyLevel * (k % 2 ? -1 : 1) * Math.exp(-k * 0.35);
    });
    // Even out the energy so each room's level setting means the same thing.
    let energy = 0;
    for (let i = 0; i < length; i++) energy += data[i] * data[i];
    const scale = 1 / Math.sqrt(Math.max(1e-9, energy));
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}
