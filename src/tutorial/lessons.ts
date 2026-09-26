import type { ChatChannel, PhaseKind, PlayerView, RoleId, SeatId } from '../engine';
import { TUTORIAL_BOTS, TUTORIAL_WAITS, act, botName, packingCues, type CoachStep, type Cue, type TutorialBot } from './script';

/**
 * Flight School's lessons, one per role on the safety card. Each is the same short flight with the same five bots,
 * cast differently: you take the lesson's role, and the bot who usually plays it sits in as a Passenger. The bots
 * play their cues; the coach says what to do next. Stray from the script and the flight carries on (in a phase the
 * lesson has no cues for, the bots think for themselves). Pure.
 */

export type LessonId = 'passenger' | 'nurse' | 'stewardess' | 'pilot' | 'bomber';

export const LESSON_ORDER: readonly LessonId[] = ['passenger', 'nurse', 'stewardess', 'pilot', 'bomber'];

export function isLessonId(x: unknown): x is LessonId {
  return typeof x === 'string' && (LESSON_ORDER as readonly string[]).includes(x);
}

interface Place {
  role: RoleId;
  seat: SeatId;
}

export interface Lesson {
  id: LessonId;
  /** The role, as the safety card names it. */
  title: string;
  /** What the lesson teaches, in a line (the safety card's caption). */
  line: string;
  you: Place;
  cast: Record<TutorialBot, Place>;
  /** The Bomber boarded with a bomb already under this seat, set to go off at the end of `night` (null: none). */
  bomb: { seat: SeatId; night: number } | null;
  /** The bots' cues for a phase you are waited for in (null: none; the bots think for themselves). */
  cues(kind: PhaseKind, night: number): Cue[] | null;
  /** What the coach says in this lesson (undefined: the shared step). */
  coach(game: PlayerView): CoachStep | null | undefined;
  /** Your boarding pass, explained. */
  boarding: string;
}

// ---------- Helpers ----------

const does = (bot: TutorialBot, after: number, intent: NonNullable<Cue['intent']>): Cue => ({ bot, after, intent });
const says = (bot: TutorialBot, after: number, text: string, channel: 'cabin' | 'pa' = 'cabin'): Cue => ({ bot, after, say: { channel, text } });
const stays = (bot: TutorialBot, after: number): Cue => does(bot, after, () => ({ kind: 'move', to: 'stay' }));
const readies = (from: number): Cue[] => TUTORIAL_BOTS.map((bot, i) => does(bot, from + i * 300, () => ({ kind: 'ready' })));
/** Every bot but `accused` votes to restrain them; they vote for `back`. */
const votesAgainst = (accused: TutorialBot, back: TutorialBot | 'you'): Cue[] =>
  TUTORIAL_BOTS.map((bot, i) => does(bot, 1500 + i * 600, (ids) => ({ kind: 'vote', target: ids(bot === accused ? back : accused) })));

const botIn = (game: PlayerView, bot: TutorialBot) => game.players.find((p) => p.name === botName(bot));
const spoke = (game: PlayerView, channel: ChatChannel) => game.chat.some((m) => m.from === game.you?.id && m.channel === channel);
const mine = (game: PlayerView) => game.mine;

/** Talk it over, then Ready: the shared shape of every lesson's day, with the lesson's own nudge. */
function talk(game: PlayerView, nudge: string, channel: ChatChannel = 'cabin'): CoachStep {
  if (!spoke(game, channel)) return { title: 'Talk it over', text: nudge };
  return mine(game)?.ready
    ? { title: 'Talk it over', text: 'Waiting for everyone to be ready to vote.' }
    : { title: 'Talk it over', text: 'Heard enough? Press Ready to vote.' };
}

function restrain(game: PlayerView, text: string): CoachStep {
  return mine(game)?.vote ? { title: 'The vote', text: 'Your vote is in.' } : { title: 'The vote', text };
}

const MIA_CAUGHT = 'Mia was the Bomber! With every saboteur restrained, the passengers win.';

// ---------- The lessons ----------

