import type { PhaseKind, PlayerStatus } from '../engine';

export type EmoteId = 'wave' | 'point' | 'shrug' | 'facepalm' | 'clap';

export interface EmoteInfo {
  id: EmoteId;
  name: string;
  icon: string;
  /** Keyboard shortcut in the 3D cabin. */
  key: string;
  /** How long the gesture plays. */
  seconds: number;
}

export const EMOTES: readonly EmoteInfo[] = [
  { id: 'wave', name: 'Wave', icon: '👋', key: '1', seconds: 2.2 },
  { id: 'point', name: 'Point', icon: '👉', key: '2', seconds: 2.4 },
  { id: 'shrug', name: 'Shrug', icon: '🤷', key: '3', seconds: 1.8 },
  { id: 'facepalm', name: 'Facepalm', icon: '🤦', key: '4', seconds: 2.2 },
  { id: 'clap', name: 'Clap', icon: '👏', key: '5', seconds: 2 },
];

export const EMOTE_BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e])) as Record<EmoteId, EmoteInfo>;

/** One emote per person this often, at most. */
export const EMOTE_COOLDOWN_MS = 1200;

export function isEmoteId(x: unknown): x is EmoteId {
  return typeof x === 'string' && Object.hasOwn(EMOTE_BY_ID, x);
}

const EMOTE_PHASES: ReadonlySet<PhaseKind> = new Set(['takeoff', 'dawn', 'day_discuss', 'day_vote', 'verdict']);

/** Gestures are for when the lights are on, by people still in play (the dead and the cuffed stay still). */
export function canEmote(phase: PhaseKind, status: PlayerStatus): boolean {
  return status === 'alive' && EMOTE_PHASES.has(phase);
}
