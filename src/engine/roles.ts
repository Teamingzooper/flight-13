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
    howTo: 'No special ability, but at night you can look under your seat for anything left behind. Change seats, watch closely, argue, and vote.',
  },
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    team: 'passengers',
    blurb: 'Off duty, but the cockpit still takes your calls.',
    howTo:
      'While the lights are out, turn on the seatbelt sign for one passenger. They cannot move or use an ability that night. You cannot pick the same passenger two nights in a row.',
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
    blurb: 'Crew uniform, crew loyalties. Every drink is a chance to size someone up.',
    howTo: 'Each night, serve a drink to anyone and learn which team they are on. The cart rolls to their row.',
  },
  bomber: {
    id: 'bomber',
    name: 'Bomber',
    team: 'saboteurs',
    blurb: 'One bomb. Make it count.',
    howTo:
      'Once per game, plant a bomb under your seat, on the drink cart (from an aisle seat next to it) or in the lavatory (from a seat next to it). It goes off at the end of tomorrow night or the night after, and everyone within 2 seats is caught in the blast.',
  },
  mastermind: {
    id: 'mastermind',
    name: 'Mastermind',
    team: 'saboteurs',
    blurb: 'Planned all of this. Looks completely harmless.',
    howTo: 'Plant one bomb per game, just like a Bomber. The Stewardess sees you as a Passenger.',
  },
  stewardess_rogue: {
    id: 'stewardess_rogue',
    name: 'Rogue Stewardess',
    team: 'saboteurs',
    blurb: 'Crew uniform, saboteur loyalties.',
    howTo:
      'Each night, serve someone a poisoned drink. They fall sick at dawn and die the next dawn unless the Nurse treats them. The cart rolls to their row.',
  },
};

export const SPECIAL_CARDS: readonly SpecialCard[] = ['bomber', 'mastermind', 'stewardess', 'pilot', 'nurse', 'investigator', 'marshal'];

export function teamOf(role: RoleId): Team {
  return ROLES[role].team;
}

/** What the Stewardess learns: the Mastermind passes as a passenger. */
export function apparentTeam(role: RoleId): Team {
  return role === 'mastermind' ? 'passengers' : teamOf(role);
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
  if (maxSaboteurs(cards, rogueChance) * 2 >= players) {
    return 'Too many possible saboteurs: they must start as a minority.';
  }
  return null;
}
