import { DESTINATIONS } from './destinations';
import { allSeats, rowsFor } from './grid';
import { nextFloat, shuffle, type RngHolder } from './rng';
import { presetCards, validateCards } from './roles';
import { MIN_PLAYERS, phaseDurationMs, validateSettings } from './settings';
import { addLog } from './state';
import type { Cards, DayChoices, GameState, Look, NightChoices, RoleId, Settings } from './types';

export interface NewPlayer {
  id: string;
  name: string;
  look: Look;
}

export interface CreateGameOptions {
  settings: Settings;
  players: NewPlayer[];
  seed: number;
  now: number;
}

export function emptyNight(): NightChoices {
  return { moves: {}, seatbelts: {}, actions: {}, buckled: {}, anomaly: null };
}

export function emptyDay(): DayChoices {
  return { ready: {}, votes: {} };
}

export function cardsForGame(settings: Settings, players: number): Cards {
  return settings.rolesMode === 'auto' ? presetCards(players) : settings.cards;
}

export function dealRoles(h: RngHolder, cards: Cards, players: number, rogueChance: number): RoleId[] {
  const deck: RoleId[] = [];
  const add = (role: RoleId, count: number) => {
    for (let i = 0; i < count; i++) deck.push(role);
  };
  add('bomber', cards.bomber);
  add('mastermind', cards.mastermind);
  add('pilot', cards.pilot);
  add('nurse', cards.nurse);
  add('investigator', cards.investigator);
  for (let i = 0; i < cards.stewardess; i++) {
    deck.push(nextFloat(h) < rogueChance ? 'stewardess_rogue' : 'stewardess_loyal');
  }
  add('passenger', players - deck.length);
  return shuffle(h, deck);
}

/** An error message, or null when these passengers can take off. */
export function checkTakeoff(settings: Settings, players: NewPlayer[]): string | null {
  const settingsError = validateSettings(settings);
  if (settingsError) return settingsError;
  if (players.length < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} passengers to take off.`;
  if (players.length > settings.maxPassengers) return 'More passengers than seats booked.';
  if (new Set(players.map((p) => p.id)).size !== players.length) return 'Duplicate passenger ids.';
  return validateCards(cardsForGame(settings, players.length), players.length, settings.stewardessRogueChance);
}

export function createGame(opts: CreateGameOptions): GameState {
  const { settings, players, seed, now } = opts;
  const error = checkTakeoff(settings, players);
  if (error) throw new Error(error);
  const destination = DESTINATIONS[settings.destination];
  const rows = rowsFor(settings.maxPassengers);
  const s: GameState = {
    v: 1,
    rng: seed | 0,
    settings: structuredClone(settings),
    nights: destination.nights,
    players: [],
    cabin: { rows, cartRow: 1, cartDestroyed: false, lavatoryDestroyed: false, scorched: [] },
    bombs: [],
    phase: { kind: 'takeoff', night: 0, startedAt: now, endsAt: now + phaseDurationMs(settings, 'takeoff'), earlyEndAt: null },
    night: emptyNight(),
    day: emptyDay(),
    verdict: null,
    incidentAtDawn: false,
    blackoutNight: null,
    chat: [],
    log: [],
    nextId: 1,
    lastChatAt: {},
    result: null,
  };
  const roles = dealRoles(s, cardsForGame(settings, players.length), players.length, settings.stewardessRogueChance);
  const seats = shuffle(s, allSeats(rows)).slice(0, players.length);
  s.players = players.map((np, i) => ({
    id: np.id,
    name: np.name,
    look: { ...np.look },
    role: roles[i],
    status: 'alive',
    seat: seats[i],
    cause: null,
    outNight: null,
    poisonedNight: null,
    bombUsed: false,
    selfTreatUsed: false,
    lastSeatbeltTarget: null,
    revealed: false,
    knownBombIds: [],
  }));
  addLog(s, now, 'all', 'takeoff', `Flight 13 to ${destination.city} is cleared for takeoff. ${destination.nights} nights until landing.`);
  return s;
}
