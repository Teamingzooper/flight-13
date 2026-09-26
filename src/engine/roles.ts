import type { Cards, CustomRole, CustomRoleId, RoleId, SpecialCard, Team } from './types';

export interface RoleInfo {
  id: RoleId;
  name: string;
  team: Team;
  /** One line for the boarding pass. */
  blurb: string;
  /** How the ability works, for the Action tab. */
  howTo: string;
}

/** Stand-ins for the host's own roles (their names and how-tos come from the settings: see custom.ts). */
function customStandIn(id: CustomRoleId): RoleInfo {
  return {
    id,
    name: 'Custom role',
    team: id.startsWith('custom_s') ? 'saboteurs' : 'passengers',
    blurb: 'A role made up for this flight.',
    howTo: 'A role made up for this flight: see the flight rules.',
  };
}

export const ROLES: Record<RoleId, RoleInfo> = {
  passenger: {
    id: 'passenger',
    name: 'Passenger',
    team: 'passengers',
    blurb: 'An ordinary traveller with sharp eyes.',
    howTo:
      'An ordinary passenger: at night you can look under your seat for anything left behind, and once per flight you can hide in the washroom for the night. Change seats, watch closely, argue, and vote.',
  },
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    team: 'passengers',
    blurb: 'Your plane. Fly everyone home.',
    howTo:
      'You fly from the flight deck: bombs, handcuffs and the Nurse cannot reach you, and everyone knows who you are. Every night, turn on the seatbelt sign for one passenger, call someone up to the jump seat (safe for the night, but a saboteur up there can knock you out), and watch three rows on the cabin cameras. Once per flight, fly through rough air to buckle three rows in, and change course to land a night later (or sooner). By day, talk to the whole plane over the PA.',
  },
  nurse: {
    id: 'nurse',
    name: 'Nurse',
    team: 'passengers',
    blurb: 'Keeps people alive at 35,000 feet.',
    howTo:
      'Each night, treat someone within 1 seat of you (diagonals count; across the aisle does not). They cannot die tonight and any poison is cured. You can treat yourself once.',
  },
  investigator: {
    id: 'investigator',
    name: 'Investigator',
    team: 'passengers',
    blurb: 'Trained to find what should not be on a plane.',
    howTo:
      'Each night, sweep the seats within 1 of you for bombs, or inspect the drink cart or the lavatory if you are sitting next to it.',
  },
  marshal: {
    id: 'marshal',
    name: 'Air Marshal',
    team: 'passengers',
    blurb: 'Undercover, with exactly one pair of handcuffs.',
    howTo:
      'Once per game, while the lights are out, handcuff someone within 2 seats of you. They cannot act that night and are walked to the rear galley at dawn. Cuff a fellow passenger and the passengers lose a player.',
  },
  stewardess_loyal: {
    id: 'stewardess_loyal',
    name: 'Loyal Stewardess',
    team: 'passengers',
    blurb: 'Crew uniform, crew loyalties. You know every row by heart.',
    howTo:
      'You work the aisle, not a seat, and everyone can see you. Each night, walk the drink cart to any row, then check under the three seats on its left or its right for bombs. Nobody can walk past your cart.',
  },
  bomber: {
    id: 'bomber',
    name: 'Bomber',
    team: 'saboteurs',
    blurb: 'A bomb for every three nights. Make them count.',
    howTo:
      'You carry one bomb for every three nights of the flight, and plant at most one a night: under your seat, on the drink cart (from an aisle seat next to it) or in the lavatory (from a seat next to it). Each goes off at the end of tomorrow night or the night after, and everyone within 2 seats is caught in the blast.',
  },
  mastermind: {
    id: 'mastermind',
    name: 'Mastermind',
    team: 'saboteurs',
    blurb: 'Planned all of this. Looks completely harmless.',
    howTo:
      "Plant bombs just like a Bomber (one for every three nights of the flight), but hidden so well that the Stewardess's checks miss them. Once per flight, instead, take your phone off airplane mode: the Pilot's cabin cameras show nothing but static that night.",
  },
  stewardess_rogue: {
    id: 'stewardess_rogue',
    name: 'Rogue Stewardess',
    team: 'saboteurs',
    blurb: 'Crew uniform, saboteur loyalties.',
    howTo:
      'You work the aisle, not a seat, and everyone can see you. Each night, walk the drink cart to any row, then serve a poisoned drink to someone sitting in it. They fall sick at dawn and die the next dawn unless the Nurse treats them or they wash it out in the lavatory. Nobody can walk past your cart.',
  },
  pilot_rogue: {
    id: 'pilot_rogue',
    name: 'Rogue Pilot',
    team: 'saboteurs',
    blurb: 'Your plane. Their rules.',
    howTo:
      'Everything the Pilot can do, for the saboteurs. Buckle in whoever gets close, call passengers up to the jump seat so they cannot use their abilities, feed the camera footage to your team, and take the shortcut: land a night early while the saboteurs are still free. Everyone thinks you are on their side.',
  },
  custom_p1: customStandIn('custom_p1'),
  custom_p2: customStandIn('custom_p2'),
  custom_p3: customStandIn('custom_p3'),
  custom_s1: customStandIn('custom_s1'),
  custom_s2: customStandIn('custom_s2'),
  custom_s3: customStandIn('custom_s3'),
};

