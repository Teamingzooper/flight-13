import { defaultSettings, emptyCards, type Intent, type Look, type PhaseKind, type Settings } from '../engine';

/**
 * Flight School's shared parts: the five bots (Mia, Ravi, Sam, Nora and Leo), the flight they fly, and what a scripted
 * beat is. Each lesson (lessons.ts) casts them in its own roles and seats and writes their cues. Pure.
 */

export type TutorialBot = 'Mia' | 'Ravi' | 'Sam' | 'Nora' | 'Leo';

export const TUTORIAL_BOTS: readonly TutorialBot[] = ['Mia', 'Ravi', 'Sam', 'Nora', 'Leo'];

/** How each bot looks (the same in every lesson; only their roles and seats change). */
export const BOT_LOOKS: Record<TutorialBot, Look> = {
  Mia: { body: 0, skin: 1, hair: 9, hairColor: 5, top: 9, topStyle: 2, bottom: 0, eyes: 2 },
  Ravi: { body: 1, skin: 3, hair: 0, hairColor: 0, top: 5, topStyle: 0, bottom: 1, eyes: 1 },
  Sam: { body: 2, skin: 5, hair: 3, hairColor: 0, top: 7, topStyle: 1, bottom: 3, neck: 1 },
  Nora: { body: 0, skin: 6, hair: 2, hairColor: 3, top: 1, topStyle: 0, bottom: 0 },
  Leo: { body: 1, skin: 2, hair: 3, hairColor: 1, top: 8, topStyle: 0, bottom: 0, hat: 2, eyes: 3 },
};

/** The bots' names on the manifest. */
export const botName = (name: TutorialBot) => `${name} (bot)`;

export function tutorialSettings(): Settings {
  return {
    ...defaultSettings(),
    plane: 'airliner',
    destination: 'custom',
    customDestination: { city: 'Flight School', code: 'FLY', nights: 3, twists: [] },
    maxPassengers: 6,
    rolesMode: 'custom',
    cards: { ...emptyCards(), bomber: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 1 },
    stewardessRogueChance: 0,
    pilotRogueChance: 0,
    timers: 'relaxed',
    revealRoles: true,
    voteMode: 'daily',
    whispers: true,
    // (No lunch: the tutorial keeps to its script.)
    mealService: false,
    botChatter: 'quiet',
    listed: false,
  };
}

/** Player ids, by bot name (or 'you'). */
export type Ids = (who: TutorialBot | 'you') => string;

/** One scripted beat: `after` ms into the phase, a bot does something or says something. */
export interface Cue {
  bot: TutorialBot;
  after: number;
  intent?: (ids: Ids) => Intent;
  say?: { channel: 'cabin' | 'pa'; text: string };
}

export const act = (action: Extract<Intent, { kind: 'act' }>['action']): Intent => ({ kind: 'act', action });

/** Everyone packs (nothing) and is ready, a moment apart. */
export function packingCues(): Cue[] {
  return TUTORIAL_BOTS.map((bot, i) => ({ bot, after: 1500 + i * 500, intent: () => ({ kind: 'pack', items: [], ready: true }) }));
}

/** Phases the tutorial waits in for you (the host keeps their clocks from running out). */
export const TUTORIAL_WAITS: ReadonlySet<PhaseKind> = new Set(['packing', 'night_move', 'night_act', 'day_discuss', 'day_vote']);

export interface CoachStep {
  title: string;
  text: string;
}
