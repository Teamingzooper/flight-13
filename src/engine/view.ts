import { voteWeight } from './day';
import { isNightPhase, isWhisperPhase, phaseDue } from './engine';
import { WHISPER_RADIUS, distance } from './grid';
import { possibleItemUses, type ItemUse } from './items';
import { usesLeft } from './custom';
import { lunchOpen, tamperReach } from './meal';
import { isPilot, isSaboteur, teamOf } from './roles';
import { checkCourse, checkJumpseat, checkSeatbelt, checkWashroom, flightDeckError, possibleActions, possibleMoves } from './rules';
import { activePlayers, bombsLeft, cellOf, getPlayer, inWashroom, isActive, isGuest } from './state';
import type {
  Award,
  BombLocation,
  Cabin,
  Cell,
  ChatMessage,
  DeathCause,
  Dish,
  GameResult,
  GameState,
  ItemId,
  LogEntry,
  Look,
  MoveTarget,
  NightAction,
  NightRecord,
  PhaseKind,
  PlayerState,
  PlayerStats,
  PlayerStatus,
  RoleId,
  SeatId,
  Settings,
  Team,
  Verdict,
} from './types';

export interface PlayerSummary {
  id: string;
  name: string;
  look: Look;
  seat: SeatId | null;
  status: PlayerStatus;
  cause: DeathCause | null;
  /** The night they left play (dawn deaths and the next day's vote both count as that night), or null. Public. */
  outNight: number | null;
  role: RoleId | null;
  team: Team | null;
}

export interface BombView {
  id: string;
  location: BombLocation;
  detonateNight: number;
  exploded: boolean;
  explodedAt: Cell[] | null;
  plantedNight: number | null;
  planterId: string | null;
  defused: boolean;
}

export interface YouView {
  id: string;
  name: string;
  role: RoleId;
  team: Team;
  status: PlayerStatus;
  seat: SeatId | null;
  poisoned: boolean;
  buckled: 'pilot' | 'turbulence' | 'rough' | null;
  /** Bombs you still carry (Bombers and the Mastermind: one for every three nights of the flight). */
  bombsLeft: number;
  /** A custom role's ability: uses left this flight (null: not a custom role, or every night). */
  usesLeft: number | null;
  selfTreatUsed: boolean;
  lastSeatbeltTarget: string | null;
  /** Your black box note (read out if you die or are restrained). */
  note: string;
  cuffsUsed: boolean;
  /** You looked under your seat tonight. */
  searched: boolean;
  /** Your carry-on: items not used yet, and the ones used up. */
  items: ItemId[];
  usedItems: ItemId[];
  /** You are done packing. */
  packed: boolean;
  /** You already spent your one night in the washroom. */
  washroomUsed: boolean;
  /** You are locked in the lavatory right now. */
  inWashroom: boolean;
  /** Pilot: rough air and a change of course are spent. */
  roughAirUsed: boolean;
  courseUsed: boolean;
  /** Pilot: knocked out cold tonight (no calls, no cameras). */
  knockedOut: boolean;
  /** Mastermind: airplane mode already switched off on this flight. */
  jamUsed: boolean;
  /** In the Air Marshal's handcuffs (a bobby pin can pick them). */
  cuffed: boolean;
  /** Someone slipped you a sleeping pill, or drugged your lunch: you sleep through tonight. */
  asleep: boolean;
  /** Drugged at lunch: asleep all night, from the moment the lights go out (no seat change either). */
  drowsy: boolean;
  /** You are up in the Pilot's jump seat tonight. */
  inJumpSeat: boolean;
}

export interface MineView {
  move: MoveTarget | null;
  seatbelt: string | null;
  /** Pilot: tonight's calls. */
  jumpseat: string | null;
  roughair: number | null;
  course: 'hold' | 'shortcut' | null;
  action: NightAction | null;
  acted: boolean;
  ready: boolean;
  vote: string | null;
}

