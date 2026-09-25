import { defaultSettings, emptyCards, type Intent, type Look, type PhaseKind, type PlayerView, type RoleId, type SeatId, type Settings } from '../engine';

/**
 * The tutorial flight ("Flight School"): you and five scripted bots on one short flight. You sit next to Mia, the
 * Bomber, who boarded with a bomb under her seat; your flashlight finds it on the first night, the cabin backs you up
 * by day and the vote restrains her. The host plays the bots' cues; the coach tells you what to do. Pure.
 */

export type TutorialBot = 'Mia' | 'Ravi' | 'Sam' | 'Nora' | 'Leo';

export interface CastMember {
  name: TutorialBot;
  role: RoleId;
  seat: SeatId;
  look: Look;
}

export const TUTORIAL_CAST: readonly CastMember[] = [
  { name: 'Mia', role: 'bomber', seat: '3C', look: { body: 0, skin: 1, hair: 9, hairColor: 5, top: 9, topStyle: 2, bottom: 0, eyes: 2 } },
  { name: 'Ravi', role: 'investigator', seat: '5E', look: { body: 1, skin: 3, hair: 0, hairColor: 0, top: 5, topStyle: 0, bottom: 1, eyes: 1 } },
  { name: 'Sam', role: 'nurse', seat: '2A', look: { body: 2, skin: 5, hair: 3, hairColor: 0, top: 7, topStyle: 1, bottom: 3, neck: 1 } },
  { name: 'Nora', role: 'stewardess_loyal', seat: 'Aisle 6', look: { body: 0, skin: 6, hair: 2, hairColor: 3, top: 1, topStyle: 0, bottom: 0 } },
  { name: 'Leo', role: 'pilot', seat: 'Cockpit', look: { body: 1, skin: 2, hair: 3, hairColor: 1, top: 8, topStyle: 0, bottom: 0, hat: 2, eyes: 3 } },
];

/** Mia's bomb, under her seat from takeoff, goes off at the end of this night (unless she is caught first). */
export const TUTORIAL_BOMB_NIGHT = 2;

/** You: a Passenger, right next to the Bomber. */
export const TUTORIAL_YOU: { role: RoleId; seat: SeatId } = { role: 'passenger', seat: '3B' };

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

const act = (action: Extract<Intent, { kind: 'act' }>['action']): Intent => ({ kind: 'act', action });

/** What the bots do in a phase of the tutorial (none past the first day: by then it is over). */
export function tutorialCues(kind: PhaseKind, night: number): Cue[] {
  if (kind === 'packing') {
    return (['Mia', 'Ravi', 'Sam', 'Nora', 'Leo'] as const).map((bot, i) => ({ bot, after: 1500 + i * 500, intent: () => ({ kind: 'pack', items: [], ready: true }) }));
  }
  if (night !== 1) return [];
  switch (kind) {
    case 'night_move':
      return [
        { bot: 'Leo', after: 1000, intent: () => ({ kind: 'seatbelt', target: 'none' }) },
        { bot: 'Mia', after: 1500, intent: () => ({ kind: 'move', to: 'stay' }) },
        { bot: 'Ravi', after: 2000, intent: () => ({ kind: 'move', to: '4C' }) },
        { bot: 'Sam', after: 2500, intent: () => ({ kind: 'move', to: 'stay' }) },
        { bot: 'Nora', after: 3000, intent: () => ({ kind: 'move', to: 'Aisle 1' }) },
      ];
    case 'night_act':
      return [
        // (She boarded with it already there: tonight she only checks on it.)
        { bot: 'Mia', after: 1200, intent: () => act({ kind: 'search' }) },
        { bot: 'Ravi', after: 1800, intent: () => act({ kind: 'sweep' }) },
        { bot: 'Nora', after: 2400, intent: () => act({ kind: 'check', side: 'left' }) },
        { bot: 'Leo', after: 3000, intent: () => act({ kind: 'watch', startRow: 2 }) },
        { bot: 'Sam', after: 3600, intent: () => act(null) },
      ];
    case 'day_discuss':
      return [
        { bot: 'Ravi', after: 2500, say: { channel: 'cabin', text: 'I’m the Investigator. I swept the seats around 4C last night, and there’s a bomb under 3C!' } },
        { bot: 'Leo', after: 7000, say: { channel: 'pa', text: 'Flight deck here. My cameras caught Mia bending down under her seat last night.' } },
        { bot: 'Mia', after: 11_000, say: { channel: 'cabin', text: 'I only sat down there! I never touched anything.' } },
        { bot: 'Sam', after: 15_000, say: { channel: 'cabin', text: 'Mia hasn’t left 3C since takeoff.' } },
        ...(['Mia', 'Ravi', 'Sam', 'Nora', 'Leo'] as const).map((bot, i) => ({ bot, after: 17_000 + i * 300, intent: () => ({ kind: 'ready' }) as Intent })),
      ];
    case 'day_vote':
      return [
        { bot: 'Ravi', after: 1500, intent: (ids) => ({ kind: 'vote', target: ids('Mia') }) },
        { bot: 'Sam', after: 2100, intent: (ids) => ({ kind: 'vote', target: ids('Mia') }) },
        { bot: 'Nora', after: 2700, intent: (ids) => ({ kind: 'vote', target: ids('Mia') }) },
        { bot: 'Leo', after: 3300, intent: (ids) => ({ kind: 'vote', target: ids('Mia') }) },
        { bot: 'Mia', after: 3900, intent: (ids) => ({ kind: 'vote', target: ids('Ravi') }) },
      ];
    default:
      return [];
  }
}

