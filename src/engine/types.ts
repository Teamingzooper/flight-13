export type Team = 'passengers' | 'saboteurs';

export type RoleId =
  | 'passenger'
  | 'pilot'
  | 'nurse'
  | 'investigator'
  | 'stewardess_loyal'
  | 'marshal'
  | 'bomber'
  | 'mastermind'
  | 'stewardess_rogue';

/** Special cards the host puts in the deck. A stewardess card turns loyal or rogue when dealt. */
export type SpecialCard = 'bomber' | 'mastermind' | 'stewardess' | 'pilot' | 'nurse' | 'investigator' | 'marshal';
export type Cards = Record<SpecialCard, number>;

export type DestinationId = 'LAS' | 'LHR' | 'HNL' | 'HND' | 'BDA';
export type Twist = 'none' | 'turbulence' | 'redeye' | 'triangle';
export type Anomaly = 'turbulence' | 'runaway_cart' | 'blackout';

export type TimerPreset = 'quick' | 'standard' | 'relaxed';
export type VoteMode = 'daily' | 'afterIncident';

export interface Settings {
  destination: DestinationId;
  maxPassengers: number;
  rolesMode: 'auto' | 'custom';
  cards: Cards;
  stewardessRogueChance: number;
  timers: TimerPreset;
  revealRoles: boolean;
  voteMode: VoteMode;
  anonymousVotes: boolean;
  whispers: boolean;
  /** Restraining the Pilot (with no other Pilot free) hands the saboteurs the win. */
  pilotMustFly: boolean;
}

export type PhaseKind =
  | 'takeoff'
  | 'night_move'
  | 'night_act'
  | 'dawn'
  | 'day_discuss'
  | 'day_vote'
  | 'verdict'
  | 'ended';

export interface Phase {
  kind: PhaseKind;
  /** Night number 1..N; day k keeps night = k. 0 during takeoff. */
  night: number;
  startedAt: number;
  endsAt: number;
  /** Set once every eligible player has submitted; the phase ends at min(endsAt, earlyEndAt). */
  earlyEndAt: number | null;
}

/** Seat id such as "12C". */
export type SeatId = string;

/** Grid cell. Columns 0..6 where 3 is the aisle; rows 1..R, and the lavatory sits on row R+1. */
export interface Cell {
  row: number;
  col: number;
}

export type PlayerStatus = 'alive' | 'dead' | 'restrained';
export type DeathCause = 'explosion' | 'poison' | 'restrained';

/** Indices into the avatar palettes and styles (see app/Avatar.tsx). */
export interface Look {
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  top: number;
  /** Long sleeves, T-shirt, hoodie or tank top. */
  topStyle: number;
  bottom: number;
}

export interface PlayerState {
  id: string;
  name: string;
  look: Look;
  role: RoleId;
  status: PlayerStatus;
  /** Current seat. Dead players keep theirs; restrained players have null. */
  seat: SeatId | null;
  cause: DeathCause | null;
  /** Night number when the player died or was restrained. */
  outNight: number | null;
  /** Night the player was poisoned, or null. */
  poisonedNight: number | null;
  bombUsed: boolean;
  selfTreatUsed: boolean;
  lastSeatbeltTarget: string | null;
  /** Role made public (on death or restraint when the setting is on). */
  revealed: boolean;
  /** Bombs this player found (sweeps, inspections, looking under their seat). */
  knownBombIds: string[];
  /** Black box note, read out to the cabin when the player dies or is restrained. */
  note: string;
  /** The Air Marshal's one pair of handcuffs has been used. */
  cuffsUsed: boolean;
}

export type BombLocation =
  | { kind: 'seat'; seat: SeatId }
  | { kind: 'cart' }
  | { kind: 'lavatory' };

export interface Bomb {
  id: string;
  planterId: string;
  location: BombLocation;
  plantedNight: number;
  detonateNight: number;
  exploded: boolean;
  /** Cells the blast was centred on (cart bombs go off wherever the cart is). */
  explodedAt: Cell[] | null;
}

