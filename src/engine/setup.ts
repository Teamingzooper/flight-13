import { destinationOf } from './destinations';
import { COCKPIT, aisleSpot, allSeats } from './grid';
import { PLANES, rowsFor } from './planes';
import { nextFloat, shuffle, type RngHolder } from './rng';
import { giveRole, isPilot, isSaboteur, isStewardess, presetCards, validateCards } from './roles';
import { customCards, isCustomRole, roleInfo } from './custom';
import { newMeal } from './meal';
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
  /** A player who picked their own role (the host); if it cannot be done this flight, they get a random one. */
  chosen?: { player: string; role: RoleId };
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
    drowsy: {},
    mirrors: {},
    flashlights: {},
    freed: {},
    defused: {},
    washroom: null,
    jumpseats: {},
    roughair: {},
    courses: {},
    jumpseat: null,
  };
}

export function emptyDay(): DayChoices {
  return { ready: {}, votes: {}, doubled: {} };
}

export function cardsForGame(settings: Settings, players: number): Cards {
  return settings.rolesMode === 'auto' ? presetCards(players) : settings.cards;
}

/** The host's own roles in play this flight (only when they choose the roles). */
export function customInDeck(settings: Settings): Settings['customRoles'] {
  return settings.rolesMode === 'custom' ? (settings.customRoles ?? []).filter((r) => r.count > 0) : [];
}

/** `custom`: the host's own cards (custom role ids), dealt in place of Passengers. */
export function dealRoles(h: RngHolder, cards: Cards, players: number, rogueChance: number, pilotRogueChance = 0, custom: readonly RoleId[] = []): RoleId[] {
  const deck: RoleId[] = [...custom];
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
  const least = Math.max(MIN_PLAYERS, PLANES[settings.plane].minPlayers);
  if (players.length < least) return `Need at least ${least} passengers to take off${least > MIN_PLAYERS ? ` in the ${PLANES[settings.plane].name.toLowerCase()}` : ''}.`;
  if (players.length > settings.maxPassengers) return 'More passengers than seats booked.';
  if (new Set(players.map((p) => p.id)).size !== players.length) return 'Duplicate passenger ids.';
  return validateCards(cardsForGame(settings, players.length), players.length, settings.stewardessRogueChance, customInDeck(settings));
}

export function createGame(opts: CreateGameOptions): GameState {
  const { settings, players, seed, now } = opts;
  const error = checkTakeoff(settings, players);
  if (error) throw new Error(error);
  const destination = destinationOf(settings);
  const rows = rowsFor(settings.maxPassengers, settings.plane);
  const cols = [...PLANES[settings.plane].cols];
  const s: GameState = {
    v: 1,
    id: `${Math.floor(now).toString(36)}-${(seed >>> 0).toString(36)}`,
    rng: seed | 0,
    settings: structuredClone(settings),
    nights: destination.nights,
    players: [],
    cabin: { rows, cols, cartRow: 1, cartDestroyed: false, lavatoryDestroyed: false, scorched: [] },
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
    recorder: [],
    meal: settings.mealService ? newMeal(destination.nights) : null,
  };
  let roles = dealRoles(
    s,
    cardsForGame(settings, players.length),
    players.length,
    settings.stewardessRogueChance,
    settings.pilotRogueChance,
    customCards(settings),
  );
  // The host may have picked their own role: they get it, out of the same deck (see giveRole).
  // (A role of the host's own that is no longer in this flight's deck cannot be picked: deal at random.)
  const chosen = opts.chosen && (!isCustomRole(opts.chosen.role) || customCards(settings).includes(opts.chosen.role)) ? opts.chosen : undefined;
  const chooser = chosen ? players.findIndex((p) => p.id === chosen.player) : -1;
  const refused = chosen && chooser >= 0 ? giveRole(roles, chooser, chosen.role) : null;
  if (Array.isArray(refused)) roles = refused;
  const seats = shuffle(s, allSeats(rows, cols));
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
    bombsPlanted: 0,
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
    roughAirUsed: false,
    courseUsed: false,
    knockedOutNight: null,
    abilityUses: 0,
  }));
  for (const p of s.players) s.stats[p.id] = { kills: 0, rescues: 0, found: 0, defused: 0 };
  if (chosen && typeof refused === 'string') {
    addLog(s, now, [chosen.player], 'info', `You could not be the ${roleInfo(chosen.role, settings).name} this flight (${refused}), so your role was dealt at random.`);
  }
  return s;
}

/** The doors close behind the last passenger: the takeoff roll starts. */
export function clearedForTakeoff(s: GameState, now: number): void {
  const destination = destinationOf(s.settings);
  addLog(s, now, 'all', 'takeoff', `Flight 13 to ${destination.city} is cleared for takeoff. ${s.nights} nights until landing.`);
}
