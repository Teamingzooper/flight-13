import { DESTINATIONS } from './destinations';
import { emptyCards } from './roles';
import type { PhaseKind, Settings, TimerPreset } from './types';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const EARLY_END_GRACE_MS = 3000;
/** After the last night action, long enough to finish looking under your seat before the lights come on. */
export const NIGHT_ACT_GRACE_MS = 7000;
export const CHAT_MAX_LENGTH = 200;
export const CHAT_COOLDOWN_MS = 1000;
export const CHAT_HISTORY = 300;
export const NOTE_MAX_LENGTH = 300;

export interface TimerSet {
  night_move: number;
  night_act: number;
  day_discuss: number;
  day_vote: number;
}

/** Seconds per adjustable phase. */
export const TIMERS: Record<TimerPreset, TimerSet> = {
  quick: { night_move: 20, night_act: 30, day_discuss: 60, day_vote: 20 },
  standard: { night_move: 25, night_act: 40, day_discuss: 90, day_vote: 30 },
  relaxed: { night_move: 35, night_act: 55, day_discuss: 150, day_vote: 45 },
};

/** Seconds for packing and the cutscene phases (packing ends early once everyone is packed). */
export const FIXED_TIMERS = { packing: 50, boarding: 22, takeoff: 12, dawn: 10, verdict: 8 } as const;

export function defaultSettings(): Settings {
  return {
    destination: 'LHR',
    maxPassengers: 10,
    rolesMode: 'auto',
    cards: emptyCards(),
    stewardessRogueChance: 0.5,
    pilotRogueChance: 0.3,
    timers: 'standard',
    revealRoles: true,
    voteMode: 'daily',
    anonymousVotes: false,
    whispers: true,
    pilotMustFly: false,
  };
}

/** Fill in fields that settings saved by an older version do not have. */
export function normalizeSettings(s: Settings): Settings {
  return { ...defaultSettings(), ...s, cards: { ...emptyCards(), ...s.cards } };
}

/** Length of a phase in milliseconds. */
export function phaseDurationMs(settings: Settings, kind: PhaseKind): number {
  switch (kind) {
    case 'packing':
    case 'boarding':
    case 'takeoff':
    case 'dawn':
    case 'verdict':
      return FIXED_TIMERS[kind] * 1000;
    case 'ended':
      return 0;
    case 'day_discuss': {
      const factor = DESTINATIONS[settings.destination].twist === 'redeye' ? 0.6 : 1;
      return Math.round(TIMERS[settings.timers].day_discuss * factor) * 1000;
    }
    default:
      return TIMERS[settings.timers][kind] * 1000;
  }
}

export function validateSettings(s: Settings): string | null {
  if (!DESTINATIONS[s.destination]) return 'Unknown destination.';
  if (!Number.isInteger(s.maxPassengers) || s.maxPassengers < MIN_PLAYERS || s.maxPassengers > MAX_PLAYERS) {
    return `Max passengers must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`;
  }
  if (!(s.stewardessRogueChance >= 0 && s.stewardessRogueChance <= 1)) return 'Stewardess odds must be between 0 and 1.';
  if (!(s.pilotRogueChance >= 0 && s.pilotRogueChance <= 1)) return 'Pilot odds must be between 0 and 1.';
  if (!TIMERS[s.timers]) return 'Unknown timer preset.';
  if (s.rolesMode !== 'auto' && s.rolesMode !== 'custom') return 'Unknown roles mode.';
  if (s.voteMode !== 'daily' && s.voteMode !== 'afterIncident') return 'Unknown vote mode.';
  return null;
}
