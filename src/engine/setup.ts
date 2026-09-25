import { DESTINATIONS } from './destinations';
import { COCKPIT, aisleSpot, allSeats, rowsFor } from './grid';
import { nextFloat, shuffle, type RngHolder } from './rng';
import { isPilot, isSaboteur, isStewardess, presetCards, validateCards } from './roles';
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
  return {
    moves: {},
    seatbelts: {},
    actions: {},
    buckled: {},
    anomaly: null,
    searched: {},
    asleep: {},
    mirrors: {},
    flashlights: {},
    freed: {},
    defused: {},
    washroom: null,
  };
}

export function emptyDay(): DayChoices {
  return { ready: {}, votes: {}, doubled: {} };
}

export function cardsForGame(settings: Settings, players: number): Cards {
  return settings.rolesMode === 'auto' ? presetCards(players) : settings.cards;
}

export function dealRoles(h: RngHolder, cards: Cards, players: number, rogueChance: number, pilotRogueChance = 0): RoleId[] {
  const deck: RoleId[] = [];
  const add = (role: RoleId, count: number) => {
    for (let i = 0; i < count; i++) deck.push(role);
  };
  add('bomber', cards.bomber);
  add('mastermind', cards.mastermind);
  add('nurse', cards.nurse);
  add('investigator', cards.investigator);
  add('marshal', cards.marshal);
  for (let i = 0; i < cards.stewardess; i++) {
    deck.push(nextFloat(h) < rogueChance ? 'stewardess_rogue' : 'stewardess_loyal');
  }
  // The Pilot only turns rogue while the saboteurs would still be outnumbered.
  for (let i = 0; i < cards.pilot; i++) {
    const saboteurs = deck.filter(isSaboteur).length;
    const rogue = pilotRogueChance > 0 && nextFloat(h) < pilotRogueChance && (saboteurs + 1) * 2 < players;
    deck.push(rogue ? 'pilot_rogue' : 'pilot');
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
    id: `${Math.floor(now).toString(36)}-${(seed >>> 0).toString(36)}`,
    rng: seed | 0,
    settings: structuredClone(settings),
    nights: destination.nights,
    players: [],
    cabin: { rows, cartRow: 1, cartDestroyed: false, lavatoryDestroyed: false, scorched: [] },
    bombs: [],
    phase: { kind: 'packing', night: 0, startedAt: now, endsAt: now + phaseDurationMs(settings, 'packing'), earlyEndAt: null },
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
    packed: {},
    stats: {},
    awards: null,
  };
  const roles = dealRoles(s, cardsForGame(settings, players.length), players.length, settings.stewardessRogueChance, settings.pilotRogueChance);
  const seats = shuffle(s, allSeats(rows));
  // Crew work the aisle instead of sitting: the first starts at the front with the cart, the rest spread out behind.
  const crew = roles.filter(isStewardess).length;
  let crewPlaced = 0;
  const placeFor = (role: RoleId) => {
    if (isPilot(role)) return COCKPIT;
    if (!isStewardess(role)) return seats.pop()!;
    const row = crew === 1 ? 1 : 1 + Math.round((crewPlaced * (rows - 1)) / (crew - 1));
    crewPlaced++;
    return aisleSpot(row);
  };
  s.players = players.map((np, i) => ({
    id: np.id,
    name: np.name,
    look: { ...np.look },
    role: roles[i],
    status: 'alive',
    seat: placeFor(roles[i]),
    cause: null,
    outNight: null,
    poisonedNight: null,
    bombUsed: false,
    selfTreatUsed: false,
    lastSeatbeltTarget: null,
    revealed: false,
    knownBombIds: [],
    note: '',
    cuffsUsed: false,
    items: [],
    usedItems: [],
    poisonedBy: null,
    washroomUsed: false,
  }));
  for (const p of s.players) s.stats[p.id] = { kills: 0, rescues: 0, found: 0, defused: 0 };
  return s;
}

/** The doors close behind the last passenger: the takeoff roll starts. */
export function clearedForTakeoff(s: GameState, now: number): void {
  const destination = DESTINATIONS[s.settings.destination];
  addLog(s, now, 'all', 'takeoff', `Flight 13 to ${destination.city} is cleared for takeoff. ${destination.nights} nights until landing.`);
}
