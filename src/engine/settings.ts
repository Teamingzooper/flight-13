import { DESTINATIONS } from './destinations';
import { emptyCards } from './roles';
import type { PhaseKind, Settings, TimerPreset } from './types';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const EARLY_END_GRACE_MS = 3000;
export const CHAT_MAX_LENGTH = 200;
export const CHAT_COOLDOWN_MS = 1000;
export const CHAT_HISTORY = 300;

export interface TimerSet {
  night_move: number;
  night_act: number;
  day_discuss: number;
  day_vote: number;
}

/** Seconds per adjustable phase. */
export const TIMERS: Record<TimerPreset, TimerSet> = {
  quick: { night_move: 15, night_act: 20, day_discuss: 60, day_vote: 20 },
  standard: { night_move: 20, night_act: 30, day_discuss: 90, day_vote: 30 },
  relaxed: { night_move: 30, night_act: 45, day_discuss: 150, day_vote: 45 },
};

/** Seconds for the cutscene phases. */
export const FIXED_TIMERS = { takeoff: 12, dawn: 10, verdict: 8 } as const;

export function defaultSettings(): Settings {
  return {
    destination: 'LHR',
    maxPassengers: 10,
    rolesMode: 'auto',
    cards: emptyCards(),
    stewardessRogueChance: 0.5,
    timers: 'standard',
    revealRoles: true,
    voteMode: 'daily',
    anonymousVotes: false,
    whispers: true,
  };
}

/** Length of a phase in milliseconds. */
export function phaseDurationMs(settings: Settings, kind: PhaseKind): number {
  switch (kind) {
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
  if (!TIMERS[s.timers]) return 'Unknown timer preset.';
  if (s.rolesMode !== 'auto' && s.rolesMode !== 'custom') return 'Unknown roles mode.';
  if (s.voteMode !== 'daily' && s.voteMode !== 'afterIncident') return 'Unknown vote mode.';
  return null;
}