export interface Cabin {
  rows: number;
  cartRow: number;
  cartDestroyed: boolean;
  lavatoryDestroyed: boolean;
  scorched: Cell[];
}

export type NightAction =
  | { kind: 'treat'; target: string }
  | { kind: 'sweep' }
  | { kind: 'inspect'; what: 'cart' | 'lavatory' }
  | { kind: 'serve'; target: string }
  | { kind: 'plant'; where: 'seat' | 'cart' | 'lavatory'; fuse: 1 | 2 }
  /** Anyone: look under your own seat (answered at once, and it uses up your night). */
  | { kind: 'search' }
  /** Air Marshal, once per game: handcuff someone within 2 seats. */
  | { kind: 'cuff'; target: string };

export interface NightChoices {
  moves: Record<string, SeatId | 'stay'>;
  /** Pilot id → target id or 'none'. */
  seatbelts: Record<string, string>;
  /** null = pressed Done without acting. */
  actions: Record<string, NightAction | null>;
  buckled: Record<string, 'pilot' | 'turbulence'>;
  anomaly: Anomaly | null;
  /** Players who already looked under their seat tonight (their action is locked). */
  searched: Record<string, true>;
}

export interface DayChoices {
  ready: Record<string, true>;
  /** Voter id → target id or 'skip'. */
  votes: Record<string, string>;
}

export interface Verdict {
  night: number;
  restrained: string | null;
  /** Target id (or 'skip') → votes; non-votes count as skip. */
  tally: Record<string, number>;
}

export type ChatChannel = 'cabin' | 'saboteurs' | 'ghosts';

export interface ChatMessage {
  id: number;
  t: number;
  channel: ChatChannel | 'whisper';
  from: string;
  to: string | null;
  text: string;
}

/** 'end' = black box (revealed when the game ends); 'saboteurs' = the saboteur team. */
export type LogAudience = 'all' | 'end' | 'saboteurs' | string[];

export type LogTag =
  | 'info'
  | 'takeoff'
  | 'turbulence'
  | 'buckled'
  | 'bumped'
  | 'move'
  | 'seatbelt'
  | 'treat'
  | 'plant'
  | 'poison'
  | 'sick'
  | 'cured'
  | 'saved'
  | 'sweep'
  | 'inspect'
  | 'search'
  | 'cuff'
  | 'note'
  | 'serve'
  | 'cart'
  | 'explosion'
  | 'death'
  | 'fizzle'
  | 'anomaly'
  | 'verdict'
  | 'landing'
  | 'gameover';

export interface LogEntry {
  id: number;
  t: number;
  night: number;
  phase: PhaseKind;
  to: LogAudience;
  tag: LogTag;
  text: string;
  data?: Record<string, unknown>;
}

export interface GameResult {
  winner: Team | 'draw';
  reason: 'eliminated' | 'parity' | 'landed' | 'no_survivors' | 'pilot';
  night: number;
}

export interface GameState {
  v: 1;
  /** PRNG state (see rng.ts). */
  rng: number;
  settings: Settings;
  nights: number;
  players: PlayerState[];
  cabin: Cabin;
  bombs: Bomb[];
  phase: Phase;
  night: NightChoices;
  day: DayChoices;
  verdict: Verdict | null;
  incidentAtDawn: boolean;
  blackoutNight: number | null;
  chat: ChatMessage[];
  log: LogEntry[];
  nextId: number;
  lastChatAt: Record<string, number>;
  result: GameResult | null;
}

export type Intent =
  | { kind: 'move'; to: SeatId | 'stay' }
  | { kind: 'seatbelt'; target: string }
  | { kind: 'act'; action: NightAction | null }
  | { kind: 'ready' }
  | { kind: 'vote'; target: string }
  | { kind: 'note'; text: string }
  | { kind: 'chat'; channel: ChatChannel; text: string }
  | { kind: 'whisper'; to: string; text: string };

export type IntentResult = { ok: true } | { ok: false; error: string };