const passenger: Lesson = {
  id: 'passenger',
  title: 'Passenger',
  line: 'Look under seats, watch closely, argue and vote.',
  you: { role: 'passenger', seat: '3B' },
  cast: {
    Mia: { role: 'bomber', seat: '3C' },
    Ravi: { role: 'investigator', seat: '5E' },
    Sam: { role: 'nurse', seat: '2A' },
    Nora: { role: 'stewardess_loyal', seat: 'Aisle 6' },
    Leo: { role: 'pilot', seat: 'Cockpit' },
  },
  bomb: { seat: '3C', night: 2 },
  boarding: 'Your boarding pass says you are a Passenger. Somewhere on board is a Bomber: find them before the plane lands.',
  cues(kind, night) {
    if (night !== 1) return null;
    switch (kind) {
      case 'night_move':
        return [
          does('Leo', 1000, () => ({ kind: 'seatbelt', target: 'none' })),
          stays('Mia', 1500),
          does('Ravi', 2000, () => ({ kind: 'move', to: '4C' })),
          stays('Sam', 2500),
          does('Nora', 3000, () => ({ kind: 'move', to: 'Aisle 1' })),
        ];
      case 'night_act':
        return [
          // (She boarded with it already there: tonight she only checks on it.)
          does('Mia', 1200, () => act({ kind: 'search' })),
          does('Ravi', 1800, () => act({ kind: 'sweep' })),
          does('Nora', 2400, () => act({ kind: 'check', side: 'left' })),
          does('Leo', 3000, () => act({ kind: 'watch', startRow: 2 })),
          does('Sam', 3600, () => act(null)),
        ];
      case 'day_discuss':
        return [
          says('Ravi', 2500, 'I’m the Investigator. I swept the seats around 4C last night, and there’s a bomb under 3C!'),
          says('Leo', 7000, 'Flight deck here. My cameras caught Mia bending down under her seat last night.', 'pa'),
          says('Mia', 11_000, 'I only sat down there! I never touched anything.'),
          says('Sam', 15_000, 'Mia hasn’t left 3C since takeoff.'),
          ...readies(17_000),
        ];
      case 'day_vote':
        return votesAgainst('Mia', 'Ravi');
      default:
        return null;
    }
  },
  coach(game) {
    const you = game.you!;
    const night = game.phase.night;
    if (night !== 1) return undefined;
    switch (game.phase.kind) {
      case 'night_move':
        if (mine(game)?.move != null) return { title: 'Lights out', text: 'Everyone is changing seats. Yours is set.' };
        return {
          title: 'Lights out',
          text: 'At night anyone can change seats. Stay where you are tonight: Mia, in 3C right next to you, is worth keeping an eye on. Use your screen and choose to stay.',
        };
      case 'night_act': {
        const flashed = you.usedItems.includes('flashlight');
        if (mine(game)?.acted) return { title: 'In the dark', text: 'Done for tonight. Wait for the morning.' };
        if (!flashed && you.items.includes('flashlight') && you.seat === '3B') {
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
      case 'day_discuss':
        return talk(game, 'Tell the cabin what you found. Open the chat and say something like “My flashlight found a bomb under Mia’s seat!”');
      case 'day_vote':
        return restrain(game, 'Restrain the passenger you think is the Bomber: open the vote and pick Mia.');
      case 'verdict':
        return { title: 'The verdict', text: MIA_CAUGHT };
      default:
        return undefined;
    }
  },
};

const nurse: Lesson = {
  id: 'nurse',
  title: 'Nurse',
  line: 'Treat a neighbour: they cannot die tonight.',
  you: { role: 'nurse', seat: '6B' },
  cast: {
    Mia: { role: 'bomber', seat: '3C' },
    Ravi: { role: 'investigator', seat: '5B' },
    Sam: { role: 'passenger', seat: '2A' },
    Nora: { role: 'stewardess_loyal', seat: 'Aisle 6' },
    Leo: { role: 'pilot', seat: 'Cockpit' },
  },
  // Tonight's: the Bomber slips away before it goes off.
  bomb: { seat: '3C', night: 1 },
  boarding: 'Your boarding pass says you are the Nurse. Each night you can treat someone within 1 seat of you: whatever happens, they cannot die that night.',
  cues(kind, night) {
    if (night !== 1) return null;
    switch (kind) {
      case 'night_move':
        return [
          does('Leo', 1000, () => ({ kind: 'seatbelt', target: 'none' })),
          does('Mia', 1500, () => ({ kind: 'move', to: '6F' })),
          stays('Ravi', 2000),
          stays('Sam', 2500),
          stays('Nora', 3000),
        ];
      case 'night_act':
        return [
          does('Mia', 1200, () => act(null)),
          does('Ravi', 1800, () => act({ kind: 'sweep' })),
          does('Nora', 2400, () => act({ kind: 'check', side: 'right' })),
          does('Leo', 3000, () => act({ kind: 'watch', startRow: 5 })),
          does('Sam', 3600, () => act(null)),
        ];
      case 'day_discuss':
        return [
          says('Ravi', 2500, 'I was right by that blast, and I’m still here. Somebody treated me last night: thank you!'),
          says('Leo', 7000, 'Flight deck here. That bomb went off under 3C, and Mia was sitting in 3C when we took off.', 'pa'),
          says('Mia', 11_000, 'My seat was broken, so I moved! That’s all.'),
          says('Nora', 15_000, 'Nobody moves away from a seat the very night it blows up by accident.'),
          ...readies(17_000),
        ];
      case 'day_vote':
        return votesAgainst('Mia', 'Ravi');
      default:
        return null;
    }
  },
  coach(game) {
    if (game.phase.night !== 1) return undefined;
    const ravi = botIn(game, 'Ravi');
    switch (game.phase.kind) {
      case 'night_move':
        if (mine(game)?.move != null) return { title: 'Lights out', text: 'Your seat is set. Stay close to Ravi.' };
        return {
          title: 'Lights out',
          text: 'At night anyone can change seats. Stay in 6B tonight: Ravi, right in front of you in 5B, is going to need you. Use your screen and choose to stay.',
        };
      case 'night_act': {
        const action = mine(game)?.action;
        if (action?.kind === 'treat' && action.target === ravi?.id) return { title: 'In the dark', text: 'Ravi is in your care tonight. Wait for the morning.' };
        if (mine(game)?.acted) return { title: 'In the dark', text: 'Done for tonight. Wait for the morning.' };
        return {
          title: 'In the dark',
          text: 'A tip no real flight would give you: a bomb goes off under 3C tonight, and Ravi in 5B is close enough to be caught. Treat Ravi: whatever happens, he cannot die tonight.',
        };
      }
      case 'dawn':
        return ravi?.status === 'alive'
          ? { title: 'Morning', text: 'The bomb under 3C went off. Sam was caught in it, but Ravi pulled through: your treatment kept him alive.' }
          : { title: 'Morning', text: 'The bomb under 3C went off. The morning report shows who it caught.' };
      case 'day_discuss':
        return talk(
          game,
          'Who sat in 3C? Mia did, until she moved away in the dark, just before the bang. Say so in the chat, something like “That bomb was under Mia’s old seat!” (Careful: in a real flight, telling everyone you are the Nurse makes you a target.)',
        );
      case 'day_vote':
        return restrain(game, 'Restrain the Bomber: open the vote and pick Mia.');
      case 'verdict':
        return { title: 'The verdict', text: MIA_CAUGHT };
      default:
        return undefined;
    }
  },
};

const stewardess: Lesson = {
  id: 'stewardess',
  title: 'Stewardess',
  line: 'Walk the drink cart, check under seats.',
  you: { role: 'stewardess_loyal', seat: 'Aisle 6' },
  cast: {
    Mia: { role: 'bomber', seat: '3C' },
    Ravi: { role: 'investigator', seat: '5E' },
    Sam: { role: 'nurse', seat: '2A' },
    Nora: { role: 'passenger', seat: '3B' },
    Leo: { role: 'pilot', seat: 'Cockpit' },
  },
  bomb: { seat: '3C', night: 2 },
  boarding:
    'Your boarding pass says you are the Loyal Stewardess. You work the aisle with the drink cart, not a seat: each night you walk it to any row and check under the seats on one side.',
  cues(kind, night) {
    if (night !== 1) return null;
    switch (kind) {
      case 'night_move':
        return [does('Leo', 1000, () => ({ kind: 'seatbelt', target: 'none' })), stays('Mia', 1500), stays('Ravi', 2000), stays('Sam', 2500), stays('Nora', 3000)];
      case 'night_act':
        return [
          does('Mia', 1200, () => act({ kind: 'search' })),
          does('Ravi', 1800, () => act({ kind: 'sweep' })),
          does('Leo', 2400, () => act({ kind: 'watch', startRow: 2 })),
          does('Sam', 3000, () => act(null)),
          does('Nora', 3600, () => act(null)),
        ];
      case 'day_discuss':
        return [
          says('Leo', 2500, 'Flight deck here. My cameras caught Mia bending down under her seat last night.', 'pa'),
          says('Mia', 6500, 'I dropped my earbuds, that’s all!'),
          says('Ravi', 10_500, 'I swept around 5E last night. Nothing near me.'),
          says('Sam', 14_000, 'Our Stewardess was working row 3. Did you see anything?'),
          ...readies(17_000),
        ];
      case 'day_vote':
        return votesAgainst('Mia', 'Ravi');
      default:
        return null;
    }
  },
  coach(game) {
    if (game.phase.night !== 1) return undefined;
    const found = game.log.some((e) => e.tag === 'check' && /found/.test(e.text));
    switch (game.phase.kind) {
      case 'night_move':
        if (mine(game)?.move === 'Aisle 3') return { title: 'Lights out', text: 'The cart is on its way to row 3.' };
        if (mine(game)?.move != null) return { title: 'Lights out', text: 'Your walk is set. (Row 3 is where Mia sits.)' };
        return { title: 'Lights out', text: 'Everyone can change places now. Walk the drink cart to row 3, where Mia sits: pick Aisle 3 on your screen.' };
      case 'night_act':
        if (mine(game)?.acted) return { title: 'In the dark', text: 'Done for tonight. What your check found shows up in the morning.' };
        return {
          title: 'In the dark',
          text: 'Check under the three seats on one side of your row. Mia is in 3C, on the left of the aisle: check the Left side.',
        };
      case 'dawn':
        return found ? { title: 'Morning', text: 'Your check turned up a bomb under 3C: Mia’s seat.' } : undefined;
      case 'day_discuss':
        return talk(game, 'Tell the cabin what your check found: something like “I checked row 3 last night, and there’s a bomb under 3C!”');
      case 'day_vote':
        return restrain(game, 'Restrain the Bomber: open the vote and pick Mia.');
      case 'verdict':
        return { title: 'The verdict', text: MIA_CAUGHT };
      default:
        return undefined;
    }
  },
};

const pilot: Lesson = {
  id: 'pilot',
  title: 'Pilot',
  line: 'Watch the cabin cameras, talk on the PA.',
  you: { role: 'pilot', seat: 'Cockpit' },
  cast: {
    Mia: { role: 'bomber', seat: '3C' },
    Ravi: { role: 'investigator', seat: '5E' },
    Sam: { role: 'nurse', seat: '2A' },
    Nora: { role: 'stewardess_loyal', seat: 'Aisle 6' },
    Leo: { role: 'passenger', seat: '6A' },
  },
  bomb: { seat: '3C', night: 2 },
  boarding:
    'Your boarding pass says you are the Pilot. You fly from the flight deck, where no bomb can reach you: you watch the cabin on cameras and talk to everyone over the PA.',
  cues(kind, night) {
    if (night !== 1) return null;
    switch (kind) {
      case 'night_move':
        return [stays('Mia', 1000), does('Ravi', 1500, () => ({ kind: 'move', to: '4C' })), stays('Sam', 2000), stays('Nora', 2500), stays('Leo', 3000)];
      case 'night_act':
        return [
          does('Mia', 1200, () => act({ kind: 'search' })),
          does('Ravi', 1800, () => act({ kind: 'sweep' })),
          does('Nora', 2400, () => act({ kind: 'check', side: 'left' })),
          does('Sam', 3000, () => act(null)),
          does('Leo', 3600, () => act(null)),
        ];
      case 'day_discuss':
        return [
          says('Ravi', 4000, 'I’m the Investigator. I swept the seats around 4C last night, and there’s a bomb under 3C!'),
          says('Mia', 9000, 'I only sat down there! I never touched anything.'),
          says('Sam', 13_000, 'Captain, did your cameras catch anything?'),
          ...readies(17_000),
        ];
      case 'day_vote':
        return votesAgainst('Mia', 'Ravi');
      default:
        return null;
    }
  },
  coach(game) {
    if (game.phase.night !== 1) return undefined;
    const sawMia = game.log.some((e) => e.tag === 'watch' && e.text.includes('Mia'));
    switch (game.phase.kind) {
      case 'night_move':
        if (mine(game)?.seatbelt != null) return { title: 'Lights out', text: 'Your calls are in. (The jump seat, rough air and a change of course can wait for a real flight.)' };
        return {
          title: 'Lights out',
          text: 'Each night the seatbelt sign holds one passenger in their seat: they cannot move or do anything all night. You have no suspect yet, so pick No one for the seatbelt sign.',
        };
      case 'night_act':
        if (mine(game)?.acted) return { title: 'In the dark', text: 'The cameras are rolling. At dawn you see what they caught.' };
        return { title: 'In the dark', text: 'Watch three rows on the cabin cameras. Mia boarded in 3C: watch rows 2–4.' };
      case 'dawn':
        return sawMia ? { title: 'Morning', text: 'Your cameras caught Mia bending down under her seat in the night.' } : undefined;
      case 'day_discuss':
        return talk(
          game,
          'Only you can talk to the whole plane at once. Switch the chat to PA (or hold the PA button and speak) and say what your cameras caught Mia doing.',
          'pa',
        );
      case 'day_vote':
        return restrain(game, 'Restrain the Bomber: open the vote and pick Mia.');
      case 'verdict':
        return { title: 'The verdict', text: MIA_CAUGHT };
      default:
        return undefined;
    }
  },
};

const bomber: Lesson = {
  id: 'bomber',
  title: 'Bomber',
  line: 'Plant a bomb, keep your cover.',
  you: { role: 'bomber', seat: '3C' },
  cast: {
    Mia: { role: 'passenger', seat: '3B' },
    Ravi: { role: 'investigator', seat: '5E' },
    Sam: { role: 'nurse', seat: '2A' },
    Nora: { role: 'stewardess_loyal', seat: 'Aisle 6' },
    Leo: { role: 'pilot', seat: 'Cockpit' },
  },
  bomb: null,
  boarding: 'Your boarding pass says you are the Bomber: a saboteur. Plant your bomb, keep your cover, and take the plane.',
  cues(kind, night) {
    if (night === 1) {
      switch (kind) {
        case 'night_move':
          return [does('Leo', 1000, () => ({ kind: 'seatbelt', target: 'none' })), stays('Mia', 1500), stays('Ravi', 2000), stays('Sam', 2500), stays('Nora', 3000)];
        case 'night_act':
          return [
            does('Mia', 1200, () => act({ kind: 'search' })),
            does('Ravi', 1800, () => act({ kind: 'sweep' })),
            does('Nora', 2400, () => act({ kind: 'check', side: 'right' })),
            does('Leo', 3000, () => act({ kind: 'watch', startRow: 5 })),
            does('Sam', 3600, () => act(null)),
          ];
        case 'day_discuss':
          return [
            says('Leo', 2500, 'Flight deck here. My cameras caught Ravi poking around the seats in row 5 last night.', 'pa'),
            says('Ravi', 6500, 'I’m the Investigator! I was sweeping for bombs, and there’s nothing near me.'),
            says('Sam', 10_500, 'That’s exactly what a Bomber would say.'),
            says('Mia', 14_000, 'Ravi was up and about all night. I don’t trust him.'),
            ...readies(17_000),
          ];
        case 'day_vote':
          return votesAgainst('Ravi', 'Mia');
        default:
          return null;
      }
    }
    if (night === 2) {
      switch (kind) {
        case 'night_move':
          // Nora walks the cart right up to your old row.
          return [does('Leo', 1000, () => ({ kind: 'seatbelt', target: 'none' })), stays('Mia', 1500), stays('Sam', 2000), does('Nora', 2500, () => ({ kind: 'move', to: 'Aisle 3' }))];
        case 'night_act':
          return [
            does('Mia', 1200, () => act(null)),
            does('Sam', 1800, () => act(null)),
            does('Nora', 2400, () => act(null)),
            does('Leo', 3000, () => act({ kind: 'watch', startRow: 6 })),
          ];
        default:
          return null;
      }
    }
    return null;
  },
  coach(game) {
    const night = game.phase.night;
    const m = mine(game);
    switch (game.phase.kind) {
      case 'night_move':
        if (night === 1) {
          if (m?.move != null) return { title: 'Lights out', text: 'Your seat is set.' };
          return { title: 'Lights out', text: 'Stay in 3C tonight: your bomb goes under your own seat. Use your screen and choose to stay.' };
        }
        if (night === 2) {
          if (m?.move != null && m.move !== 'stay') return { title: 'Lights out', text: 'You are clear of the blast. Now wait for it.' };
          return {
            title: 'Get clear',
            text: 'Your bomb goes off at the end of tonight, and it catches everyone within 2 seats of 3C: you too. Change seats to one in row 6.',
          };
        }
        return undefined;
      case 'night_act':
        if (night === 1) {
          if (m?.action?.kind === 'plant') return { title: 'In the dark', text: 'Planted. Now act normal.' };
          if (m?.acted) return { title: 'In the dark', text: 'Done for tonight. (Your bomb is still in your bag: plant it tomorrow night.)' };
          return {
            title: 'In the dark',
            text: 'Plant your bomb under your seat, set for tomorrow night. (On the cabin cameras, planting looks just like looking under your seat.)',
          };
        }
        if (night === 2) {
          return m?.acted
            ? { title: 'In the dark', text: 'Wait for the bang.' }
            : { title: 'In the dark', text: 'You only had the one bomb. Rest (press Done) and wait for the bang.' };
        }
        return undefined;
      case 'dawn':
        return night === 1 ? { title: 'Morning', text: 'A quiet night, as far as anyone knows. Nobody noticed a thing.' } : undefined;
      case 'day_discuss':
        if (night !== 1) return undefined;
        return talk(game, 'Nobody suspects you. Keep it that way: the cameras caught Ravi out of his seat, so point at him. Say something like “I saw Ravi up and about last night.”');
      case 'day_vote':
        if (night !== 1) return undefined;
        return restrain(game, 'Ravi says he is the Investigator. If he is, he is the one most likely to find your bomb: vote to restrain him.');
      case 'verdict':
        if (night !== 1) return undefined;
        return { title: 'The verdict', text: 'Ravi really was the Investigator: the passengers just locked up one of their own. Your bomb is still ticking.' };
      default:
        return undefined;
    }
  },
};

export const LESSONS: Record<LessonId, Lesson> = { passenger, nurse, stewardess, pilot, bomber };

/** A lesson by id (a flight saved before there were lessons is the Passenger's). */
export function lessonOf(id: LessonId | null | undefined): Lesson {
  return LESSONS[id ?? 'passenger'] ?? passenger;
}

/**
 * What the bots do in a phase of a lesson: everyone packs, then the lesson's script. Null in a phase you are waited
 * for that the script has nothing for: the bots play it themselves.
 */
export function tutorialCues(lesson: LessonId | undefined, kind: PhaseKind, night: number): Cue[] | null {
  if (kind === 'packing') return packingCues();
  if (!TUTORIAL_WAITS.has(kind)) return [];
  return lessonOf(lesson).cues(kind, night);
}

/** What the coach says right now (null for nothing to say: a spectator, say). */
export function tutorialCoach(game: PlayerView | null, lessonId?: LessonId): CoachStep | null {
  const lesson = lessonOf(lessonId);
  if (!game) {
    return {
      title: 'Welcome to Flight School',
      text: `Today’s lesson: the ${lesson.title}. The five other passengers are bots, here to show you the ropes. Press Close doors & take off when you are ready.`,
    };
  }
  const you = game.you;
  if (!you) return null;
  const own = lesson.coach(game);
  if (own !== undefined) return own;
  switch (game.phase.kind) {
    case 'packing':
      if (you.packed) return { title: 'Packed', text: 'Waiting for the others to pack.' };
      return lesson.id === 'passenger'
        ? { title: 'Pack your carry-on', text: 'Put the Pocket flashlight in your bag (up to three items), then press Done packing.' }
        : { title: 'Pack your carry-on', text: 'Put up to three items from your bag in your carry-on (this lesson needs none), then press Done packing.' };
    case 'boarding':
      return { title: 'Your secret role', text: lesson.boarding };
    case 'takeoff':
      return { title: 'Takeoff', text: 'Every flight goes night, day and vote, over and over until it lands.' };
    case 'dawn':
      return { title: 'Morning', text: 'The morning report shows what happened overnight.' };
    case 'ended': {
      const won = game.result?.winner === you.team;
      const why =
        lesson.id === 'bomber' && won
          ? 'Your blast left the saboteurs outnumbering everyone still in play: the plane is yours. '
          : '';
      return {
        title: won ? 'You graduated!' : 'Flight over',
        text: `${why}Open the Flight recorder on the end screen to watch the whole flight again. Then book a real flight from the Terminal, or board a friend’s.`,
      };
    }
    default:
      return game.phase.night > 1 ? { title: 'Flight School', text: 'Keep playing: the flight goes on until it lands.' } : null;
  }
}