/** Legal choices for the current phase, computed by the host so the UI never re-implements rules. */
export interface OptionsView {
  /** Seats you can move to (aisle spots for crew): empty, and not past the drink cart. */
  seats: SeatId[];
  /** Why you cannot go to the washroom tonight, or null if you can. */
  washroom: string | null;
  /** Pilot: who can be called up to the jump seat, where rough air can go, and the course changes on offer. */
  jumpseat: string[];
  roughair: number[];
  course: ('hold' | 'shortcut')[];
  seatbelt: string[];
  actions: NightAction[];
  whisper: string[];
  vote: string[];
  /** Carry-on items you can use right now. */
  items: ItemUse[];
}

export interface VotesView {
  counts: Record<string, number>;
  byVoter: Record<string, string> | null;
}

/** Lunch, on the day it is served (orders are public; only saboteurs see their team's tampering). */
export interface MealView {
  day: number;
  /** Orders (and tampering) are open: the discussion of the day lunch is served. */
  open: boolean;
  orders: Record<string, Dish>;
  /** Saboteurs only: your team's go at the food. */
  tamper: { by: string; dish: Dish; row: number } | null;
  /** Where you could drug the food: your row, 'any' row (a rogue Stewardess), or null (you cannot). */
  reach: number | 'any' | null;
}

export interface PhaseView {
  kind: PhaseKind;
  night: number;
  nights: number;
  endsInMs: number;
  earlyEnding: boolean;
}

export interface PlayerView {
  /** Unique per game. */
  gameId: string;
  you: YouView | null;
  phase: PhaseView;
  settings: Settings;
  players: PlayerSummary[];
  cabin: Cabin;
  /** Who is locked in the lavatory right now. */
  washroom: string | null;
  /** Who is up on the flight deck with the Pilot right now. */
  jumpseat: string | null;
  blackout: boolean;
  /** Today ends in a vote (always, unless votes only follow a night when something happened, and nothing did). */
  voteToday: boolean;
  bombs: BombView[];
  mine: MineView | null;
  options: OptionsView | null;
  votes: VotesView | null;
  verdict: Verdict | null;
  chat: ChatMessage[];
  log: LogEntry[];
  result: GameResult | null;
  /** How many passengers are done packing. */
  packing: { done: number; total: number } | null;
  /** Flight credits and what everyone did, once the game is over. */
  awards: Record<string, Award> | null;
  stats: Record<string, PlayerStats> | null;
  /** The flight recorder, once the flight is over (null until then: it holds everyone's secrets). */
  recorder: NightRecord[] | null;
  /** Lunch, on the day it is served (null any other time). */
  meal: MealView | null;
}

const CHAT_IN_VIEW = 150;
const BLACKOUT_PHASES: ReadonlySet<PhaseKind> = new Set(['dawn', 'day_discuss', 'day_vote', 'verdict']);

/** In the Air Marshal's handcuffs: nothing to do but pick the lock, if you packed a bobby pin. */
function cuffedOptions(s: GameState, me: PlayerState): OptionsView {
  const none = 'You are in handcuffs.';
  return { seats: [], washroom: none, jumpseat: [], roughair: [], course: [], seatbelt: [], actions: [], whisper: [], vote: [], items: possibleItemUses(s, me) };
}