export const SPECIAL_CARDS: readonly SpecialCard[] = ['bomber', 'mastermind', 'stewardess', 'pilot', 'nurse', 'investigator', 'marshal'];

export function teamOf(role: RoleId): Team {
  return ROLES[role].team;
}

export function isSaboteur(role: RoleId): boolean {
  return teamOf(role) === 'saboteurs';
}

export function canPlantBombs(role: RoleId): boolean {
  return role === 'bomber' || role === 'mastermind';
}

export function canCuff(role: RoleId): boolean {
  return role === 'marshal';
}

export function isPilot(role: RoleId): boolean {
  return role === 'pilot' || role === 'pilot_rogue';
}

export function isStewardess(role: RoleId): boolean {
  return role === 'stewardess_loyal' || role === 'stewardess_rogue';
}

export function emptyCards(): Cards {
  return { bomber: 0, mastermind: 0, stewardess: 0, pilot: 0, nurse: 0, investigator: 0, marshal: 0 };
}

/** Balanced special cards for a player count; everyone else is a Passenger. */
export function presetCards(players: number): Cards {
  if (players <= 4) return { ...emptyCards(), bomber: 1, pilot: 1, nurse: 1 };
  if (players <= 6) return { ...emptyCards(), bomber: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 1 };
  if (players <= 9) return { ...emptyCards(), bomber: 2, stewardess: 1, pilot: 1, nurse: 1, investigator: 1 };
  if (players <= 12) return { ...emptyCards(), bomber: 2, mastermind: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 1, marshal: 1 };
  if (players <= 16) return { ...emptyCards(), bomber: 3, mastermind: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 2, marshal: 1 };
  // The jumbo: more of everyone.
  if (players <= 20) return { ...emptyCards(), bomber: 3, mastermind: 1, stewardess: 1, pilot: 1, nurse: 2, investigator: 2, marshal: 1 };
  return { ...emptyCards(), bomber: 4, mastermind: 1, stewardess: 1, pilot: 1, nurse: 2, investigator: 2, marshal: 2 };
}

export function countSpecials(cards: Cards): number {
  return SPECIAL_CARDS.reduce((n, card) => n + cards[card], 0);
}

/** Largest possible saboteur count if every stewardess card turns rogue. */
export function maxSaboteurs(cards: Cards, rogueChance: number): number {
  return cards.bomber + cards.mastermind + (rogueChance > 0 ? cards.stewardess : 0);
}

