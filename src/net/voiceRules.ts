import { isNightPhase, isPaPhase, isPilot, type PhaseKind, type PlayerStatus, type RoleId, type Settings, type Team } from '../engine';

/**
 * Voice chat follows the chat rules. Out loud in the cabin while the lights are on: you hear people by how close
 * they are, as far as the captain's voice range. At night the living may only whisper, to the seats right round them
 * (the night range). Ghosts talk among themselves any time; the living never hear them. Before takeoff (the lobby,
 * packing, the gate) and after landing, everyone hears everyone.
 *
 * With the seatback chat open on a channel you may write in, your voice goes to that channel instead (see
 * `channelOpen`): everyone else on that channel's screen hears you, and nobody around you does.
 */
const OPEN: ReadonlySet<PhaseKind> = new Set(['takeoff', 'dawn', 'day_discuss', 'day_vote', 'verdict']);
/** Before the cabin: the lobby, packing and the gate, where voice is like one big call. */
const PREFLIGHT: ReadonlySet<PhaseKind> = new Set(['packing', 'boarding']);

/**
 * How a voice reaches a listener: through the cabin by distance (`cabin` by day, `whisper` at night), among ghosts,
 * to everyone, or not at all.
 */
export type VoiceRoute = 'cabin' | 'whisper' | 'ghosts' | 'everyone' | null;

export function voiceRoute(phase: PhaseKind, speakerAlive: boolean, listenerAlive: boolean, nightRange = 1): VoiceRoute {
  if (phase === 'ended' || PREFLIGHT.has(phase)) return 'everyone';
  if (!speakerAlive) return listenerAlive ? null : 'ghosts';
  if (OPEN.has(phase)) return 'cabin';
  if (isNightPhase(phase) && nightRange > 0) return 'whisper';
  return null;
}

/** Whether your microphone should carry anything right now (it sends silence otherwise). */
export function micOpen(phase: PhaseKind, alive: boolean, nightRange = 1): boolean {
  if (phase === 'ended' || PREFLIGHT.has(phase) || !alive) return true;
  return OPEN.has(phase) || (isNightPhase(phase) && nightRange > 0);
}

/** Whether to send your voice to a peer at all: the living never get a ghost's voice (until landing). */
export function sendsTo(phase: PhaseKind, youAlive: boolean, theyAlive: boolean): boolean {
  return youAlive || !theyAlive || phase === 'ended' || PREFLIGHT.has(phase);
}

/** The Pilot's PA carries his voice to the whole plane: a living Pilot, by day (when typed announcements work too). */
export function canPa(role: RoleId | null | undefined, status: PlayerStatus | undefined, phase: PhaseKind): boolean {
  return !!role && isPilot(role) && status === 'alive' && isPaPhase(phase);
}

/** A chat channel your voice can go to instead of the cabin. */
export type VoiceChannel = 'cabin' | 'saboteurs';

export function isVoiceChannel(x: unknown): x is VoiceChannel {
  return x === 'cabin' || x === 'saboteurs';
}

/**
 * May someone talk on this channel's screen right now (the same rules as typing there): the cabin channel by day for
 * the living, the saboteur channel at night for living saboteurs.
 */
export function channelOpen(channel: VoiceChannel, phase: PhaseKind, alive: boolean, team: Team | null): boolean {
  if (!alive) return false;
  if (channel === 'cabin') return OPEN.has(phase) || phase === 'ended';
  return team === 'saboteurs' && isNightPhase(phase);
}

/** Who may know that someone is on a channel's screen: anyone for the cabin channel, only saboteurs for theirs. */
export function channelVisible(channel: VoiceChannel, viewerTeam: Team | null, tower: boolean): boolean {
  return channel === 'cabin' || tower || viewerTeam === 'saboteurs';
}

/** Full volume within this many metres of you... */
export const VOICE_NEAR = 1.6;
/** ...and silent from this far (about eight rows back). */
export const VOICE_FAR = 7;

/** How loud someone in the cabin sounds from `meters` away (silent from `far`). For the 3D view's babble. */
export function proximityGain(meters: number, far = VOICE_FAR): number {
  if (far === Infinity) return 1;
  const near = Math.min(VOICE_NEAR, far * 0.5);
  if (meters <= near) return 1;
  if (meters >= far) return 0;
  const t = (far - meters) / (far - near);
  return t * t;
}

/** A seat is this wide and a row this deep: distances "in seats" count your neighbours all as 1 (the diagonal as 1.4). */
const SEAT_WIDTH = 0.46;
const ROW_DEPTH = 0.82;

export function seatDistance(dx: number, dz: number): number {
  return Math.hypot(dx / SEAT_WIDTH, dz / ROW_DEPTH);
}

/**
 * How far a voice carries right now, in seats: the day range, the night whisper range, everywhere ('cabin' mode by
 * day), or nowhere.
 */
export function voiceReach(settings: Pick<Settings, 'voiceMode' | 'voiceRange' | 'nightVoiceRange'>, route: VoiceRoute): number {
  if (settings.voiceMode === 'off' || route === null) return 0;
  if (route === 'whisper') return settings.nightVoiceRange ?? 1;
  if (route === 'cabin') return settings.voiceMode === 'cabin' ? Infinity : (settings.voiceRange ?? 8);
  return Infinity;
}

const smoothstep = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * How a voice arrives from (dx, dy, dz) metres away, with a reach of `seats`:
 * - `direct`: the voice itself, falling off like real speech (inverse distance from a metre), silent past the reach;
 * - `wet`: the room's echo of it, which carries about the same wherever you stand (so a far voice sounds roomy);
 * - `cutoff`: how much treble survives the air and the seatbacks in between (Hz).
 */
export function voiceCarry(dx: number, dy: number, dz: number, seats: number): { direct: number; wet: number; cutoff: number } {
  if (seats <= 0) return { direct: 0, wet: 0, cutoff: 20000 };
  const meters = Math.hypot(dx, dy, dz);
  const reach = seats === Infinity ? 1 : 1 - smoothstep(seats, seats + Math.max(0.6, seats * 0.25), seatDistance(dx, dz));
  const rowsBetween = Math.max(0, Math.abs(dz) / ROW_DEPTH - 1);
  const cutoff = Math.max(1200, 14000 / (1 + 0.45 * Math.max(0, meters - 1)) / (1 + 0.3 * rowsBetween));
  return { direct: reach / Math.max(1, meters), wet: 0.22 * reach, cutoff };
}
