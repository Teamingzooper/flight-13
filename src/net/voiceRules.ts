import { isPaPhase, isPilot, type PhaseKind, type PlayerStatus, type RoleId, type Settings } from '../engine';

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

/** The Pilot's PA carries his voice to the whole plane: a living Pilot, by day (when typed announcements work too). */
export function canPa(role: RoleId | null | undefined, status: PlayerStatus | undefined, phase: PhaseKind): boolean {
  return !!role && isPilot(role) && status === 'alive' && isPaPhase(phase);
}

/** Full volume within this many metres of you... */
export const VOICE_NEAR = 1.6;
/** ...and silent from this far (about eight rows back). */
export const VOICE_FAR = 7;

/** How loud someone in the cabin sounds from `meters` away (silent from `far`: the flight's voice range). */
export function proximityGain(meters: number, far = VOICE_FAR): number {
  if (far === Infinity) return 1;
  const near = Math.min(VOICE_NEAR, far * 0.5);
  if (meters <= near) return 1;
  if (meters >= far) return 0;
  const t = (far - meters) / (far - near);
  return t * t;
}

/** A seat row is this deep: the flight's voice range, in rows, becomes metres with it. */
const ROW_DEPTH = 0.82;

/** How far a voice carries on this flight, in metres ('cabin' mode: the whole plane). */
export function voiceFar(settings: Pick<Settings, 'voiceMode' | 'voiceRange'>): number {
  if (settings.voiceMode === 'cabin') return Infinity;
  if (settings.voiceMode === 'off') return 0;
  return (settings.voiceRange ?? 8) * ROW_DEPTH + 0.5;
}
