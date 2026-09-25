import { voteWeight } from './day';
import { isNightPhase, isWhisperPhase, phaseDue } from './engine';
import { WHISPER_RADIUS, distance } from './grid';
import { possibleItemUses, type ItemUse } from './items';
import { isPilot, isSaboteur, teamOf } from './roles';
import { checkCourse, checkJumpseat, checkSeatbelt, checkWashroom, flightDeckError, possibleActions, possibleMoves } from './rules';
import { activePlayers, cellOf, getPlayer, inWashroom, isActive, isGuest } from './state';
import type {
  Award,
  BombLocation,
  Cabin,
  Cell,
  ChatMessage,
  DeathCause,
  GameResult,
  GameState,
  ItemId,
  LogEntry,
  Look,
  MoveTarget,
  NightAction,
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
  bombUsed: boolean;
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
}

const CHAT_IN_VIEW = 150;
const BLACKOUT_PHASES: ReadonlySet<PhaseKind> = new Set(['dawn', 'day_discuss', 'day_vote', 'verdict']);

function optionsFor(s: GameState, me: PlayerState): OptionsView {
  const kind = s.phase.kind;
  const buckled = s.night.buckled[me.id] !== undefined;
  const others = activePlayers(s).filter((p) => p.id !== me.id);
  // The flight deck's calls, while the Pilot is fit to make them.
  const deck = kind === 'night_move' && isPilot(me.role) && flightDeckError(s, me) === null;
  return {
    seats: kind === 'night_move' && !buckled ? possibleMoves(s, me) : [],
    washroom: kind !== 'night_move' ? 'The washroom is for the night.' : buckled ? 'You are buckled in tonight.' : checkWashroom(s, me),
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

/** Everything `playerId` may know right now. `null` is a spectator (the control tower). */
export function viewFor(s: GameState, playerId: string | null, now: number): PlayerView {
  const me = playerId === null ? null : getPlayer(s, playerId) ?? null;
  const ended = s.phase.kind === 'ended';
  const saboteur = me !== null && isSaboteur(me.role);
  const ghost = me === null || !isActive(me);
  const privileged = ended || saboteur;

  const knowsRole = (p: PlayerState) => ended || p.id === me?.id || p.revealed || (saboteur && isSaboteur(p.role));
  const players: PlayerSummary[] = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    look: p.look,
    seat: p.seat,
    status: p.status,
    cause: p.cause,
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
    bombUsed: me.bombUsed,
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
    bombs,
    mine,
    options: me && isActive(me) && !ended ? optionsFor(s, me) : null,
    votes,
    verdict: s.verdict,
    chat,
    log,
    result: ended ? s.result : null,
    packing: s.phase.kind === 'packing' ? { done: s.players.filter((p) => s.packed[p.id]).length, total: s.players.length } : null,
    awards: ended ? s.awards : null,
    stats: ended ? s.stats : null,
  };
}
