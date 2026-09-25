import { CUSTOM_LIMITS, DESTINATIONS, destinationOf, hasTwist } from './destinations';
import { PLANES, isPlaneId } from './planes';
import { emptyCards } from './roles';
import type { BotChatter, BotSkill, CustomDestination, PhaseKind, Settings, TimerPreset, Twist } from './types';

export const MIN_PLAYERS = 4;
/** The most any plane carries (the jumbo); each plane has its own range (engine/planes.ts). */
export const MAX_PLAYERS = 24;
export const EARLY_END_GRACE_MS = 3000;
/** After the last night action, long enough to finish looking under your seat before the lights come on. */
export const NIGHT_ACT_GRACE_MS = 7000;
export const CHAT_MAX_LENGTH = 200;
export const CHAT_COOLDOWN_MS = 1000;
export const CHAT_HISTORY = 300;
export const NOTE_MAX_LENGTH = 300;
/** The Pilot's PA: short announcements, a little while apart. */
export const PA_MAX_LENGTH = 140;
export const PA_COOLDOWN_MS = 15_000;

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

export const BOT_CHATTERS: readonly BotChatter[] = ['quiet', 'normal', 'lively'];
export const BOT_SKILLS: readonly BotSkill[] = ['easy', 'normal', 'hard'];

export function defaultSettings(): Settings {
  return {
    plane: 'airliner',
    destination: 'LHR',
    customDestination: null,
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
    botChatter: 'normal',
    botSkill: 'normal',
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
      const factor = hasTwist(destinationOf(settings), 'redeye') ? 0.6 : 1;
      return Math.round(TIMERS[settings.timers].day_discuss * factor) * 1000;
    }
    default:
      return TIMERS[settings.timers][kind] * 1000;
  }
}

const TWIST_IDS: readonly Twist[] = ['turbulence', 'redeye', 'triangle'];

/** Why a host-made destination is not allowed, or null. */
export function validateCustomDestination(c: CustomDestination | null): string | null {
  if (!c) return 'Describe your destination.';
  const city = c.city.trim();
  if (city.length < 1 || city.length > CUSTOM_LIMITS.cityLength) return `The city needs 1 to ${CUSTOM_LIMITS.cityLength} characters.`;
  if (!/^[A-Z]{3}$/.test(c.code)) return 'The code must be three letters.';
  if (!Number.isInteger(c.nights) || c.nights < CUSTOM_LIMITS.minNights || c.nights > CUSTOM_LIMITS.maxNights) {
    return `A flight lasts ${CUSTOM_LIMITS.minNights} to ${CUSTOM_LIMITS.maxNights} nights.`;
  }
  if (!Array.isArray(c.twists) || c.twists.some((t) => !TWIST_IDS.includes(t)) || new Set(c.twists).size !== c.twists.length) return 'Unknown effect.';
  return null;
}

export function validateSettings(s: Settings): string | null {
  if (s.destination === 'custom') {
    const bad = validateCustomDestination(s.customDestination);
    if (bad) return bad;
  } else if (!DESTINATIONS[s.destination]) return 'Unknown destination.';
  if (!isPlaneId(s.plane)) return 'Unknown plane.';
  const plane = PLANES[s.plane];
  if (!Number.isInteger(s.maxPassengers) || s.maxPassengers < plane.minPlayers || s.maxPassengers > plane.maxPlayers) {
    return `The ${plane.name.toLowerCase()} takes ${plane.minPlayers} to ${plane.maxPlayers} passengers.`;
  }
  if (!(s.stewardessRogueChance >= 0 && s.stewardessRogueChance <= 1)) return 'Stewardess odds must be between 0 and 1.';
  if (!(s.pilotRogueChance >= 0 && s.pilotRogueChance <= 1)) return 'Pilot odds must be between 0 and 1.';
  if (!TIMERS[s.timers]) return 'Unknown timer preset.';
  if (s.rolesMode !== 'auto' && s.rolesMode !== 'custom') return 'Unknown roles mode.';
  if (s.voteMode !== 'daily' && s.voteMode !== 'afterIncident') return 'Unknown vote mode.';
  if (!BOT_CHATTERS.includes(s.botChatter)) return 'Unknown bot chatter.';
  if (!BOT_SKILLS.includes(s.botSkill)) return 'Unknown bot skill.';
  return null;
}
