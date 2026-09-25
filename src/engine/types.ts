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
  | 'stewardess_rogue'
  | 'pilot_rogue';

/** Special cards the host puts in the deck. A stewardess card turns loyal or rogue when dealt. */
export type SpecialCard = 'bomber' | 'mastermind' | 'stewardess' | 'pilot' | 'nurse' | 'investigator' | 'marshal';
export type Cards = Record<SpecialCard, number>;

export type DestinationId = 'LAS' | 'LHR' | 'HNL' | 'HND' | 'BDA';
export type Twist = 'turbulence' | 'redeye' | 'triangle';

/** A destination the host made up: a city, a three-letter code, how many nights, and any mix of twists. */
export interface CustomDestination {
  city: string;
  code: string;
  nights: number;
  twists: Twist[];
}
/** How much the bots talk. */
export type BotChatter = 'quiet' | 'normal' | 'lively';
/** How well the bots reason (and lie). */
export type BotSkill = 'easy' | 'normal' | 'hard';
export type Anomaly = 'turbulence' | 'runaway_cart' | 'blackout';

export type TimerPreset = 'quick' | 'standard' | 'relaxed';
export type VoteMode = 'daily' | 'afterIncident';

export interface Settings {
  destination: DestinationId | 'custom';
  /** The host's own destination, when `destination` is 'custom'. */
  customDestination: CustomDestination | null;
  maxPassengers: number;
  rolesMode: 'auto' | 'custom';
  cards: Cards;
  stewardessRogueChance: number;
  /** Chance the Pilot card turns rogue (only when the saboteurs would still be outnumbered). */
  pilotRogueChance: number;
  timers: TimerPreset;
  revealRoles: boolean;
  voteMode: VoteMode;
  anonymousVotes: boolean;
  whispers: boolean;
  /** Restraining the Pilot (with no other Pilot free) hands the saboteurs the win. */
  pilotMustFly: boolean;
  botChatter: BotChatter;
  botSkill: BotSkill;
}

export type PhaseKind =
  | 'packing'
  | 'boarding'
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
  /** Night number 1..N; day k keeps night = k. 0 while packing, boarding and taking off. */
  night: number;
  startedAt: number;
  endsAt: number;
  /** Set once every eligible player has submitted; the phase ends at min(endsAt, earlyEndAt). */
  earlyEndAt: number | null;
}

/** Seat id such as "12C", or an aisle spot such as "Aisle 5" (where the Stewardess works). */
export type SeatId = string;

/** Where you can go when the lights go out: a seat (or, for crew, an aisle spot), nowhere, or the washroom. */
export type MoveTarget = SeatId | 'stay' | 'washroom';

/** Grid cell. Columns 0..6 where 3 is the aisle; rows 1..R, and the lavatory sits on row R+1. */
export interface Cell {
  row: number;
  col: number;
}

export type PlayerStatus = 'alive' | 'dead' | 'restrained';

/** Carry-on items (see items.ts). */
export type ItemId = 'antidote' | 'defuser' | 'extender' | 'flashlight' | 'pills' | 'mirror' | 'ffcard' | 'pillow' | 'bobbypin';
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
  /** Accessories from Duty Free (0 or missing: none). Purely cosmetic. */
  hat?: number;
  eyes?: number;
  neck?: number;
}

