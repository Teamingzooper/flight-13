import type { PhaseKind } from '../engine';

/**
 * Voice chat follows the chat rules. Out loud in the cabin while the lights are on, and you hear people
 * by how close they are. Silence for the living at night. Ghosts talk among themselves any time; the
 * living never hear them. After landing, everyone hears everyone.
 */
const OPEN: ReadonlySet<PhaseKind> = new Set(['takeoff', 'dawn', 'day_discuss', 'day_vote', 'verdict']);

/** How a voice reaches a listener: through the cabin (by distance), among ghosts, to everyone, or not at all. */
export type VoiceRoute = 'cabin' | 'ghosts' | 'everyone' | null;

export function voiceRoute(phase: PhaseKind, speakerAlive: boolean, listenerAlive: boolean): VoiceRoute {
  if (phase === 'ended') return 'everyone';
  if (!speakerAlive) return listenerAlive ? null : 'ghosts';
  return OPEN.has(phase) ? 'cabin' : null;
}

/** Whether your microphone should carry anything right now (it sends silence otherwise). */
export function micOpen(phase: PhaseKind, alive: boolean): boolean {
  if (phase === 'ended') return true;
  return alive ? OPEN.has(phase) : phase !== 'packing' && phase !== 'boarding';
}

/** Whether to send your voice to a peer at all: the living never get a ghost's voice (until landing). */
export function sendsTo(phase: PhaseKind, youAlive: boolean, theyAlive: boolean): boolean {
  return youAlive || !theyAlive || phase === 'ended';
}

/** Full volume within this many metres of you... */
export const VOICE_NEAR = 1.6;
/** ...and silent from this far (about eight rows back). */
export const VOICE_FAR = 7;

/** How loud someone in the cabin sounds from `meters` away. */
export function proximityGain(meters: number): number {
  if (meters <= VOICE_NEAR) return 1;
  if (meters >= VOICE_FAR) return 0;
  const t = (VOICE_FAR - meters) / (VOICE_FAR - VOICE_NEAR);
  return t * t;
}
