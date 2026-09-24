import { DESTINATION_ORDER, planeLands, type ItemId, type PlayerStats, type PlayerView, type Team } from '../engine';

/** What a finished game (and your history) says about you. */
export interface AchievementContext {
  view: PlayerView;
  won: boolean;
  team: Team;
  /** Your kills, rescues, finds and defusals this game. */
  mine: PlayerStats | null;
  /** Flights finished, this one included. */
  flights: number;
  /** Destinations reached so far, this one included. */
  landed: readonly string[];
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  /** The item it unlocks. */
  reward: ItemId;
  check: (c: AchievementContext) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first_flight', name: 'Wheels down', description: 'Finish your first flight.', reward: 'antidote', check: () => true },
  { id: 'passenger_win', name: 'Case closed', description: 'Win on the passenger team.', reward: 'defuser', check: (c) => c.won && c.team === 'passengers' },
  { id: 'saboteur_win', name: 'Mile-high mischief', description: 'Win on the saboteur team.', reward: 'pills', check: (c) => c.won && c.team === 'saboteurs' },
  {
    id: 'made_it',
    name: 'Made it',
    description: 'Be alive when the plane lands.',
    reward: 'mirror',
    check: (c) => c.view.you?.status === 'alive' && !!c.view.result && planeLands(c.view.result),
  },
  { id: 'sharp_eyes', name: 'Sharp eyes', description: 'Find a bomb.', reward: 'flashlight', check: (c) => (c.mine?.found ?? 0) > 0 },
  { id: 'bomb_squad', name: 'Bomb squad', description: 'Defuse a bomb.', reward: 'defuser', check: (c) => (c.mine?.defused ?? 0) > 0 },
  { id: 'guardian_angel', name: 'Guardian angel', description: 'Save a life as the Nurse.', reward: 'pillow', check: (c) => (c.mine?.rescues ?? 0) > 0 },
  {
    id: 'escape_artist',
    name: 'Escape artist',
    description: "Pick the Air Marshal's handcuffs.",
    reward: 'bobbypin',
    check: (c) => c.view.you?.usedItems.includes('bobbypin') ?? false,
  },
  { id: 'frequent_flyer', name: 'Frequent flyer', description: 'Finish 10 flights.', reward: 'ffcard', check: (c) => c.flights >= 10 },
  {
    id: 'globetrotter',
    name: 'Globetrotter',
    description: 'Land in all five destinations.',
    reward: 'extender',
    check: (c) => DESTINATION_ORDER.every((d) => c.landed.includes(d)),
  },
];