/** Phases the tutorial waits in for you (the host keeps their clocks from running out). */
export const TUTORIAL_WAITS: ReadonlySet<PhaseKind> = new Set(['packing', 'night_move', 'night_act', 'day_discuss', 'day_vote']);

export interface CoachStep {
  title: string;
  text: string;
}

/** What the coach says right now (null for nothing to say: a spectator, say). */
export function tutorialCoach(game: PlayerView | null): CoachStep | null {
  if (!game) {
    return { title: 'Welcome to Flight School', text: 'The five other passengers are bots, here to show you the ropes. Press Close doors & take off when you are ready.' };
  }
  const you = game.you;
  if (!you) return null;
  const mine = game.mine;
  const kind = game.phase.kind;
  const night = game.phase.night;
  switch (kind) {
    case 'packing':
      return you.packed
        ? { title: 'Packed', text: 'Waiting for the others to pack.' }
        : { title: 'Pack your carry-on', text: 'Put the Pocket flashlight in your bag (up to three items), then press Done packing.' };
    case 'boarding':
      return { title: 'Your secret role', text: 'Your boarding pass says you are a Passenger. Somewhere on board is a Bomber: find them before the plane lands.' };
    case 'takeoff':
      return { title: 'Takeoff', text: 'Every flight goes night, day and vote, over and over until it lands.' };
    case 'night_move':
      if (mine?.move != null) return { title: 'Lights out', text: 'Everyone is changing seats. Yours is set.' };
      return {
        title: 'Lights out',
        text: 'At night anyone can change seats. Stay where you are tonight: Mia, in 3C right next to you, is worth keeping an eye on. Use your screen and choose to stay.',
      };
    case 'night_act': {
      const flashed = you.usedItems.includes('flashlight');
      if (mine?.acted) return { title: 'In the dark', text: 'Done for tonight. Wait for the morning.' };
      if (!flashed && you.items.includes('flashlight') && you.seat === TUTORIAL_YOU.seat) {
        return {
          title: 'In the dark',
          text: 'Everyone acts in the dark now. Mia just bent down under her seat… Shine your Pocket flashlight under 3C: it does not use up your night.',
        };
      }
      return {
        title: 'In the dark',
        text: flashed
          ? 'Your flashlight found something under 3C! Now finish your night: look under your own seat, or rest.'
          : 'Everyone acts in the dark now. As a Passenger, you can look under your own seat, or rest.',
      };
    }
    case 'dawn':
      return { title: 'Morning', text: 'The morning report shows what happened overnight.' };
    case 'day_discuss': {
      const spoke = game.chat.some((m) => m.from === you.id && m.channel === 'cabin');
      if (!spoke) {
        return {
          title: 'Talk it over',
          text: 'Tell the cabin what you found. Open the chat and say something like “My flashlight found a bomb under Mia’s seat!”',
        };
      }
      return mine?.ready
        ? { title: 'Talk it over', text: 'Waiting for everyone to be ready to vote.' }
        : { title: 'Talk it over', text: 'Heard enough? Press Ready to vote.' };
    }
    case 'day_vote':
      return mine?.vote
        ? { title: 'The vote', text: 'Your vote is in.' }
        : { title: 'The vote', text: 'Restrain the passenger you think is the Bomber: open the vote and pick Mia.' };
    case 'verdict':
      return { title: 'The verdict', text: 'Mia was the Bomber! With every saboteur restrained, the passengers win.' };
    case 'ended':
      return {
        title: game.result?.winner === you.team ? 'You graduated!' : 'Flight over',
        text: 'Open the Flight recorder on the end screen to watch the whole flight again. Then book a real flight from the Terminal, or board a friend’s.',
      };
    default:
      return night > 1 ? { title: 'Flight School', text: 'Keep playing: find the Bomber before the plane lands.' } : null;
  }
}