function optionsFor(s: GameState, me: PlayerState): OptionsView {
  const kind = s.phase.kind;
  // (Asleep after a drugged lunch is as stuck as buckled in.)
  // (Slipped a sleeping pill tonight: as asleep as drugged, once seats have changed.)
  const drowsy = (isNightPhase(kind) && s.night.drowsy[me.id] !== undefined) || (kind === 'night_act' && s.night.asleep[me.id] !== undefined);
  const buckled = s.night.buckled[me.id] !== undefined || drowsy;
  const others = activePlayers(s).filter((p) => p.id !== me.id);
  // The flight deck's calls, while the Pilot is fit to make them.
  const deck = kind === 'night_move' && isPilot(me.role) && flightDeckError(s, me) === null;
  return {
    seats: kind === 'night_move' && !buckled ? possibleMoves(s, me) : [],
    washroom:
      kind !== 'night_move' ? 'The washroom is for the night.' : drowsy ? 'You are fast asleep.' : buckled ? 'You are buckled in tonight.' : checkWashroom(s, me),
    seatbelt: deck ? others.filter((t) => checkSeatbelt(s, me, t.id) === null).map((t) => t.id) : [],
    jumpseat: deck ? others.filter((t) => checkJumpseat(s, me, t.id) === null).map((t) => t.id) : [],
    roughair: deck && !me.roughAirUsed ? Array.from({ length: s.cabin.rows - 2 }, (_, i) => i + 1) : [],
    course: deck ? (['hold', 'shortcut'] as const).filter((c) => checkCourse(s, me, c) === null) : [],
    actions: kind === 'night_act' && !buckled ? possibleActions(s, me) : [],
    whisper:
      s.settings.whispers && isWhisperPhase(kind)
        ? others.filter((t) => distance(cellOf(me), cellOf(t)) <= WHISPER_RADIUS).map((t) => t.id)
        : [],
    vote: kind === 'day_vote' ? others.map((t) => t.id) : [],
    items: possibleItemUses(s, me),
  };
}

/** In the Air Marshal's handcuffs, with a bobby pin still in the carry-on. */
function mayPickLock(p: PlayerState): boolean {
  return p.cuffedFrom !== null && p.items.includes('bobbypin');
}