/** `custom`: the host's own roles in the deck (each dealt `count` times). */
export function validateCards(cards: Cards, players: number, rogueChance: number, custom: readonly CustomRole[] = []): string | null {
  for (const card of SPECIAL_CARDS) {
    const count = cards[card];
    if (!Number.isInteger(count) || count < 0) return `Invalid number of ${card} cards.`;
  }
  const customCount = custom.reduce((n, r) => n + r.count, 0);
  const customSaboteurs = custom.filter((r) => r.team === 'saboteurs').reduce((n, r) => n + r.count, 0);
  if (cards.bomber + cards.mastermind + customSaboteurs < 1) return 'Add at least one saboteur: a Bomber, a Mastermind, or a saboteur role of your own.';
  if (countSpecials(cards) + customCount > players) return `Too many special roles for ${players} passengers.`;
  if (cards.pilot > 1) return 'Only one Pilot fits on the flight deck.';
  if ((maxSaboteurs(cards, rogueChance) + customSaboteurs) * 2 >= players) {
    return 'Too many possible saboteurs: they must start as a minority.';
  }
  return null;
}

export function isRoleId(id: unknown): id is RoleId {
  return typeof id === 'string' && Object.hasOwn(ROLES, id);
}

/**
 * Hand one player the role they asked for (the host choosing theirs) out of a dealt deck: swapped with whoever drew
 * it, or else made out of another card, so the teams keep their size. A saboteur role comes out of a Bomber's or the
 * Mastermind's card and a passengers' role out of a Passenger's. A rogue (or loyal) Stewardess or Pilot turns the one
 * that was dealt, as long as the saboteurs stay outnumbered. Returns the new deck, or why it cannot be done.
 */
export function giveRole(roles: readonly RoleId[], who: number, wanted: RoleId): RoleId[] | string {
  const out = [...roles];
  const swapInto = (k: number) => {
    [out[who], out[k]] = [out[k], out[who]];
    return out;
  };
  const dealt = out.indexOf(wanted);
  if (dealt >= 0) return swapInto(dealt);
  const outnumbered = (deck: readonly RoleId[]) => deck.filter(isSaboteur).length * 2 < deck.length;
  const find = (...kinds: RoleId[]) => {
    for (const kind of kinds) {
      const k = out.indexOf(kind);
      if (k >= 0) return k;
    }
    return -1;
  };
  let k: number;
  switch (wanted) {
    case 'pilot':
    case 'pilot_rogue':
      // One Pilot to a plane: the dealt one changes sides, or a Passenger's card becomes the Pilot's.
      k = find(wanted === 'pilot' ? 'pilot_rogue' : 'pilot', 'passenger');
      break;
    case 'stewardess_rogue': {
      // The loyal Stewardess turns, if the saboteurs stay outnumbered; otherwise a Bomber's card becomes hers.
      const loyal = find('stewardess_loyal');
      const turned = [...out];
      if (loyal >= 0) turned[loyal] = wanted;
      k = loyal >= 0 && outnumbered(turned) ? loyal : find('bomber', 'mastermind');
      break;
    }
    case 'stewardess_loyal':
      k = find('stewardess_rogue', 'passenger');
      break;
    case 'bomber':
    case 'mastermind':
      k = find(wanted === 'bomber' ? 'mastermind' : 'bomber', 'stewardess_rogue');
      break;
    case 'passenger':
      k = find('marshal', 'investigator', 'nurse', 'stewardess_loyal');
      break;
    default:
      // (The host's own saboteur roles come out of a Bomber's card; their passenger roles, like the others, a Passenger's.)
      k = wanted.startsWith('custom_s') ? find('bomber', 'mastermind') : find('passenger', 'marshal', 'investigator', 'nurse', 'stewardess_loyal');
  }
  if (k < 0) return `there is no card on this flight that could become the ${ROLES[wanted].name}`;
  out[k] = wanted;
  if (!outnumbered(out)) return `a ${ROLES[wanted].name} would leave the saboteurs too strong for this many passengers`;
  return swapInto(k);
}
