import type { Cards, RoleId, SpecialCard, Team } from './types';

export interface RoleInfo {
  id: RoleId;
  name: string;
  team: Team;
  /** One line for the boarding pass. */
  blurb: string;
  /** How the ability works, for the Action tab. */
  howTo: string;
}

export const ROLES: Record<RoleId, RoleInfo> = {
  passenger: {
    id: 'passenger',
    name: 'Passenger',
    team: 'passengers',
    blurb: 'An ordinary traveller with sharp eyes.',
    howTo:
      'No special ability, but at night you can look under your seat for anything left behind, and once per flight you can hide in the washroom for the night. Change seats, watch closely, argue, and vote.',
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
    howTo: "Plant bombs just like a Bomber (one for every three nights of the flight), but hidden so well that the Stewardess's checks miss them.",
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
  return { ...emptyCards(), bomber: 3, mastermind: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 2, marshal: 1 };
}

export function countSpecials(cards: Cards): number {
  return SPECIAL_CARDS.reduce((n, card) => n + cards[card], 0);
}

/** Largest possible saboteur count if every stewardess card turns rogue. */
export function maxSaboteurs(cards: Cards, rogueChance: number): number {
  return cards.bomber + cards.mastermind + (rogueChance > 0 ? cards.stewardess : 0);
}

export function validateCards(cards: Cards, players: number, rogueChance: number): string | null {
  for (const card of SPECIAL_CARDS) {
    const count = cards[card];
    if (!Number.isInteger(count) || count < 0) return `Invalid number of ${card} cards.`;
  }
  if (cards.bomber + cards.mastermind < 1) return 'Add at least one Bomber or Mastermind.';
  if (countSpecials(cards) > players) return `Too many special roles for ${players} passengers.`;
  if (cards.pilot > 1) return 'Only one Pilot fits on the flight deck.';
  if (maxSaboteurs(cards, rogueChance) * 2 >= players) {
    return 'Too many possible saboteurs: they must start as a minority.';
  }
  return null;
}