export interface PlayerState {
  id: string;
  name: string;
  look: Look;
  role: RoleId;
  status: PlayerStatus;
  /** Current seat (an aisle spot for the Stewardess). Dead players keep theirs; restrained players have null. */
  seat: SeatId | null;
  cause: DeathCause | null;
  /** Night number when the player died or was restrained. */
  outNight: number | null;
  /** Night the player was poisoned, or null. */
  poisonedNight: number | null;
  /** Bombs planted so far (a Bomber or the Mastermind gets one for every three nights of the flight). */
  bombsPlanted: number;
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
  /** Carry-on items not used yet. */
  items: ItemId[];
  /** Items used up so far, in order. */
  usedItems: ItemId[];
  /** Who poisoned this player (credited if the poison kills them). */
  poisonedBy: string | null;
  /** The washroom can be used once per flight. */
  washroomUsed: boolean;
  /** Pilot: rough air and a change of course are once per flight. */
  roughAirUsed: boolean;
  courseUsed: boolean;
  /** Pilot: knocked out cold by his guest, and out of action on this night. */
  knockedOutNight: number | null;
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
  /** Someone cut the wires; it will never go off. */
  defused: boolean;
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
  /** Rogue Stewardess: a poisoned drink for someone sitting in her row. */
  | { kind: 'serve'; target: string }
  /** Loyal Stewardess: check under the three seats on one side of her row. */
  | { kind: 'check'; side: 'left' | 'right' }
  | { kind: 'plant'; where: 'seat' | 'cart' | 'lavatory'; fuse: 1 | 2 }
  /** Anyone: look under your own seat, or search the lavatory while you are in it (answered at once, and it uses up your night). */
  | { kind: 'search' }
  /** Air Marshal, once per game: handcuff someone within 2 seats. */
  | { kind: 'cuff'; target: string }
  /** Pilot: watch three rows on the cabin cameras. */
  | { kind: 'watch'; startRow: number }
  /** A saboteur in the jump seat knocks the Pilot out cold. */
  | { kind: 'knockout' };

/**
 * What the Pilot's cabin cameras showed someone doing (for bots and replays; the text says the same). It is what
 * the camera sees, not what they did: planting under a seat looks just like looking under it.
 */
export interface Sighting {
  actor: string;
  kind: 'under_seat' | 'cart' | 'lavatory' | 'lean' | 'drink' | 'check' | 'look_around' | 'cuff' | 'flashlight' | 'pills';
  target?: string;
  seat?: SeatId;
  /** What the camera caption says ("Jo bent down under their seat"). Missing in games saved before replays. */
  text?: string;
}

export interface NightChoices {
  moves: Record<string, MoveTarget>;
  /** Pilot id → target id or 'none'. */
  seatbelts: Record<string, string>;
  /** null = pressed Done without acting. */
  actions: Record<string, NightAction | null>;
  buckled: Record<string, 'pilot' | 'turbulence' | 'rough'>;
  anomaly: Anomaly | null;
  /** Players who already looked under their seat tonight (their action is locked). */
  searched: Record<string, true>;
  /** Sleeping pills: player → who slipped them one. They do nothing tonight. */
  asleep: Record<string, string>;
  /** Players watching their compact mirror tonight. */
  mirrors: Record<string, true>;
  /** Pocket flashlights: player → the seat they looked under. */
  flashlights: Record<string, SeatId>;
  /** Seatbelt extenders: the sign cannot hold these players tonight. */
  freed: Record<string, true>;
  /** Bombs defused tonight: bomb id → who defused it. */
  defused: Record<string, string>;
  /** Who is locked in the lavatory tonight (back in their seat by morning). */
  washroom: string | null;
  /** Pilot id → who he calls up to the jump seat ('none' for nobody). */
  jumpseats: Record<string, string>;
  /** Pilot id → the first of three rows to fly rough air over. */
  roughair: Record<string, number>;
  /** Pilot id → a change of course. */
  courses: Record<string, 'hold' | 'shortcut'>;
  /** Who is up on the flight deck tonight, once seats have changed. */
  jumpseat: string | null;
}

export interface DayChoices {
  ready: Record<string, true>;
  /** Voter id → target id or 'skip'. */
  votes: Record<string, string>;
  /** Frequent-flyer cards: these votes count twice today. */
  doubled: Record<string, true>;
}

export interface Verdict {
  night: number;
  restrained: string | null;
  /** Target id (or 'skip') → votes; non-votes count as skip. */
  tally: Record<string, number>;
}

export type ChatChannel = 'cabin' | 'saboteurs' | 'ghosts' | 'pa';

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
  | 'item'
  | 'defused'
  | 'washroom'
  | 'check'
  | 'jumpseat'
  | 'roughair'
  | 'course'
  | 'knockout'
  | 'watch'
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

/** What each player did that pays out at the end. */
export interface PlayerStats {
  /** Passengers killed by your bomb or your poison. */
  kills: number;
  /** People the Nurse's treatment actually saved. */
  rescues: number;
  /** Bombs found (looking under seats, sweeps, inspections, flashlights). */
  found: number;
  defused: number;
}

/** Flight credits earned in one game. */
export interface Award {
  credits: number;
  lines: { label: string; credits: number }[];
}

export interface GameState {
  v: 1;
  /** Unique per game, so rewards are paid once. */
  id: string;
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
  /** Players done packing. */
  packed: Record<string, true>;
  stats: Record<string, PlayerStats>;
  /** Credits per player, set when the game ends. */
  awards: Record<string, Award> | null;
  /** The flight recorder: each night as it happened, shown to everyone once the flight is over. */
  recorder: NightRecord[];
}

/** One night on the flight recorder. */
export interface NightRecord {
  night: number;
  /** Where everyone in play sat (before any handcuffs). */
  seats: Record<string, SeatId>;
  /** Who spent the night in the lavatory, and who was up in the jump seat. */
  washroom: string | null;
  jumpseat: string | null;
  cartRow: number;
  /** What was done in the dark, in the order the night resolved it (after pills and handcuffs). */
  acts: { actor: string; action: NightAction }[];
  /** Carry-on items used in the dark. */
  items: { user: string; item: 'flashlight' | 'pills'; seat?: SeatId; target?: string }[];
}

export type Intent =
  /** Your carry-on (at most three items); `ready` when you are done packing. */
  | { kind: 'pack'; items: ItemId[]; ready: boolean }
  /** Use a carry-on item (a seat for the flashlight, a neighbour for sleeping pills). */
  | { kind: 'use'; item: ItemId; target?: string; seat?: SeatId }
  | { kind: 'move'; to: MoveTarget }
  | { kind: 'seatbelt'; target: string }
  /** Pilot: call someone up to the jump seat for the night ('none' for nobody). */
  | { kind: 'jumpseat'; target: string }
  /** Pilot, once per flight: rough air over three rows from `startRow` (null to call it off). */
  | { kind: 'roughair'; startRow: number | null }
  /** Pilot, once per flight: land a night later or sooner (null to call it off). */
  | { kind: 'course'; change: 'hold' | 'shortcut' | null }
  | { kind: 'act'; action: NightAction | null }
  | { kind: 'ready' }
  | { kind: 'vote'; target: string }
  | { kind: 'note'; text: string }
  | { kind: 'chat'; channel: ChatChannel; text: string }
  | { kind: 'whisper'; to: string; text: string };

export type IntentResult = { ok: true } | { ok: false; error: string };