/** Everything `playerId` may know right now. `null` is a spectator (the control tower). */
export function viewFor(s: GameState, playerId: string | null, now: number): PlayerView {
  const me = playerId === null ? null : getPlayer(s, playerId) ?? null;
  const ended = s.phase.kind === 'ended';
  const saboteur = me !== null && isSaboteur(me.role);
  // (Someone in the Air Marshal's cuffs with a bobby pin may yet come back: not one of the ghosts.)
  const ghost = me === null || (!isActive(me) && !mayPickLock(me));
  const privileged = ended || saboteur;

  const knowsRole = (p: PlayerState) => ended || p.id === me?.id || p.revealed || (saboteur && isSaboteur(p.role));
  const players: PlayerSummary[] = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    look: p.look,
    seat: p.seat,
    status: p.status,
    cause: p.cause,
    outNight: p.outNight,
    role: knowsRole(p) ? p.role : null,
    team: knowsRole(p) ? teamOf(p.role) : null,
  }));

  const bombs: BombView[] = s.bombs
    .filter((b) => privileged || b.exploded || (me?.knownBombIds.includes(b.id) ?? false))
    .map((b) => ({
      id: b.id,
      location: b.location,
      detonateNight: b.detonateNight,
      exploded: b.exploded,
      explodedAt: b.explodedAt,
      plantedNight: privileged ? b.plantedNight : null,
      planterId: privileged ? b.planterId : null,
      defused: b.defused,
    }));

  const chat = s.chat
    .filter(
      (m) =>
        ended ||
        m.channel === 'cabin' ||
        m.channel === 'pa' ||
        m.channel === 'whisper' ||
        (m.channel === 'saboteurs' && saboteur) ||
        (m.channel === 'ghosts' && ghost),
    )
    .map((m) => (m.channel === 'whisper' && !ended && m.from !== playerId && m.to !== playerId ? { ...m, text: '' } : m))
    .slice(-CHAT_IN_VIEW);

  const log = s.log.filter(
    (e) =>
      e.to === 'all' ||
      (e.to === 'end' && ended) ||
      (e.to === 'saboteurs' && saboteur) ||
      (Array.isArray(e.to) && playerId !== null && e.to.includes(playerId)),
  );

  const you: YouView | null = me && {
    id: me.id,
    name: me.name,
    role: me.role,
    team: teamOf(me.role),
    status: me.status,
    seat: me.seat,
    poisoned: me.poisonedNight !== null && isActive(me),
    buckled: isNightPhase(s.phase.kind) ? s.night.buckled[me.id] ?? null : null,
    bombsLeft: bombsLeft(s, me),
    usesLeft: usesLeft(s, me),
    selfTreatUsed: me.selfTreatUsed,
    lastSeatbeltTarget: me.lastSeatbeltTarget,
    note: me.note ?? '',
    cuffsUsed: me.cuffsUsed ?? false,
    searched: isNightPhase(s.phase.kind) && s.night.searched?.[me.id] === true,
    items: [...me.items],
    usedItems: [...me.usedItems],
    packed: s.packed[me.id] === true,
    washroomUsed: me.washroomUsed,
    inWashroom: inWashroom(s, me.id),
    roughAirUsed: me.roughAirUsed,
    courseUsed: me.courseUsed,
    knockedOut: isPilot(me.role) && isNightPhase(s.phase.kind) && me.knockedOutNight === s.phase.night,
    jamUsed: me.jamUsed,
    cuffed: me.cuffedFrom !== null,
    asleep:
      (s.phase.kind === 'night_act' && s.night.asleep[me.id] !== undefined) || (isNightPhase(s.phase.kind) && s.night.drowsy[me.id] !== undefined),
    drowsy: isNightPhase(s.phase.kind) && s.night.drowsy[me.id] !== undefined,
    inJumpSeat: isGuest(s, me.id),
  };

  const mine: MineView | null = me && {
    move: s.night.moves[me.id] ?? null,
    seatbelt: s.night.seatbelts[me.id] ?? null,
    jumpseat: s.night.jumpseats[me.id] ?? null,
    roughair: s.night.roughair[me.id] ?? null,
    course: s.night.courses[me.id] ?? null,
    action: s.night.actions[me.id] ?? null,
    acted: me.id in s.night.actions,
    ready: s.day.ready[me.id] === true,
    vote: s.day.votes[me.id] ?? null,
  };

  let votes: VotesView | null = null;
  if (s.phase.kind === 'day_vote') {
    const counts: Record<string, number> = {};
    for (const [voter, target] of Object.entries(s.day.votes)) counts[target] = (counts[target] ?? 0) + voteWeight(s, voter);
    votes = { counts, byVoter: s.settings.anonymousVotes ? null : { ...s.day.votes } };
  }

  return {
    gameId: s.id,
    you,
    phase: {
      kind: s.phase.kind,
      night: s.phase.night,
      nights: s.nights,
      endsInMs: ended ? 0 : Math.max(0, phaseDue(s) - now),
      earlyEnding: s.phase.earlyEndAt !== null,
    },
    settings: s.settings,
    players,
    cabin: s.cabin,
    washroom: s.phase.kind === 'night_act' ? s.night.washroom : null,
    jumpseat: s.phase.kind === 'night_act' ? s.night.jumpseat : null,
    blackout: s.blackoutNight === s.phase.night && BLACKOUT_PHASES.has(s.phase.kind),
    voteToday: s.settings.voteMode === 'daily' || s.incidentAtDawn,
    bombs,
    mine,
    options: me && isActive(me) && !ended ? optionsFor(s, me) : me && me.cuffedFrom && !ended ? cuffedOptions(s, me) : null,
    votes,
    verdict: s.verdict,
    chat,
    log,
    result: ended ? s.result : null,
    packing: s.phase.kind === 'packing' ? { done: s.players.filter((p) => s.packed[p.id]).length, total: s.players.length } : null,
    awards: ended ? s.awards : null,
    stats: ended ? s.stats : null,
    recorder: ended ? s.recorder : null,
    meal: mealFor(s, me, saboteur),
  };
}

const MEAL_PHASES: ReadonlySet<PhaseKind> = new Set(['day_discuss', 'day_vote', 'verdict']);

/** Lunch as this player sees it: on the day it is served, from the trays coming round until the verdict. */
function mealFor(s: GameState, me: PlayerState | null, saboteur: boolean): MealView | null {
  const m = s.meal;
  if (!m || s.phase.night !== m.day || !MEAL_PHASES.has(s.phase.kind)) return null;
  const mayTamper = saboteur && me !== null && isActive(me);
  return {
    day: m.day,
    open: lunchOpen(s),
    orders: { ...m.orders },
    tamper: saboteur && m.tamper ? { ...m.tamper } : null,
    reach: mayTamper ? tamperReach(me) : null,
  };
}
