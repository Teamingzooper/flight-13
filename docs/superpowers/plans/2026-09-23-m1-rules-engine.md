# Flight 13 — Milestone 1: Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, fully tested TypeScript rules engine for Flight 13 (roles, phases, bombs, poison, voting, win conditions, redacted per-player views, bots), with no DOM or networking.

**Architecture:** The engine is a set of small modules under `src/engine/` that mutate a single JSON-serializable `GameState`. The host calls `applyIntent(state, playerId, intent, now)` for player input, `tick(state, now)` on a timer, and `viewFor(state, playerId, now)` to build what each player may see. Randomness comes from a seeded PRNG stored inside the state, so games replay exactly.

**Tech Stack:** TypeScript 5 (strict), Vitest, Vite (only used for config now; the app arrives in Milestone 2).

**Spec:** `docs/superpowers/specs/2026-09-23-flight-13-design.md`

**Code blocks:** every code block tagged `file=<path>` is the complete content of that file.

---

## File map

| File | Responsibility |
|---|---|
| `src/engine/types.ts` | Every shared type: settings, state, intents, logs |
| `src/engine/rng.ts` | Seeded PRNG (mulberry32) stored on the state |
| `src/engine/grid.ts` | Cabin geometry: seat ids, distance, blast/sweep areas, cart and lavatory cells |
| `src/engine/roles.ts` | Role catalog, teams, presets, deck validation |
| `src/engine/destinations.ts` | Destination catalog (flight length + twist) |
| `src/engine/settings.ts` | Defaults, timers, limits, settings validation |
| `src/engine/state.ts` | Small state helpers: lookups, logging, phase switching, removing players |
| `src/engine/setup.ts` | `createGame`: deal roles, assign seats, takeoff |
| `src/engine/rules.ts` | Validation of moves, seatbelts and night actions; legal-action lists |
| `src/engine/night.ts` | Night start (twists), move resolution, night resolution |
| `src/engine/day.ts` | Day start, vote tally, verdict |
| `src/engine/win.ts` | Win checks, landing, result text |
| `src/engine/engine.ts` | `applyIntent`, `tick`, phase transitions, early end, chat |
| `src/engine/view.ts` | `viewFor`: redacted per-player views and legal options |
| `src/engine/bots.ts` | Random legal intents (simulation and dev bots) |
| `src/engine/testkit.ts` | Test helpers: fixed-role games, phase stepping |
| `src/engine/index.ts` | Public API |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json` (via npm), `tsconfig.json`, `vite.config.ts`

- [ ] **Step 1: Initialise npm and install tooling**

```bash
cd ~/Projects/flight-13
npm init -y >/dev/null
npm pkg set name=flight-13 type=module version=0.1.0
npm pkg set private=true --json
npm pkg set scripts.dev="vite" scripts.build="tsc --noEmit && vite build" scripts.preview="vite preview" scripts.test="vitest run" scripts.typecheck="tsc --noEmit"
npm pkg delete main scripts.test:watch keywords author license description 2>/dev/null || true
npm install -D typescript vite vitest @types/node
```

- [ ] **Step 2: Add TypeScript and Vitest config**

```json file=tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "vite.config.ts"]
}
```

```ts file=vite.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/flight-13/',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Verify the toolchain runs**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0 with "No test files found".

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts
git commit -m "chore: scaffold TypeScript + Vitest project"
```

---

### Task 2: Seeded PRNG

**Files:**
- Create: `src/engine/rng.ts`
- Test: `src/engine/rng.test.ts`

- [ ] **Step 1: Write the failing test**

```ts file=src/engine/rng.test.ts
import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, pick, shuffle } from './rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    const seqA = [nextFloat(a), nextFloat(a), nextFloat(a)];
    const seqB = [nextFloat(b), nextFloat(b), nextFloat(b)];
    expect(seqA).toEqual(seqB);
    expect(new Set(seqA).size).toBe(3);
  });

  it('returns floats in [0, 1)', () => {
    const h = { rng: 7 };
    for (let i = 0; i < 2000; i++) {
      const x = nextFloat(h);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('nextInt covers 0..n-1 only', () => {
    const h = { rng: 3 };
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(nextInt(h, 5));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('shuffle keeps every item exactly once and leaves the input alone', () => {
    const h = { rng: 99 };
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out = shuffle(h, items);
    expect(out.slice().sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('pick throws on an empty list', () => {
    expect(() => pick({ rng: 1 }, [])).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/rng.test.ts`
Expected: FAIL — cannot resolve `./rng`.

- [ ] **Step 3: Implement**

```ts file=src/engine/rng.ts
/** Anything that carries a PRNG state (the GameState does). */
export interface RngHolder {
  rng: number;
}

/** mulberry32: small, fast, deterministic. Advances `h.rng`. */
export function nextFloat(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(h: RngHolder, n: number): number {
  return Math.floor(nextFloat(h) * n);
}

export function pick<T>(h: RngHolder, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from an empty list');
  return items[nextInt(h, items.length)];
}

export function shuffle<T>(h: RngHolder, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(h, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/engine/rng.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rng.ts src/engine/rng.test.ts
git commit -m "feat(engine): seeded PRNG"
```

---

### Task 3: Shared types and cabin grid

**Files:**
- Create: `src/engine/types.ts`, `src/engine/grid.ts`
- Test: `src/engine/grid.test.ts`

- [ ] **Step 1: Write the shared types (no behaviour, no test)**

```ts file=src/engine/types.ts
export type Team = 'passengers' | 'saboteurs';

export type RoleId =
  | 'passenger'
  | 'pilot'
  | 'nurse'
  | 'investigator'
  | 'stewardess_loyal'
  | 'bomber'
  | 'mastermind'
  | 'stewardess_rogue';

/** Special cards the host puts in the deck. A stewardess card turns loyal or rogue when dealt. */
export type SpecialCard = 'bomber' | 'mastermind' | 'stewardess' | 'pilot' | 'nurse' | 'investigator';
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

/** Indices into the avatar palettes used by the 3D layer. */
export interface Look {
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  top: number;
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
  /** Bombs this player found as Investigator. */
  knownBombIds: string[];
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
  | { kind: 'plant'; where: 'seat' | 'cart' | 'lavatory'; fuse: 1 | 2 };

export interface NightChoices {
  moves: Record<string, SeatId | 'stay'>;
  /** Pilot id → target id or 'none'. */
  seatbelts: Record<string, string>;
  /** null = pressed Done without acting. */
  actions: Record<string, NightAction | null>;
  buckled: Record<string, 'pilot' | 'turbulence'>;
  anomaly: Anomaly | null;
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
  reason: 'eliminated' | 'parity' | 'landed' | 'no_survivors';
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
  | { kind: 'chat'; channel: ChatChannel; text: string }
  | { kind: 'whisper'; to: string; text: string };

export type IntentResult = { ok: true } | { ok: false; error: string };
```

- [ ] **Step 2: Write the failing grid test**

```ts file=src/engine/grid.test.ts
import { describe, expect, it } from 'vitest';
import {
  allSeats,
  cartCell,
  distance,
  isAisleSeat,
  isSeatInCabin,
  lavatoryCells,
  parseSeat,
  rowsFor,
  seatDistance,
  seatId,
  seatsWithin,
} from './grid';

describe('grid', () => {
  it('sizes the cabin by max passengers', () => {
    expect(rowsFor(4)).toBe(8);
    expect(rowsFor(8)).toBe(8);
    expect(rowsFor(9)).toBe(10);
    expect(rowsFor(12)).toBe(10);
    expect(rowsFor(16)).toBe(12);
  });

  it('round-trips seat ids and has no seat in the aisle', () => {
    expect(parseSeat('12C')).toEqual({ row: 12, col: 2 });
    expect(parseSeat('3D')).toEqual({ row: 3, col: 4 });
    expect(seatId({ row: 7, col: 6 })).toBe('7F');
    expect(() => seatId({ row: 1, col: 3 })).toThrow();
    expect(parseSeat('0A')).toBeNull();
    expect(parseSeat('4G')).toBeNull();
    expect(isSeatInCabin('9A', 8)).toBe(false);
    expect(isSeatInCabin('8F', 8)).toBe(true);
  });

  it('lists six seats per row', () => {
    const seats = allSeats(8);
    expect(seats).toHaveLength(48);
    expect(seats[0]).toBe('1A');
    expect(seats).toContain('8F');
  });

  it('counts diagonals as 1 and the aisle as a cell', () => {
    expect(seatDistance('12B', '13C')).toBe(1);
    expect(seatDistance('12C', '12D')).toBe(2);
    expect(seatDistance('4B', '6A')).toBe(2);
    expect(distance(cartCell(5), parseSeat('4C')!)).toBe(1);
    expect(isAisleSeat('4C')).toBe(true);
    expect(isAisleSeat('4E')).toBe(false);
  });

  it('a seat bomb in B reaches the aisle but not seat D', () => {
    const hit = seatsWithin([parseSeat('6B')!], 2, 12);
    expect(hit).toContain('4A');
    expect(hit).toContain('8C');
    expect(hit).not.toContain('6D');
    expect(hit).not.toContain('3B');
    expect(hit).toHaveLength(15);
  });

  it('a cart bomb reaches both sides of the aisle', () => {
    const hit = seatsWithin([cartCell(5)], 2, 12);
    expect(hit).toContain('5B');
    expect(hit).toContain('7E');
    expect(hit).not.toContain('5A');
    expect(hit).not.toContain('5F');
    expect(hit).toHaveLength(20);
  });

  it('only the last row A-C is next to the lavatory', () => {
    expect(seatsWithin(lavatoryCells(8), 1, 8).sort()).toEqual(['8A', '8B', '8C']);
    expect(seatsWithin(lavatoryCells(8), 2, 8)).toHaveLength(8);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/engine/grid.test.ts`
Expected: FAIL — cannot resolve `./grid`.

- [ ] **Step 4: Implement the grid**

```ts file=src/engine/grid.ts
import type { Cell, SeatId } from './types';

export const AISLE_COL = 3;
export const SEAT_COLS = [0, 1, 2, 4, 5, 6] as const;
export const BLAST_RADIUS = 2;
export const SWEEP_RADIUS = 1;
export const WHISPER_RADIUS = 2;

const LETTER_BY_COL: Record<number, string> = { 0: 'A', 1: 'B', 2: 'C', 4: 'D', 5: 'E', 6: 'F' };
const COL_BY_LETTER: Record<string, number> = { A: 0, B: 1, C: 2, D: 4, E: 5, F: 6 };

/** Cabin length for a flight booked for `maxPassengers`. */
export function rowsFor(maxPassengers: number): number {
  if (maxPassengers <= 8) return 8;
  if (maxPassengers <= 12) return 10;
  return 12;
}

export function seatId(cell: Cell): SeatId {
  const letter = LETTER_BY_COL[cell.col];
  if (!letter) throw new Error(`Column ${cell.col} has no seats`);
  return `${cell.row}${letter}`;
}

export function parseSeat(id: SeatId): Cell | null {
  const m = /^([1-9]\d?)([A-F])$/.exec(id);
  if (!m) return null;
  return { row: Number(m[1]), col: COL_BY_LETTER[m[2]] };
}

export function isSeatInCabin(id: SeatId, rows: number): boolean {
  const cell = parseSeat(id);
  return cell !== null && cell.row <= rows;
}

export function allSeats(rows: number): SeatId[] {
  const seats: SeatId[] = [];
  for (let row = 1; row <= rows; row++) {
    for (const col of SEAT_COLS) seats.push(seatId({ row, col }));
  }
  return seats;
}

/** Chebyshev distance: diagonals count as 1 and the aisle is a cell of its own. */
export function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

export function distanceToAny(a: Cell, cells: readonly Cell[]): number {
  let best = Infinity;
  for (const c of cells) best = Math.min(best, distance(a, c));
  return best;
}

export function seatDistance(a: SeatId, b: SeatId): number {
  const ca = parseSeat(a);
  const cb = parseSeat(b);
  if (!ca || !cb) throw new Error(`Bad seat id: ${a} / ${b}`);
  return distance(ca, cb);
}

export function cartCell(row: number): Cell {
  return { row, col: AISLE_COL };
}

export function lavatoryCells(rows: number): Cell[] {
  return [0, 1, 2].map((col) => ({ row: rows + 1, col }));
}

/** Seats whose cell is within `radius` of any of `centers`. */
export function seatsWithin(centers: readonly Cell[], radius: number, rows: number): SeatId[] {
  return allSeats(rows).filter((id) => distanceToAny(parseSeat(id)!, centers) <= radius);
}

export function isAisleSeat(id: SeatId): boolean {
  const cell = parseSeat(id);
  return cell !== null && (cell.col === 2 || cell.col === 4);
}

/** Stable front-to-back, left-to-right ordering key. */
export function seatOrder(id: SeatId): number {
  const cell = parseSeat(id);
  return cell ? cell.row * 10 + cell.col : Number.MAX_SAFE_INTEGER;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/engine/grid.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/grid.ts src/engine/grid.test.ts
git commit -m "feat(engine): shared types and cabin grid geometry"
```

---

### Task 4: Roles, destinations and settings

**Files:**
- Create: `src/engine/roles.ts`, `src/engine/destinations.ts`, `src/engine/settings.ts`
- Test: `src/engine/roles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts file=src/engine/roles.test.ts
import { describe, expect, it } from 'vitest';
import { apparentTeam, emptyCards, presetCards, teamOf, validateCards } from './roles';
import { defaultSettings, phaseDurationMs, validateSettings } from './settings';

describe('roles', () => {
  it('every preset from 4 to 16 players is valid', () => {
    for (let n = 4; n <= 16; n++) expect(validateCards(presetCards(n), n, 0.5)).toBeNull();
  });

  it('requires someone with a bomb', () => {
    expect(validateCards({ ...emptyCards(), pilot: 1 }, 6, 0.5)).toMatch(/Bomber/);
  });

  it('rejects more special cards than players', () => {
    expect(validateCards({ ...emptyCards(), bomber: 1, pilot: 3, nurse: 2 }, 5, 0)).toMatch(/Too many special/);
  });

  it('saboteurs must start as a minority, counting stewardesses that could turn rogue', () => {
    expect(validateCards({ ...emptyCards(), bomber: 2, stewardess: 1 }, 6, 0.5)).toMatch(/minority/);
    expect(validateCards({ ...emptyCards(), bomber: 2, stewardess: 1 }, 6, 0)).toBeNull();
  });

  it('the Mastermind looks like a passenger to the Stewardess', () => {
    expect(teamOf('mastermind')).toBe('saboteurs');
    expect(apparentTeam('mastermind')).toBe('passengers');
    expect(apparentTeam('stewardess_rogue')).toBe('saboteurs');
  });
});

describe('settings', () => {
  it('defaults are valid', () => {
    expect(validateSettings(defaultSettings())).toBeNull();
  });

  it('rejects out-of-range passenger counts', () => {
    expect(validateSettings({ ...defaultSettings(), maxPassengers: 3 })).toMatch(/Max passengers/);
    expect(validateSettings({ ...defaultSettings(), maxPassengers: 17 })).toMatch(/Max passengers/);
  });

  it('the red-eye to Tokyo shortens discussion', () => {
    expect(phaseDurationMs(defaultSettings(), 'day_discuss')).toBe(90_000);
    expect(phaseDurationMs({ ...defaultSettings(), destination: 'HND' }, 'day_discuss')).toBe(54_000);
    expect(phaseDurationMs({ ...defaultSettings(), timers: 'quick' }, 'night_act')).toBe(20_000);
    expect(phaseDurationMs(defaultSettings(), 'takeoff')).toBe(12_000);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/roles.test.ts`
Expected: FAIL — cannot resolve `./roles`.

- [ ] **Step 3: Implement roles, destinations and settings**

```ts file=src/engine/roles.ts
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
    howTo: 'No night ability. Change seats, watch closely, argue, and vote.',
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
      'Once per game, plant a bomb under your seat, on the drink cart (from an aisle seat next to it) or in the lavatory (from a seat next to it). Set the fuse to 1 or 2 nights. Everyone within 2 seats is caught in the blast.',
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

export const SPECIAL_CARDS: readonly SpecialCard[] = ['bomber', 'mastermind', 'stewardess', 'pilot', 'nurse', 'investigator'];

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

export function isStewardess(role: RoleId): boolean {
  return role === 'stewardess_loyal' || role === 'stewardess_rogue';
}

export function emptyCards(): Cards {
  return { bomber: 0, mastermind: 0, stewardess: 0, pilot: 0, nurse: 0, investigator: 0 };
}

/** Balanced special cards for a player count; everyone else is a Passenger. */
export function presetCards(players: number): Cards {
  if (players <= 4) return { ...emptyCards(), bomber: 1, pilot: 1, nurse: 1 };
  if (players <= 6) return { ...emptyCards(), bomber: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 1 };
  if (players <= 9) return { ...emptyCards(), bomber: 2, stewardess: 1, pilot: 1, nurse: 1, investigator: 1 };
  if (players <= 12) return { ...emptyCards(), bomber: 2, mastermind: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 1 };
  return { ...emptyCards(), bomber: 3, mastermind: 1, stewardess: 1, pilot: 1, nurse: 1, investigator: 2 };
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
```

```ts file=src/engine/destinations.ts
import type { DestinationId, Twist } from './types';

export interface Destination {
  id: DestinationId;
  city: string;
  nights: number;
  twist: Twist;
  blurb: string;
}

export const DESTINATIONS: Record<DestinationId, Destination> = {
  LAS: { id: 'LAS', city: 'Las Vegas', nights: 3, twist: 'none', blurb: 'Quick hop. Classic rules.' },
  LHR: { id: 'LHR', city: 'London', nights: 5, twist: 'none', blurb: 'Classic rules.' },
  HNL: {
    id: 'HNL',
    city: 'Honolulu',
    nights: 5,
    twist: 'turbulence',
    blurb: 'Turbulence: each night one random passenger is buckled in.',
  },
  HND: { id: 'HND', city: 'Tokyo', nights: 7, twist: 'redeye', blurb: 'Red-eye: a long flight with shorter days.' },
  BDA: {
    id: 'BDA',
    city: 'Bermuda',
    nights: 5,
    twist: 'triangle',
    blurb: 'The Triangle: something strange happens every night.',
  },
};

export const DESTINATION_ORDER: readonly DestinationId[] = ['LAS', 'LHR', 'HNL', 'HND', 'BDA'];
```

```ts file=src/engine/settings.ts
import { DESTINATIONS } from './destinations';
import { emptyCards } from './roles';
import type { PhaseKind, Settings, TimerPreset } from './types';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const EARLY_END_GRACE_MS = 3000;
export const CHAT_MAX_LENGTH = 200;
export const CHAT_COOLDOWN_MS = 1000;
export const CHAT_HISTORY = 300;

export interface TimerSet {
  night_move: number;
  night_act: number;
  day_discuss: number;
  day_vote: number;
}

/** Seconds per adjustable phase. */
export const TIMERS: Record<TimerPreset, TimerSet> = {
  quick: { night_move: 15, night_act: 20, day_discuss: 60, day_vote: 20 },
  standard: { night_move: 20, night_act: 30, day_discuss: 90, day_vote: 30 },
  relaxed: { night_move: 30, night_act: 45, day_discuss: 150, day_vote: 45 },
};

/** Seconds for the cutscene phases. */
export const FIXED_TIMERS = { takeoff: 12, dawn: 10, verdict: 8 } as const;

export function defaultSettings(): Settings {
  return {
    destination: 'LHR',
    maxPassengers: 10,
    rolesMode: 'auto',
    cards: emptyCards(),
    stewardessRogueChance: 0.5,
    timers: 'standard',
    revealRoles: true,
    voteMode: 'daily',
    anonymousVotes: false,
    whispers: true,
  };
}

/** Length of a phase in milliseconds. */
export function phaseDurationMs(settings: Settings, kind: PhaseKind): number {
  switch (kind) {
    case 'takeoff':
    case 'dawn':
    case 'verdict':
      return FIXED_TIMERS[kind] * 1000;
    case 'ended':
      return 0;
    case 'day_discuss': {
      const factor = DESTINATIONS[settings.destination].twist === 'redeye' ? 0.6 : 1;
      return Math.round(TIMERS[settings.timers].day_discuss * factor) * 1000;
    }
    default:
      return TIMERS[settings.timers][kind] * 1000;
  }
}

export function validateSettings(s: Settings): string | null {
  if (!DESTINATIONS[s.destination]) return 'Unknown destination.';
  if (!Number.isInteger(s.maxPassengers) || s.maxPassengers < MIN_PLAYERS || s.maxPassengers > MAX_PLAYERS) {
    return `Max passengers must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`;
  }
  if (!(s.stewardessRogueChance >= 0 && s.stewardessRogueChance <= 1)) return 'Stewardess odds must be between 0 and 1.';
  if (!TIMERS[s.timers]) return 'Unknown timer preset.';
  if (s.rolesMode !== 'auto' && s.rolesMode !== 'custom') return 'Unknown roles mode.';
  if (s.voteMode !== 'daily' && s.voteMode !== 'afterIncident') return 'Unknown vote mode.';
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/engine/roles.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/roles.ts src/engine/destinations.ts src/engine/settings.ts src/engine/roles.test.ts
git commit -m "feat(engine): roles, presets, destinations and settings"
```

---

### Task 5: State helpers and game setup

**Files:**
- Create: `src/engine/state.ts`, `src/engine/setup.ts`
- Test: `src/engine/setup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts file=src/engine/setup.test.ts
import { describe, expect, it } from 'vitest';
import { emptyCards } from './roles';
import { defaultSettings } from './settings';
import { checkTakeoff, createGame, dealRoles, type NewPlayer } from './setup';
import type { Look } from './types';

const LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, bottom: 0 };
const passengers = (n: number): NewPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: LOOK }));

describe('createGame', () => {
  it('deals the preset roles and gives everyone a distinct seat', () => {
    const s = createGame({ settings: { ...defaultSettings(), maxPassengers: 10 }, players: passengers(10), seed: 5, now: 0 });
    const roles = s.players.map((p) => p.role);
    expect(roles.filter((r) => r === 'bomber')).toHaveLength(2);
    expect(roles.filter((r) => r === 'mastermind')).toHaveLength(1);
    expect(roles.filter((r) => r.startsWith('stewardess'))).toHaveLength(1);
    expect(new Set(s.players.map((p) => p.seat)).size).toBe(10);
    expect(s.cabin.rows).toBe(10);
    expect(s.nights).toBe(5);
    expect(s.phase).toMatchObject({ kind: 'takeoff', night: 0, endsAt: 12_000 });
  });

  it('is deterministic for a seed', () => {
    const make = () => createGame({ settings: defaultSettings(), players: passengers(8), seed: 77, now: 0 });
    expect(make().players).toEqual(make().players);
  });

  it('turns the stewardess rogue or loyal according to the odds', () => {
    const cards = { ...emptyCards(), stewardess: 1 };
    expect(dealRoles({ rng: 1 }, cards, 4, 1)).toContain('stewardess_rogue');
    expect(dealRoles({ rng: 1 }, cards, 4, 0)).toContain('stewardess_loyal');
  });

  it('refuses to take off with too few passengers or a bad custom deck', () => {
    expect(checkTakeoff(defaultSettings(), passengers(3))).toMatch(/at least 4/);
    const custom = { ...defaultSettings(), rolesMode: 'custom' as const, cards: { ...emptyCards(), bomber: 3 } };
    expect(checkTakeoff(custom, passengers(6))).toMatch(/minority/);
    expect(() => createGame({ settings: custom, players: passengers(6), seed: 1, now: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/setup.test.ts`
Expected: FAIL — cannot resolve `./setup`.

- [ ] **Step 3: Implement state helpers and setup**

```ts file=src/engine/state.ts
import { allSeats, parseSeat } from './grid';
import { ROLES } from './roles';
import { phaseDurationMs } from './settings';
import type { Cell, DeathCause, GameState, LogAudience, LogTag, PhaseKind, PlayerState, SeatId } from './types';

export function getPlayer(s: GameState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

export function isActive(p: PlayerState): boolean {
  return p.status === 'alive';
}

export function activePlayers(s: GameState): PlayerState[] {
  return s.players.filter(isActive);
}

/** Whoever sits in a seat, living or dead. */
export function occupantOf(s: GameState, seat: SeatId): PlayerState | undefined {
  return s.players.find((p) => p.seat === seat);
}

export function emptySeats(s: GameState): SeatId[] {
  const taken = new Set(s.players.map((p) => p.seat));
  return allSeats(s.cabin.rows).filter((id) => !taken.has(id));
}

export function cellOf(p: PlayerState): Cell {
  const cell = p.seat ? parseSeat(p.seat) : null;
  if (!cell) throw new Error(`${p.name} has no seat`);
  return cell;
}

export function newId(s: GameState): number {
  return s.nextId++;
}

export function addLog(
  s: GameState,
  now: number,
  to: LogAudience,
  tag: LogTag,
  text: string,
  data?: Record<string, unknown>,
): void {
  s.log.push({ id: newId(s), t: now, night: s.phase.night, phase: s.phase.kind, to, tag, text, ...(data ? { data } : {}) });
}

export function setPhase(s: GameState, kind: PhaseKind, now: number): void {
  s.phase = { kind, night: s.phase.night, startedAt: now, endsAt: now + phaseDurationMs(s.settings, kind), earlyEndAt: null };
}

/** Name plus role once the role is public. */
export function label(p: PlayerState): string {
  return p.revealed ? `${p.name} (${ROLES[p.role].name})` : p.name;
}

export function removeFromPlay(s: GameState, p: PlayerState, cause: DeathCause, night: number): void {
  p.status = cause === 'restrained' ? 'restrained' : 'dead';
  p.cause = cause;
  p.outNight = night;
  p.poisonedNight = null;
  if (cause === 'restrained') p.seat = null;
  if (s.settings.revealRoles) p.revealed = true;
}
```

```ts file=src/engine/setup.ts
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/engine/setup.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/state.ts src/engine/setup.ts src/engine/setup.test.ts
git commit -m "feat(engine): game setup, role dealing and state helpers"
```

---

### Task 6: Rules, night, day, wins and the phase engine

These modules depend on each other (the engine drives night and day), so they are tested together through the public flow.

**Files:**
- Create: `src/engine/rules.ts`, `src/engine/night.ts`, `src/engine/day.ts`, `src/engine/win.ts`, `src/engine/engine.ts`, `src/engine/testkit.ts`
- Test: `src/engine/night.test.ts`, `src/engine/day.test.ts`, `src/engine/win.test.ts`, `src/engine/engine.test.ts`

- [ ] **Step 1: Write the test kit**

```ts file=src/engine/testkit.ts
import { phaseDue, tick } from './engine';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { getPlayer } from './state';
import type { DestinationId, GameState, Look, PhaseKind, PlayerState, RoleId, SeatId, Settings } from './types';

export const TEST_LOOK: Look = { body: 0, skin: 0, hair: 0, hairColor: 0, top: 0, bottom: 0 };

export interface TestPlayer {
  id: string;
  role: RoleId;
  seat: SeatId;
}

/** A game at takeoff with exactly these roles and seats (an 8-row cabin unless more players). */
export function makeGame(
  players: TestPlayer[],
  opts: { destination?: DestinationId; settings?: Partial<Settings> } = {},
): GameState {
  const settings: Settings = {
    ...defaultSettings(),
    maxPassengers: Math.max(8, players.length),
    destination: opts.destination ?? 'LHR',
    ...opts.settings,
  };
  const s = createGame({
    settings,
    players: players.map((tp) => ({ id: tp.id, name: tp.id, look: TEST_LOOK })),
    seed: 1,
    now: 0,
  });
  for (const tp of players) {
    const p = getPlayer(s, tp.id)!;
    p.role = tp.role;
    p.seat = tp.seat;
  }
  return s;
}

/** Let the current phase run out; returns the new phase kind. */
export function endPhase(s: GameState): PhaseKind {
  tick(s, phaseDue(s));
  return s.phase.kind;
}

/** Run phases until `kind` (optionally of a given night) starts. */
export function advanceTo(s: GameState, kind: PhaseKind, night?: number): void {
  for (let i = 0; i < 60; i++) {
    if (s.phase.kind === kind && (night === undefined || s.phase.night === night)) return;
    if (s.phase.kind === 'ended') break;
    endPhase(s);
  }
  throw new Error(`Never reached ${kind}${night === undefined ? '' : ` of night ${night}`}; stuck in ${s.phase.kind}`);
}

export function player(s: GameState, id: string): PlayerState {
  const p = getPlayer(s, id);
  if (!p) throw new Error(`No player ${id}`);
  return p;
}

/** Texts of log entries addressed to `to` ('all', 'end', 'saboteurs' or a player id). */
export function logTexts(s: GameState, to: string): string[] {
  return s.log.filter((e) => e.to === to || (Array.isArray(e.to) && e.to.includes(to))).map((e) => e.text);
}
```

- [ ] **Step 2: Write the failing night tests**

```ts file=src/engine/night.test.ts
import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, NightAction } from './types';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: string) => applyIntent(s, id, { kind: 'move', to }, 0);

/** One bomber among six passengers in an 8-row cabin. */
function cabin(): GameState {
  return makeGame([
    { id: 'bomber', role: 'bomber', seat: '4B' },
    { id: 'near1', role: 'passenger', seat: '5C' },
    { id: 'near2', role: 'passenger', seat: '6A' },
    { id: 'far', role: 'passenger', seat: '4E' },
    { id: 'nurse', role: 'nurse', seat: '1F' },
    { id: 'pilot', role: 'pilot', seat: '8F' },
    { id: 'inv', role: 'investigator', seat: '2E' },
  ]);
}

describe('bombs', () => {
  it('a seat bomb with fuse 1 goes off at the end of the next night, and the bomber can flee', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].exploded).toBe(false);
    expect(player(s, 'near1').status).toBe('alive');
    advanceTo(s, 'night_move', 2);
    expect(move(s, 'bomber', '1A')).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(s.bombs[0].exploded).toBe(true);
    expect(player(s, 'near1').status).toBe('dead');
    expect(player(s, 'near2').status).toBe('dead');
    expect(player(s, 'far').status).toBe('alive');
    expect(player(s, 'bomber').status).toBe('alive');
    expect(logTexts(s, 'all').some((t) => t.startsWith('BOOM! A bomb went off under seat 4B.'))).toBe(true);
    expect(s.cabin.scorched).toEqual([{ row: 4, col: 1 }]);
  });

  it('a bomber buckled in by the Pilot cannot flee their own bomb', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'bomber' }, 0)).toEqual({ ok: true });
    expect(move(s, 'bomber', '1A')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 2);
    expect(player(s, 'bomber').seat).toBe('4B');
    expect(logTexts(s, 'bomber').some((t) => t.includes('seatbelt sign lit up'))).toBe(true);
    expect(act(s, 'bomber', null).ok).toBe(false);
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'bomber').status).toBe('dead');
    expect(s.result).toMatchObject({ winner: 'passengers', reason: 'eliminated' });
  });

  it('a fuse of 2 waits two nights', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1A');
    advanceTo(s, 'dawn', 2);
    expect(s.bombs[0].exploded).toBe(false);
    advanceTo(s, 'dawn', 3);
    expect(s.bombs[0].exploded).toBe(true);
    expect(player(s, 'near1').status).toBe('dead');
  });

  it('each bomber gets one bomb per game', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You already used your bomb.' });
  });

  it('cart and lavatory bombs require sitting next to them', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 }).ok).toBe(false);
    expect(act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 1 }).ok).toBe(false);
  });

  it('a cart bomb goes off wherever the Stewardess rolled the cart', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '2C' },
      { id: 'stew', role: 'stewardess_loyal', seat: '8A' },
      { id: 'target', role: 'passenger', seat: '6E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '3F' },
      { id: 'p3', role: 'passenger', seat: '8F' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 1 })).toEqual({ ok: true });
    expect(act(s, 'stew', { kind: 'serve', target: 'target' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(s.cabin.cartRow).toBe(6);
    advanceTo(s, 'dawn', 2);
    expect(s.cabin.cartDestroyed).toBe(true);
    expect(player(s, 'target').status).toBe('dead');
    expect(player(s, 'stew').status).toBe('alive');
    expect(player(s, 'bomber').status).toBe('alive');
    expect(player(s, 'p3').status).toBe('alive');
  });

  it('a lavatory bomb destroys the lavatory and hits the back rows', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '8B' },
      { id: 'back', role: 'passenger', seat: '7D' },
      { id: 'safe', role: 'passenger', seat: '8E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '2A' },
      { id: 'p3', role: 'passenger', seat: '3A' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'lavatory', fuse: 1 })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1B');
    advanceTo(s, 'dawn', 2);
    expect(s.cabin.lavatoryDestroyed).toBe(true);
    expect(player(s, 'back').status).toBe('dead');
    expect(player(s, 'safe').status).toBe('alive');
    expect(player(s, 'bomber').status).toBe('alive');
  });

  it('the Nurse must sit next to a patient, and treatment survives a blast', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    expect(act(s, 'nurse', { kind: 'treat', target: 'near1' }).ok).toBe(false);
    advanceTo(s, 'night_move', 2);
    move(s, 'bomber', '1A');
    move(s, 'nurse', '5B');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'nurse', { kind: 'treat', target: 'near1' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'near1').status).toBe('alive');
    expect(player(s, 'nurse').status).toBe('dead');
    expect(logTexts(s, 'near1').some((t) => t.includes('kept you alive'))).toBe(true);
  });
});

describe('poison', () => {
  function poisonCabin(): GameState {
    return makeGame([
      { id: 'rogue', role: 'stewardess_rogue', seat: '1A' },
      { id: 'bomber', role: 'bomber', seat: '1F' },
      { id: 'victim', role: 'passenger', seat: '5E' },
      { id: 'nurse', role: 'nurse', seat: '7A' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '3F' },
      { id: 'p3', role: 'passenger', seat: '8F' },
    ]);
  }

  it('kills at the second dawn unless the Nurse treats the victim', () => {
    const s = poisonCabin();
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'rogue', { kind: 'serve', target: 'victim' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'victim').poisonedNight).toBe(1);
    expect(logTexts(s, 'victim').some((t) => t.startsWith('You feel sick'))).toBe(true);
    expect(s.cabin.cartRow).toBe(5);
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'victim').status).toBe('dead');
    expect(player(s, 'victim').cause).toBe('poison');
  });

  it('is cured by a treatment the next night', () => {
    const s = poisonCabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'rogue', { kind: 'serve', target: 'victim' });
    advanceTo(s, 'night_move', 2);
    move(s, 'nurse', '5F');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'nurse', { kind: 'treat', target: 'victim' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'victim').status).toBe('alive');
    expect(player(s, 'victim').poisonedNight).toBeNull();
  });

  it('fails when the victim is treated the same night', () => {
    const s = poisonCabin();
    advanceTo(s, 'night_move', 1);
    move(s, 'nurse', '5F');
    advanceTo(s, 'night_act', 1);
    act(s, 'rogue', { kind: 'serve', target: 'victim' });
    act(s, 'nurse', { kind: 'treat', target: 'victim' });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'victim').poisonedNight).toBeNull();
    expect(logTexts(s, 'victim').some((t) => t.includes('neutralized'))).toBe(true);
  });
});

describe('investigation', () => {
  it('a sweep finds seat bombs within 1, including ones planted the same night', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '5D' },
      { id: 'inv', role: 'investigator', seat: '4E' },
      { id: 'p1', role: 'passenger', seat: '1A' },
      { id: 'p2', role: 'passenger', seat: '2A' },
      { id: 'p3', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'inv', { kind: 'sweep' });
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'inv').knownBombIds).toEqual([s.bombs[0].id]);
    expect(logTexts(s, 'inv').some((t) => t.includes('under seat 5D'))).toBe(true);
  });

  it('inspecting the cart needs adjacency and finds cart bombs', () => {
    const s = makeGame([
      { id: 'bomber', role: 'bomber', seat: '2C' },
      { id: 'inv', role: 'investigator', seat: '3E' },
      { id: 'p1', role: 'passenger', seat: '6A' },
      { id: 'p2', role: 'passenger', seat: '7A' },
      { id: 'p3', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'inv', { kind: 'inspect', what: 'cart' }).ok).toBe(false);
    act(s, 'bomber', { kind: 'plant', where: 'cart', fuse: 2 });
    advanceTo(s, 'night_move', 2);
    move(s, 'inv', '2D');
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'inv', { kind: 'inspect', what: 'cart' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'inv').knownBombIds).toHaveLength(1);
  });

  it('the loyal Stewardess learns teams, and the Mastermind passes as a passenger', () => {
    const s = makeGame([
      { id: 'stew', role: 'stewardess_loyal', seat: '1A' },
      { id: 'mm', role: 'mastermind', seat: '3C' },
      { id: 'bomber', role: 'bomber', seat: '6F' },
      { id: 'p1', role: 'passenger', seat: '4A' },
      { id: 'p2', role: 'passenger', seat: '5A' },
      { id: 'p3', role: 'passenger', seat: '7A' },
      { id: 'p4', role: 'passenger', seat: '8A' },
    ]);
    advanceTo(s, 'night_act', 1);
    act(s, 'stew', { kind: 'serve', target: 'mm' });
    advanceTo(s, 'night_act', 2);
    act(s, 'stew', { kind: 'serve', target: 'bomber' });
    advanceTo(s, 'dawn', 2);
    const results = logTexts(s, 'stew').filter((t) => t.startsWith('You served'));
    expect(results[0]).toContain('Passenger team');
    expect(results[1]).toContain('Saboteur team');
  });
});

describe('moving seats and the seatbelt sign', () => {
  it('a seat can only be taken if it was empty, and ties are settled at random', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'far', '4B').ok).toBe(false);
    expect(move(s, 'near1', '2A')).toEqual({ ok: true });
    expect(move(s, 'near2', '2A')).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    const winners = ['near1', 'near2'].filter((id) => player(s, id).seat === '2A');
    expect(winners).toHaveLength(1);
    const loser = winners[0] === 'near1' ? 'near2' : 'near1';
    expect(logTexts(s, loser).some((t) => t.startsWith('Someone beat you to 2A'))).toBe(true);
  });

  it('the Pilot cannot buckle themselves or the same passenger two nights running', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'pilot' }, 0).ok).toBe(false);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'far' }, 0)).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'far' }, 0).ok).toBe(false);
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'near1' }, 0)).toEqual({ ok: true });
  });
});

describe('destination twists', () => {
  const crew = (): TestPlayer[] => [
    { id: 'bomber', role: 'bomber', seat: '4B' },
    { id: 'p1', role: 'passenger', seat: '1A' },
    { id: 'p2', role: 'passenger', seat: '2A' },
    { id: 'p3', role: 'passenger', seat: '3A' },
    { id: 'p4', role: 'passenger', seat: '5A' },
  ];

  it('Honolulu buckles a random passenger in at the start of each night', () => {
    const s = makeGame(crew(), { destination: 'HNL' });
    advanceTo(s, 'night_move', 1);
    const buckled = Object.keys(s.night.buckled);
    expect(buckled).toHaveLength(1);
    expect(s.night.buckled[buckled[0]]).toBe('turbulence');
    expect(move(s, buckled[0], '8F').ok).toBe(false);
    expect(logTexts(s, 'all').some((t) => t.startsWith('Turbulence!'))).toBe(true);
  });

  it('Bermuda can send the cart rolling or black out the seat map', () => {
    const s = makeGame(crew(), { destination: 'BDA' });
    advanceTo(s, 'night_move', 1);
    s.night.anomaly = 'runaway_cart';
    s.night.buckled = {};
    advanceTo(s, 'dawn', 1);
    expect(logTexts(s, 'all').some((t) => t.includes('broke loose'))).toBe(true);
    advanceTo(s, 'night_move', 2);
    s.night.anomaly = 'blackout';
    s.night.buckled = {};
    advanceTo(s, 'dawn', 2);
    expect(s.blackoutNight).toBe(2);
  });
});
```

- [ ] **Step 3: Write the failing day, win and engine tests**

```ts file=src/engine/day.test.ts
import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, makeGame, player } from './testkit';
import type { GameState } from './types';

const vote = (s: GameState, voter: string, target: string) => applyIntent(s, voter, { kind: 'vote', target }, 0);

function jury(): GameState {
  return makeGame([
    { id: 'b1', role: 'bomber', seat: '1A' },
    { id: 'b2', role: 'bomber', seat: '1F' },
    { id: 'p1', role: 'passenger', seat: '3A' },
    { id: 'p2', role: 'passenger', seat: '4A' },
    { id: 'p3', role: 'passenger', seat: '5A' },
    { id: 'p4', role: 'passenger', seat: '6A' },
    { id: 'p5', role: 'passenger', seat: '7A' },
  ]);
}

describe('day vote', () => {
  it('restrains the leader only when they beat Skip, and reveals their role', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3', 'p4']) expect(vote(s, v, 'b1')).toEqual({ ok: true });
    advanceTo(s, 'verdict', 1);
    const b1 = player(s, 'b1');
    expect(b1.status).toBe('restrained');
    expect(b1.seat).toBeNull();
    expect(b1.revealed).toBe(true);
    expect(s.verdict).toMatchObject({ restrained: 'b1', tally: { b1: 4, skip: 3 } });
  });

  it('non-votes count as Skip', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) vote(s, v, 'b1');
    advanceTo(s, 'verdict', 1);
    expect(s.verdict?.restrained).toBeNull();
    expect(player(s, 'b1').status).toBe('alive');
  });

  it('a tie restrains no one', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) vote(s, v, 'b1');
    for (const v of ['p4', 'p5', 'b1']) vote(s, v, 'b2');
    advanceTo(s, 'verdict', 1);
    expect(s.verdict?.restrained).toBeNull();
  });

  it('you cannot vote for yourself or for someone out of play', () => {
    const s = jury();
    advanceTo(s, 'day_vote', 1);
    expect(vote(s, 'p1', 'p1').ok).toBe(false);
    expect(vote(s, 'p1', 'nobody').ok).toBe(false);
    expect(vote(s, 'p1', 'skip')).toEqual({ ok: true });
  });
});
```

```ts file=src/engine/win.test.ts
import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, endPhase, makeGame, player } from './testkit';
import type { DestinationId, GameState } from './types';
import { checkWin } from './win';

function flight(destination: DestinationId = 'LHR'): GameState {
  return makeGame(
    [
      { id: 'b1', role: 'bomber', seat: '1A' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '4A' },
      { id: 'p3', role: 'passenger', seat: '5A' },
    ],
    { destination },
  );
}

describe('win conditions', () => {
  it('passengers win once every saboteur is out', () => {
    const s = flight();
    advanceTo(s, 'day_vote', 1);
    for (const v of ['p1', 'p2', 'p3']) applyIntent(s, v, { kind: 'vote', target: 'b1' }, 0);
    advanceTo(s, 'verdict', 1);
    expect(s.result).toMatchObject({ winner: 'passengers', reason: 'eliminated' });
    expect(endPhase(s)).toBe('ended');
  });

  it('saboteurs win at parity', () => {
    const s = flight();
    player(s, 'p1').status = 'dead';
    player(s, 'p2').status = 'dead';
    expect(checkWin(s)).toMatchObject({ winner: 'saboteurs', reason: 'parity' });
  });

  it('nobody left is a draw', () => {
    const s = flight();
    for (const p of s.players) p.status = 'dead';
    expect(checkWin(s)).toMatchObject({ winner: 'draw', reason: 'no_survivors' });
  });

  it('saboteurs still aboard at landing win', () => {
    const s = flight('LAS');
    advanceTo(s, 'verdict', 3);
    expect(endPhase(s)).toBe('ended');
    expect(s.result).toMatchObject({ winner: 'saboteurs', reason: 'landed' });
  });
});
```

```ts file=src/engine/engine.test.ts
import { describe, expect, it } from 'vitest';
import { applyIntent, tick } from './engine';
import { advanceTo, endPhase, makeGame, player } from './testkit';
import type { ChatChannel, GameState, Settings } from './types';

function smallFlight(settings: Partial<Settings> = {}): GameState {
  return makeGame(
    [
      { id: 'bomber', role: 'bomber', seat: '1A' },
      { id: 'pilot', role: 'pilot', seat: '2A' },
      { id: 'p1', role: 'passenger', seat: '3A' },
      { id: 'p2', role: 'passenger', seat: '3B' },
      { id: 'p3', role: 'passenger', seat: '7F' },
    ],
    { settings },
  );
}

const say = (s: GameState, id: string, channel: ChatChannel, text: string, t: number) =>
  applyIntent(s, id, { kind: 'chat', channel, text }, t);

describe('phase flow', () => {
  it('takeoff lasts 12 seconds, then the lights go out', () => {
    const s = smallFlight();
    expect(tick(s, 11_999)).toBe(false);
    expect(tick(s, 12_000)).toBe(true);
    expect(s.phase).toMatchObject({ kind: 'night_move', night: 1, startedAt: 12_000, endsAt: 32_000 });
  });

  it('a phase ends 3 seconds after everyone has submitted', () => {
    const s = smallFlight();
    advanceTo(s, 'night_move', 1);
    const t = s.phase.startedAt + 1000;
    for (const id of ['bomber', 'pilot', 'p1', 'p2', 'p3']) applyIntent(s, id, { kind: 'move', to: 'stay' }, t);
    expect(s.phase.earlyEndAt).toBeNull();
    applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'none' }, t);
    expect(s.phase.earlyEndAt).toBe(t + 3000);
    expect(tick(s, t + 3000)).toBe(true);
    expect(s.phase.kind).toBe('night_act');
  });

  it('every passenger must press Done at night, even without an ability', () => {
    const s = smallFlight();
    advanceTo(s, 'night_act', 1);
    for (const id of ['bomber', 'pilot', 'p1', 'p2']) applyIntent(s, id, { kind: 'act', action: null }, s.phase.startedAt);
    expect(s.phase.earlyEndAt).toBeNull();
    applyIntent(s, 'p3', { kind: 'act', action: null }, s.phase.startedAt);
    expect(s.phase.earlyEndAt).not.toBeNull();
  });

  it('"after incident" mode skips the vote after a quiet night', () => {
    const s = smallFlight({ voteMode: 'afterIncident' });
    advanceTo(s, 'day_discuss', 1);
    expect(endPhase(s)).toBe('night_move');
    expect(s.phase.night).toBe(2);
  });

  it('rejects input from players who are out or not aboard', () => {
    const s = smallFlight();
    advanceTo(s, 'night_move', 1);
    player(s, 'p3').status = 'dead';
    expect(applyIntent(s, 'p3', { kind: 'move', to: 'stay' }, 0).ok).toBe(false);
    expect(applyIntent(s, 'ghost', { kind: 'move', to: 'stay' }, 0).ok).toBe(false);
  });
});

describe('chat', () => {
  it('the cabin is silent at night; saboteurs have their own channel', () => {
    const s = smallFlight();
    advanceTo(s, 'night_move', 1);
    expect(say(s, 'p1', 'cabin', 'hello', 0).ok).toBe(false);
    expect(say(s, 'bomber', 'saboteurs', 'row 3 looks crowded', 0)).toEqual({ ok: true });
    expect(say(s, 'p1', 'saboteurs', 'let me in', 0).ok).toBe(false);
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    expect(say(s, 'p1', 'cabin', 'who moved?', t)).toEqual({ ok: true });
    expect(say(s, 'bomber', 'saboteurs', 'shh', t).ok).toBe(false);
  });

  it('rate-limits and caps message length', () => {
    const s = smallFlight();
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    expect(say(s, 'p1', 'cabin', 'one', t)).toEqual({ ok: true });
    expect(say(s, 'p1', 'cabin', 'two', t + 500).ok).toBe(false);
    expect(say(s, 'p1', 'cabin', 'x'.repeat(201), t + 2000).ok).toBe(false);
    expect(say(s, 'p1', 'cabin', '   ', t + 3000).ok).toBe(false);
  });

  it('ghosts talk among themselves', () => {
    const s = smallFlight();
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    player(s, 'p3').status = 'dead';
    expect(say(s, 'p3', 'cabin', 'boo', t).ok).toBe(false);
    expect(say(s, 'p3', 'ghosts', 'boo', t)).toEqual({ ok: true });
    expect(say(s, 'p1', 'ghosts', 'hi', t).ok).toBe(false);
  });

  it('whispers reach seats within 2 during the day', () => {
    const s = smallFlight();
    advanceTo(s, 'day_discuss', 1);
    const t = s.phase.startedAt;
    expect(applyIntent(s, 'p1', { kind: 'whisper', to: 'p2', text: 'psst' }, t)).toEqual({ ok: true });
    expect(applyIntent(s, 'p2', { kind: 'whisper', to: 'p3', text: 'too far' }, t).ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `npx vitest run src/engine/night.test.ts src/engine/day.test.ts src/engine/win.test.ts src/engine/engine.test.ts`
Expected: FAIL — cannot resolve `./engine`.

- [ ] **Step 5: Implement validation rules**

```ts file=src/engine/rules.ts
import { cartCell, distance, distanceToAny, isSeatInCabin, lavatoryCells } from './grid';
import { canPlantBombs, isStewardess } from './roles';
import { activePlayers, cellOf, getPlayer, isActive, occupantOf } from './state';
import type { GameState, NightAction, PlayerState, SeatId } from './types';

export function checkMove(s: GameState, p: PlayerState, to: SeatId | 'stay'): string | null {
  if (to === 'stay') return null;
  if (typeof to !== 'string' || !isSeatInCabin(to, s.cabin.rows)) return 'That seat does not exist.';
  if (p.seat === to) return 'You are already sitting there.';
  if (occupantOf(s, to)) return 'That seat is taken.';
  return null;
}

export function checkSeatbelt(s: GameState, pilot: PlayerState, target: string): string | null {
  if (target === 'none') return null;
  const t = getPlayer(s, target);
  if (!t || !isActive(t)) return 'Pick someone who is still in play.';
  if (t.id === pilot.id) return 'You cannot buckle yourself in.';
  if (pilot.lastSeatbeltTarget === t.id) return 'You buckled them in last night. Pick someone else.';
  return null;
}

function nextToCart(s: GameState, p: PlayerState): boolean {
  return distance(cellOf(p), cartCell(s.cabin.cartRow)) <= 1;
}

function nextToLavatory(s: GameState, p: PlayerState): boolean {
  return distanceToAny(cellOf(p), lavatoryCells(s.cabin.rows)) <= 1;
}

export function checkAction(s: GameState, p: PlayerState, action: NightAction): string | null {
  switch (action?.kind) {
    case 'treat': {
      if (p.role !== 'nurse') return 'Only the Nurse can treat people.';
      const t = getPlayer(s, action.target);
      if (!t || !isActive(t)) return 'Pick someone who is still in play.';
      if (t.id === p.id) return p.selfTreatUsed ? 'You already treated yourself once.' : null;
      if (distance(cellOf(p), cellOf(t)) > 1) return `${t.name} is too far away. Sit next to them first.`;
      return null;
    }
    case 'sweep':
      return p.role === 'investigator' ? null : 'Only the Investigator can sweep for bombs.';
    case 'inspect': {
      if (p.role !== 'investigator') return 'Only the Investigator can inspect.';
      if (action.what === 'cart') {
        if (s.cabin.cartDestroyed) return 'The drink cart is gone.';
        if (!nextToCart(s, p)) return 'You must be sitting next to the drink cart.';
        return null;
      }
      if (action.what === 'lavatory') {
        if (s.cabin.lavatoryDestroyed) return 'The lavatory is destroyed.';
        if (!nextToLavatory(s, p)) return 'You must be sitting next to the lavatory.';
        return null;
      }
      return 'Inspect the cart or the lavatory.';
    }
    case 'serve': {
      if (!isStewardess(p.role)) return 'Only the Stewardess serves drinks.';
      const t = getPlayer(s, action.target);
      if (!t || !isActive(t)) return 'Pick someone who is still in play.';
      if (t.id === p.id) return 'You cannot serve yourself.';
      return null;
    }
    case 'plant': {
      if (!canPlantBombs(p.role)) return 'You have no bomb.';
      if (p.bombUsed) return 'You already used your bomb.';
      if (action.fuse !== 1 && action.fuse !== 2) return 'The fuse must be 1 or 2 nights.';
      if (action.where === 'cart') {
        if (s.cabin.cartDestroyed) return 'The drink cart is gone.';
        if (!nextToCart(s, p)) return 'You must be in an aisle seat next to the drink cart.';
        return null;
      }
      if (action.where === 'lavatory') {
        if (s.cabin.lavatoryDestroyed) return 'The lavatory is destroyed.';
        if (!nextToLavatory(s, p)) return 'You must be in a seat next to the lavatory.';
        return null;
      }
      return action.where === 'seat' ? null : 'Unknown place to plant a bomb.';
    }
    default:
      return 'Unknown action.';
  }
}

/** Every legal action for a player right now (bots and the TV UI use this). */
export function possibleActions(s: GameState, p: PlayerState): NightAction[] {
  const candidates: NightAction[] = [];
  const everyone = activePlayers(s);
  switch (p.role) {
    case 'nurse':
      for (const t of everyone) candidates.push({ kind: 'treat', target: t.id });
      break;
    case 'investigator':
      candidates.push({ kind: 'sweep' }, { kind: 'inspect', what: 'cart' }, { kind: 'inspect', what: 'lavatory' });
      break;
    case 'stewardess_loyal':
    case 'stewardess_rogue':
      for (const t of everyone) candidates.push({ kind: 'serve', target: t.id });
      break;
    case 'bomber':
    case 'mastermind':
      for (const where of ['seat', 'cart', 'lavatory'] as const) {
        for (const fuse of [1, 2] as const) candidates.push({ kind: 'plant', where, fuse });
      }
      break;
    default:
      break;
  }
  return candidates.filter((a) => checkAction(s, p, a) === null);
}
```

- [ ] **Step 6: Implement the night**

```ts file=src/engine/night.ts
import { DESTINATIONS } from './destinations';
import { BLAST_RADIUS, SWEEP_RADIUS, cartCell, distance, lavatoryCells, parseSeat, seatOrder, seatsWithin } from './grid';
import { nextInt, pick } from './rng';
import { ROLES, apparentTeam } from './roles';
import { checkAction, checkMove, checkSeatbelt } from './rules';
import { phaseDurationMs } from './settings';
import { emptyDay, emptyNight } from './setup';
import { activePlayers, addLog, cellOf, getPlayer, label, newId, removeFromPlay } from './state';
import type { Anomaly, Bomb, BombLocation, Cell, GameState, NightAction, PlayerState, SeatId } from './types';

const ANOMALIES: readonly Anomaly[] = ['turbulence', 'runaway_cart', 'blackout'];

export function describeLocation(loc: BombLocation, cartRow?: number): string {
  switch (loc.kind) {
    case 'seat':
      return `under seat ${loc.seat}`;
    case 'cart':
      return cartRow ? `on the drink cart at row ${cartRow}` : 'on the drink cart';
    case 'lavatory':
      return 'in the lavatory';
  }
}

function fuseText(bomb: Bomb, night: number): string {
  const left = bomb.detonateNight - night;
  if (left <= 0) return 'about to go off';
  if (left === 1) return 'set to go off at the end of tomorrow night';
  return `set to go off in ${left} nights`;
}

/** Lights out: start night `night` (moves and seatbelts), applying destination twists. */
export function startNight(s: GameState, night: number, now: number): void {
  s.phase = { kind: 'night_move', night, startedAt: now, endsAt: now + phaseDurationMs(s.settings, 'night_move'), earlyEndAt: null };
  s.night = emptyNight();
  s.day = emptyDay();
  s.incidentAtDawn = false;
  const twist = DESTINATIONS[s.settings.destination].twist;
  if (twist === 'triangle') s.night.anomaly = pick(s, ANOMALIES);
  if (twist === 'turbulence' || s.night.anomaly === 'turbulence') {
    const candidates = activePlayers(s);
    if (candidates.length > 0) {
      const victim = pick(s, candidates);
      s.night.buckled[victim.id] = 'turbulence';
      addLog(s, now, 'all', 'turbulence', `Turbulence! The seatbelt sign locked ${victim.name} (${victim.seat}) in for the night.`, {
        player: victim.id,
      });
    }
  }
}

/** End of night_move: the Pilot's seatbelts apply first, then every seat change at once. */
export function resolveMoves(s: GameState, now: number): void {
  const n = s.phase.night;
  const turbulence = new Set(Object.keys(s.night.buckled));
  for (const pilot of activePlayers(s).filter((p) => p.role === 'pilot')) {
    const choice = s.night.seatbelts[pilot.id];
    if (turbulence.has(pilot.id) || !choice || choice === 'none') {
      pilot.lastSeatbeltTarget = null;
      continue;
    }
    const error = checkSeatbelt(s, pilot, choice);
    if (error) {
      pilot.lastSeatbeltTarget = null;
      addLog(s, now, [pilot.id], 'fizzle', `The seatbelt sign did not come on: ${error}`);
      continue;
    }
    const target = getPlayer(s, choice)!;
    pilot.lastSeatbeltTarget = target.id;
    s.night.buckled[target.id] ??= 'pilot';
    addLog(s, now, [pilot.id], 'seatbelt', `You turned on the seatbelt sign for ${target.name} (${target.seat}).`);
    addLog(s, now, [target.id], 'buckled', 'Ding. The seatbelt sign lit up over your seat. You are stuck here tonight and cannot use an ability.');
    addLog(s, now, 'end', 'seatbelt', `Night ${n}: Pilot ${pilot.name} buckled in ${target.name}.`);
  }

  const claims = new Map<SeatId, PlayerState[]>();
  for (const p of activePlayers(s)) {
    const to = s.night.moves[p.id];
    if (!to || to === 'stay' || s.night.buckled[p.id]) continue;
    if (checkMove(s, p, to) !== null) continue;
    claims.set(to, [...(claims.get(to) ?? []), p]);
  }
  for (const seat of [...claims.keys()].sort((a, b) => seatOrder(a) - seatOrder(b))) {
    const claimants = claims.get(seat)!;
    const winner = claimants.length === 1 ? claimants[0] : pick(s, claimants);
    const from = winner.seat;
    winner.seat = seat;
    addLog(s, now, 'end', 'move', `Night ${n}: ${winner.name} moved from ${from} to ${seat}.`, { player: winner.id, from, to: seat });
    for (const loser of claimants) {
      if (loser !== winner) addLog(s, now, [loser.id], 'bumped', `Someone beat you to ${seat}. You stayed in ${loser.seat}.`);
    }
  }
}

interface Acting {
  actor: PlayerState;
  action: NightAction;
}

/** End of night_act: everything that happens in the dark, in the spec's order. */
export function resolveNight(s: GameState, now: number): void {
  const n = s.phase.night;
  const rows = s.cabin.rows;
  const cartRowAtAct = s.cabin.cartRow;

  // 1. Only valid actions from active, unbuckled players count.
  const acts: Acting[] = [];
  for (const actor of activePlayers(s)) {
    const action = s.night.actions[actor.id];
    if (!action || s.night.buckled[actor.id]) continue;
    const error = checkAction(s, actor, action);
    if (error) {
      addLog(s, now, [actor.id], 'fizzle', `Your action failed: ${error}`);
      continue;
    }
    acts.push({ actor, action });
  }
  acts.sort((a, b) => seatOrder(a.actor.seat!) - seatOrder(b.actor.seat!));
  const playerById = (id: string) => getPlayer(s, id)!;

  // 2. Treatments.
  const treated = new Set<string>();
  for (const { actor, action } of acts) {
    if (action.kind !== 'treat') continue;
    const t = playerById(action.target);
    treated.add(t.id);
    if (t.id === actor.id) actor.selfTreatUsed = true;
    addLog(s, now, [actor.id], 'treat', t.id === actor.id ? 'You treated yourself tonight.' : `You treated ${t.name} (${t.seat}).`);
    addLog(s, now, 'end', 'treat', `Night ${n}: Nurse ${actor.name} treated ${t.name}.`);
  }

  // 3. Bombs are planted.
  for (const { actor, action } of acts) {
    if (action.kind !== 'plant') continue;
    const location: BombLocation = action.where === 'seat' ? { kind: 'seat', seat: actor.seat! } : { kind: action.where };
    const bomb: Bomb = {
      id: `bomb${newId(s)}`,
      planterId: actor.id,
      location,
      plantedNight: n,
      detonateNight: n + action.fuse,
      exploded: false,
      explodedAt: null,
    };
    s.bombs.push(bomb);
    actor.bombUsed = true;
    const where = describeLocation(location);
    addLog(s, now, 'saboteurs', 'plant', `${actor.name} planted a bomb ${where}. It goes off at the end of night ${bomb.detonateNight}.`, {
      bomb: bomb.id,
    });
    addLog(s, now, 'end', 'plant', `Night ${n}: ${ROLES[actor.role].name} ${actor.name} planted a bomb ${where} (fuse ${action.fuse}).`);
  }

  // 4. Poisoned drinks.
  for (const { actor, action } of acts) {
    if (action.kind !== 'serve' || actor.role !== 'stewardess_rogue') continue;
    const t = playerById(action.target);
    addLog(s, now, [actor.id], 'serve', `You served ${t.name} (${t.seat}) a poisoned drink.`);
    if (treated.has(t.id)) {
      addLog(s, now, [t.id], 'saved', 'Someone slipped poison into your drink, but the treatment you got tonight neutralized it.');
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}, but the Nurse's treatment neutralized it.`);
    } else {
      if (t.poisonedNight === null) t.poisonedNight = n;
      addLog(s, now, 'end', 'poison', `Night ${n}: ${actor.name} poisoned ${t.name}.`);
    }
  }

  // 5. Investigations (the cart is where it stood during night_act).
  const live = s.bombs.filter((b) => !b.exploded);
  for (const { actor, action } of acts) {
    if (action.kind !== 'sweep' && action.kind !== 'inspect') continue;
    let found: Bomb[];
    let what: string;
    if (action.kind === 'sweep') {
      const here = cellOf(actor);
      found = live.filter((b) => b.location.kind === 'seat' && distance(parseSeat(b.location.seat)!, here) <= SWEEP_RADIUS);
      what = `the seats around ${actor.seat}`;
    } else {
      found = live.filter((b) => b.location.kind === action.what);
      what = action.what === 'cart' ? `the drink cart at row ${cartRowAtAct}` : 'the lavatory';
    }
    for (const b of found) if (!actor.knownBombIds.includes(b.id)) actor.knownBombIds.push(b.id);
    const text =
      found.length === 0
        ? `You checked ${what}. No bombs.`
        : `You checked ${what} and found ${found.length === 1 ? 'a bomb' : `${found.length} bombs`}: ${found
            .map((b) => `${describeLocation(b.location)}, ${fuseText(b, n)}`)
            .join('; ')}.`;
    addLog(s, now, [actor.id], action.kind, text, { bombs: found.map((b) => b.id) });
    addLog(s, now, 'end', action.kind, `Night ${n}: Investigator ${actor.name} checked ${what}${found.length ? ' and found a bomb' : ''}.`);
  }

  // 6. Loyal results, then the cart rolls to each served row.
  for (const { actor, action } of acts) {
    if (action.kind !== 'serve') continue;
    const t = playerById(action.target);
    if (actor.role === 'stewardess_loyal') {
      const team = apparentTeam(t.role);
      addLog(
        s,
        now,
        [actor.id],
        'serve',
        `You served ${t.name} (${t.seat}). They are on the ${team === 'saboteurs' ? 'Saboteur' : 'Passenger'} team.`,
        { player: t.id, team },
      );
      addLog(s, now, 'end', 'serve', `Night ${n}: Stewardess ${actor.name} checked ${t.name}.`);
    }
    if (!s.cabin.cartDestroyed) s.cabin.cartRow = cellOf(t).row;
  }
  if (s.night.anomaly === 'runaway_cart' && !s.cabin.cartDestroyed) {
    s.cabin.cartRow = 1 + nextInt(s, rows);
    addLog(s, now, 'all', 'anomaly', `In the dark, the drink cart broke loose and rolled to row ${s.cabin.cartRow}.`);
  } else if (s.cabin.cartRow !== cartRowAtAct) {
    addLog(s, now, 'all', 'cart', `The drink cart is now at row ${s.cabin.cartRow}.`);
  }

  // 7. Explosions.
  for (const bomb of s.bombs) {
    if (bomb.exploded || bomb.detonateNight !== n) continue;
    const centers: Cell[] =
      bomb.location.kind === 'seat'
        ? [parseSeat(bomb.location.seat)!]
        : bomb.location.kind === 'cart'
          ? [cartCell(s.cabin.cartRow)]
          : lavatoryCells(rows);
    bomb.exploded = true;
    bomb.explodedAt = centers;
    s.cabin.scorched.push(...centers);
    if (bomb.location.kind === 'cart') s.cabin.cartDestroyed = true;
    if (bomb.location.kind === 'lavatory') s.cabin.lavatoryDestroyed = true;
    s.incidentAtDawn = true;
    const blast = new Set(seatsWithin(centers, BLAST_RADIUS, rows));
    const victims: PlayerState[] = [];
    for (const p of activePlayers(s)) {
      if (!p.seat || !blast.has(p.seat)) continue;
      if (treated.has(p.id)) {
        addLog(s, now, [p.id], 'saved', 'You were caught in the blast, but the treatment you got tonight kept you alive.');
      } else {
        removeFromPlay(s, p, 'explosion', n);
        victims.push(p);
      }
    }
    const where = describeLocation(bomb.location, bomb.location.kind === 'cart' ? s.cabin.cartRow : undefined);
    const casualties = victims.length ? ` Killed: ${victims.map(label).join(', ')}.` : ' Nobody was caught in the blast.';
    addLog(s, now, 'all', 'explosion', `BOOM! A bomb went off ${where}.${casualties}`, {
      bomb: bomb.id,
      cells: centers,
      victims: victims.map((v) => v.id),
    });
  }

  // 8. Poison: last night's victims die unless treated; tonight's victims feel sick.
  for (const p of activePlayers(s)) {
    if (p.poisonedNight === null) continue;
    if (p.poisonedNight < n) {
      if (treated.has(p.id)) {
        p.poisonedNight = null;
        addLog(s, now, [p.id], 'cured', "The Nurse's treatment worked. Your poisoning is cured.");
      } else {
        removeFromPlay(s, p, 'poison', n);
        s.incidentAtDawn = true;
        addLog(s, now, 'all', 'death', `${label(p)} died of poisoning.`, { player: p.id, cause: 'poison' });
      }
    } else {
      addLog(s, now, [p.id], 'sick', 'You feel sick. Your drink was poisoned. Unless the Nurse treats you tomorrow night, you will not survive.');
    }
  }

  // 9. Twists and the quiet-night note.
  if (s.night.anomaly === 'blackout') {
    s.blackoutNight = n;
    addLog(s, now, 'all', 'anomaly', 'The cabin lights failed. The seat map is offline today.');
  }
  if (!s.incidentAtDawn) addLog(s, now, 'all', 'info', 'The night passed quietly.');
}
```

- [ ] **Step 7: Implement the day and win checks**

```ts file=src/engine/day.ts
import { emptyDay } from './setup';
import { activePlayers, addLog, getPlayer, label, removeFromPlay, setPhase } from './state';
import type { GameState } from './types';

export function startDay(s: GameState, now: number): void {
  setPhase(s, 'day_discuss', now);
  s.day = emptyDay();
}

/** Every active player counts once; non-votes and votes for players out of play count as Skip. */
export function tallyVotes(s: GameState): Record<string, number> {
  const tally: Record<string, number> = { skip: 0 };
  for (const p of activePlayers(s)) {
    const vote = s.day.votes[p.id];
    const key = vote && vote !== 'skip' && getPlayer(s, vote)?.status === 'alive' ? vote : 'skip';
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return tally;
}

/** A player is restrained only with strictly the most votes and more votes than Skip. */
export function resolveVote(s: GameState, now: number): void {
  const tally = tallyVotes(s);
  let leader: string | null = null;
  let leaderVotes = 0;
  let tied = false;
  for (const [id, votes] of Object.entries(tally)) {
    if (id === 'skip') continue;
    if (votes > leaderVotes) {
      leader = id;
      leaderVotes = votes;
      tied = false;
    } else if (votes === leaderVotes) {
      tied = true;
    }
  }
  const restrained = leader !== null && !tied && leaderVotes > tally.skip ? getPlayer(s, leader)! : null;
  if (restrained) {
    removeFromPlay(s, restrained, 'restrained', s.phase.night);
    addLog(s, now, 'all', 'verdict', `The passengers restrained ${label(restrained)} and walked them to the rear galley.`, {
      player: restrained.id,
    });
  } else {
    addLog(s, now, 'all', 'verdict', 'No one was restrained.');
  }
  s.verdict = { night: s.phase.night, restrained: restrained?.id ?? null, tally };
}
```

```ts file=src/engine/win.ts
import { DESTINATIONS } from './destinations';
import { isSaboteur } from './roles';
import { activePlayers } from './state';
import type { GameResult, GameState } from './types';

export function checkWin(s: GameState): GameResult | null {
  const active = activePlayers(s);
  const saboteurs = active.filter((p) => isSaboteur(p.role)).length;
  const passengers = active.length - saboteurs;
  const night = s.phase.night;
  if (active.length === 0) return { winner: 'draw', reason: 'no_survivors', night };
  if (saboteurs === 0) return { winner: 'passengers', reason: 'eliminated', night };
  if (saboteurs >= passengers) return { winner: 'saboteurs', reason: 'parity', night };
  return null;
}

/** The plane is on the ground: any saboteur still free walks off. */
export function landingResult(s: GameState): GameResult {
  return checkWin(s) ?? { winner: 'saboteurs', reason: 'landed', night: s.phase.night };
}

export function resultText(s: GameState, r: GameResult): string {
  const city = DESTINATIONS[s.settings.destination].city;
  switch (r.reason) {
    case 'eliminated':
      return 'Every saboteur has been dealt with. Passengers win!';
    case 'parity':
      return 'The saboteurs now outnumber everyone else and take over the plane. Saboteurs win!';
    case 'landed':
      return `Flight 13 landed in ${city} with saboteurs still aboard. They slip away into the terminal. Saboteurs win!`;
    case 'no_survivors':
      return 'Nobody is left. There are no winners on Flight 13.';
  }
}
```

- [ ] **Step 8: Implement the phase engine and chat**

```ts file=src/engine/engine.ts
import { resolveVote, startDay } from './day';
import { DESTINATIONS } from './destinations';
import { WHISPER_RADIUS, distance } from './grid';
import { resolveMoves, resolveNight, startNight } from './night';
import { isSaboteur } from './roles';
import { checkAction, checkMove, checkSeatbelt } from './rules';
import { CHAT_COOLDOWN_MS, CHAT_HISTORY, CHAT_MAX_LENGTH, EARLY_END_GRACE_MS } from './settings';
import { activePlayers, addLog, cellOf, getPlayer, isActive, newId, setPhase } from './state';
import type { ChatChannel, ChatMessage, GameState, Intent, IntentResult, PhaseKind, PlayerState } from './types';
import { checkWin, landingResult, resultText } from './win';

const OK: IntentResult = { ok: true };
const fail = (error: string): IntentResult => ({ ok: false, error });

export function isNightPhase(kind: PhaseKind): boolean {
  return kind === 'night_move' || kind === 'night_act';
}

export function isWhisperPhase(kind: PhaseKind): boolean {
  return kind === 'day_discuss' || kind === 'day_vote';
}

/** When the current phase ends (early end included). */
export function phaseDue(s: GameState): number {
  return s.phase.earlyEndAt === null ? s.phase.endsAt : Math.min(s.phase.endsAt, s.phase.earlyEndAt);
}

export function applyIntent(s: GameState, playerId: string, intent: Intent, now: number): IntentResult {
  const p = getPlayer(s, playerId);
  if (!p) return fail('You are not on this flight.');
  if (!intent || typeof intent !== 'object') return fail('Bad request.');
  if (intent.kind === 'chat') return postChat(s, p, intent.channel, intent.text, now);
  if (intent.kind === 'whisper') return postWhisper(s, p, intent.to, intent.text, now);
  if (s.phase.kind === 'ended') return fail('The flight is over.');
  if (!isActive(p)) return fail('You are out of the game.');

  switch (intent.kind) {
    case 'move': {
      if (s.phase.kind !== 'night_move') return fail('You can only change seats while the lights are out.');
      if (s.night.buckled[p.id]) return fail('Your seatbelt is locked tonight.');
      const error = checkMove(s, p, intent.to);
      if (error) return fail(error);
      s.night.moves[p.id] = intent.to;
      break;
    }
    case 'seatbelt': {
      if (s.phase.kind !== 'night_move') return fail('The seatbelt sign is set while the lights are out.');
      if (p.role !== 'pilot') return fail('Only the Pilot controls the seatbelt sign.');
      if (s.night.buckled[p.id]) return fail('Turbulence has you buckled in tonight.');
      const error = checkSeatbelt(s, p, intent.target);
      if (error) return fail(error);
      s.night.seatbelts[p.id] = intent.target;
      break;
    }
    case 'act': {
      if (s.phase.kind !== 'night_act') return fail('Abilities are used at night, after seats change.');
      if (s.night.buckled[p.id]) return fail('You are buckled in tonight.');
      if (intent.action) {
        const error = checkAction(s, p, intent.action);
        if (error) return fail(error);
      }
      s.night.actions[p.id] = intent.action ?? null;
      break;
    }
    case 'ready': {
      if (s.phase.kind !== 'day_discuss') return fail('Nothing to be ready for right now.');
      s.day.ready[p.id] = true;
      break;
    }
    case 'vote': {
      if (s.phase.kind !== 'day_vote') return fail('Voting has not started.');
      if (intent.target !== 'skip') {
        const t = getPlayer(s, intent.target);
        if (!t || !isActive(t)) return fail('Pick someone who is still in play.');
        if (t.id === p.id) return fail('You cannot vote for yourself.');
      }
      s.day.votes[p.id] = intent.target;
      break;
    }
    default:
      return fail('Unknown request.');
  }
  scheduleEarlyEnd(s, now);
  return OK;
}

function allSubmitted(s: GameState): boolean {
  const active = activePlayers(s);
  switch (s.phase.kind) {
    case 'night_move':
      return active.every(
        (p) => s.night.buckled[p.id] !== undefined || (p.id in s.night.moves && (p.role !== 'pilot' || p.id in s.night.seatbelts)),
      );
    case 'night_act':
      return active.every((p) => s.night.buckled[p.id] !== undefined || p.id in s.night.actions);
    case 'day_discuss':
      return active.every((p) => s.day.ready[p.id] === true);
    case 'day_vote':
      return active.every((p) => p.id in s.day.votes);
    default:
      return false;
  }
}

/** Once every eligible player has submitted, end the phase after a short grace period. */
export function scheduleEarlyEnd(s: GameState, now: number): void {
  if (s.phase.earlyEndAt !== null || !allSubmitted(s)) return;
  s.phase.earlyEndAt = Math.min(s.phase.endsAt, now + EARLY_END_GRACE_MS);
}

/** Fill in "do nothing" choices for a player who is away, so phases can still end early. */
export function submitDefaults(s: GameState, playerId: string, now: number): void {
  const p = getPlayer(s, playerId);
  if (!p || !isActive(p)) return;
  switch (s.phase.kind) {
    case 'night_move':
      s.night.moves[p.id] ??= 'stay';
      if (p.role === 'pilot') s.night.seatbelts[p.id] ??= 'none';
      break;
    case 'night_act':
      if (!(p.id in s.night.actions)) s.night.actions[p.id] = null;
      break;
    case 'day_discuss':
      s.day.ready[p.id] = true;
      break;
    case 'day_vote':
      s.day.votes[p.id] ??= 'skip';
      break;
    default:
      break;
  }
  scheduleEarlyEnd(s, now);
}

/** Advance the phase if its time is up. Returns true when something changed. */
export function tick(s: GameState, now: number): boolean {
  if (s.phase.kind === 'ended' || now < phaseDue(s)) return false;
  advance(s, now);
  return true;
}

function advance(s: GameState, now: number): void {
  switch (s.phase.kind) {
    case 'takeoff':
      startNight(s, 1, now);
      break;
    case 'night_move':
      resolveMoves(s, now);
      setPhase(s, 'night_act', now);
      break;
    case 'night_act':
      resolveNight(s, now);
      s.result = checkWin(s);
      setPhase(s, 'dawn', now);
      break;
    case 'dawn':
      if (s.result) endGame(s, now);
      else startDay(s, now);
      break;
    case 'day_discuss':
      if (s.settings.voteMode === 'afterIncident' && !s.incidentAtDawn) finishDay(s, now);
      else setPhase(s, 'day_vote', now);
      break;
    case 'day_vote':
      resolveVote(s, now);
      s.result = checkWin(s);
      setPhase(s, 'verdict', now);
      break;
    case 'verdict':
      finishDay(s, now);
      break;
    case 'ended':
      break;
  }
  scheduleEarlyEnd(s, now);
}

function finishDay(s: GameState, now: number): void {
  if (s.result) return endGame(s, now);
  if (s.phase.night >= s.nights) {
    addLog(s, now, 'all', 'landing', `Flight 13 has landed in ${DESTINATIONS[s.settings.destination].city}.`);
    s.result = landingResult(s);
    return endGame(s, now);
  }
  startNight(s, s.phase.night + 1, now);
}

function endGame(s: GameState, now: number): void {
  s.phase = { kind: 'ended', night: s.phase.night, startedAt: now, endsAt: now, earlyEndAt: null };
  if (s.result) addLog(s, now, 'all', 'gameover', resultText(s, s.result), { ...s.result });
}

function textError(s: GameState, p: PlayerState, text: unknown, now: number): string | null {
  if (typeof text !== 'string' || text.trim().length === 0) return 'Say something first.';
  if (text.trim().length > CHAT_MAX_LENGTH) return `Keep it under ${CHAT_MAX_LENGTH} characters.`;
  if (now - (s.lastChatAt[p.id] ?? -Infinity) < CHAT_COOLDOWN_MS) return 'Slow down a little.';
  return null;
}

function channelError(s: GameState, p: PlayerState, channel: ChatChannel): string | null {
  const kind = s.phase.kind;
  switch (channel) {
    case 'cabin':
      if (kind === 'ended') return null;
      if (!isActive(p)) return 'Ghosts cannot talk to the living. Use the ghost channel.';
      if (isNightPhase(kind)) return 'Lights out. The cabin is silent at night.';
      return null;
    case 'saboteurs':
      if (!isSaboteur(p.role) || !isActive(p)) return 'That channel is not for you.';
      if (!isNightPhase(kind)) return 'The saboteur channel only works at night.';
      return null;
    case 'ghosts':
      return isActive(p) && kind !== 'ended' ? 'Only ghosts can use that channel.' : null;
    default:
      return 'Unknown channel.';
  }
}

function pushChat(s: GameState, message: Omit<ChatMessage, 'id'>): void {
  s.chat.push({ id: newId(s), ...message });
  if (s.chat.length > CHAT_HISTORY) s.chat.splice(0, s.chat.length - CHAT_HISTORY);
}

function postChat(s: GameState, p: PlayerState, channel: ChatChannel, text: string, now: number): IntentResult {
  const error = textError(s, p, text, now) ?? channelError(s, p, channel);
  if (error) return fail(error);
  pushChat(s, { t: now, channel, from: p.id, to: null, text: text.trim() });
  s.lastChatAt[p.id] = now;
  return OK;
}

function postWhisper(s: GameState, p: PlayerState, to: string, text: string, now: number): IntentResult {
  const error = textError(s, p, text, now);
  if (error) return fail(error);
  if (!s.settings.whispers) return fail('Whispers are turned off on this flight.');
  if (!isWhisperPhase(s.phase.kind)) return fail('You can only whisper during the day.');
  const t = getPlayer(s, to);
  if (!isActive(p) || !t || !isActive(t)) return fail('Only people still in play can whisper.');
  if (t.id === p.id) return fail('Whispering to yourself?');
  if (distance(cellOf(p), cellOf(t)) > WHISPER_RADIUS) return fail(`${t.name} is too far away to whisper to.`);
  pushChat(s, { t: now, channel: 'whisper', from: p.id, to: t.id, text: text.trim() });
  s.lastChatAt[p.id] = now;
  return OK;
}
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `npx vitest run`
Expected: all test files pass (rng, grid, roles, setup, night, day, win, engine).

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/engine
git commit -m "feat(engine): night and day resolution, phase engine, chat"
```

---

### Task 7: Redacted player views

**Files:**
- Create: `src/engine/view.ts`
- Test: `src/engine/view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts file=src/engine/view.test.ts
import { describe, expect, it } from 'vitest';
import { applyIntent } from './engine';
import { advanceTo, makeGame } from './testkit';
import type { GameState } from './types';
import { viewFor, type PlayerView } from './view';

function secrets(): GameState {
  return makeGame([
    { id: 'b1', role: 'bomber', seat: '2B' },
    { id: 'rogue', role: 'stewardess_rogue', seat: '6F' },
    { id: 'inv', role: 'investigator', seat: '3B' },
    { id: 'pilot', role: 'pilot', seat: '2A' },
    { id: 'p2', role: 'passenger', seat: '7A' },
    { id: 'p3', role: 'passenger', seat: '8C' },
    { id: 'p4', role: 'passenger', seat: '5E' },
  ]);
}

const roleOf = (v: PlayerView, id: string) => v.players.find((p) => p.id === id)!.role;

describe('viewFor redaction', () => {
  it('passengers only know their own role', () => {
    const v = viewFor(secrets(), 'p2', 0);
    expect(v.you?.role).toBe('passenger');
    expect(roleOf(v, 'b1')).toBeNull();
    expect(roleOf(v, 'rogue')).toBeNull();
    expect(v.players.filter((p) => p.team !== null).map((p) => p.id)).toEqual(['p2']);
  });

  it('saboteurs see each other and every bomb', () => {
    const s = secrets();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'b1', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 2 } }, 0);
    advanceTo(s, 'dawn', 1);
    const v = viewFor(s, 'rogue', 0);
    expect(roleOf(v, 'b1')).toBe('bomber');
    expect(v.bombs).toHaveLength(1);
    expect(v.bombs[0].planterId).toBe('b1');
    expect(viewFor(s, 'p2', 0).bombs).toHaveLength(0);
  });

  it('the Investigator sees only the bombs they found, without the planter', () => {
    const s = secrets();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'b1', { kind: 'act', action: { kind: 'plant', where: 'seat', fuse: 2 } }, 0);
    applyIntent(s, 'inv', { kind: 'act', action: { kind: 'sweep' } }, 0);
    advanceTo(s, 'dawn', 1);
    const v = viewFor(s, 'inv', 0);
    expect(v.bombs).toHaveLength(1);
    expect(v.bombs[0].planterId).toBeNull();
    expect(v.bombs[0].plantedNight).toBeNull();
  });

  it('keeps whispers, the saboteur channel and the black box private', () => {
    const s = secrets();
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'b1', { kind: 'chat', channel: 'saboteurs', text: 'plant near 3B' }, 0);
    applyIntent(s, 'p3', { kind: 'move', to: '8D' }, 0);
    advanceTo(s, 'day_discuss', 1);
    applyIntent(s, 'pilot', { kind: 'whisper', to: 'b1', text: 'I trust you' }, s.phase.startedAt);
    const outsider = viewFor(s, 'p2', 0);
    expect(outsider.chat.some((m) => m.channel === 'saboteurs')).toBe(false);
    expect(outsider.chat.find((m) => m.channel === 'whisper')!.text).toBe('');
    expect(viewFor(s, 'b1', 0).chat.find((m) => m.channel === 'whisper')!.text).toBe('I trust you');
    expect(s.log.some((e) => e.to === 'end')).toBe(true);
    expect(outsider.log.some((e) => e.to === 'end')).toBe(false);
  });

  it('only the poisoned passenger knows about the poison', () => {
    const s = secrets();
    advanceTo(s, 'night_act', 1);
    applyIntent(s, 'rogue', { kind: 'act', action: { kind: 'serve', target: 'p4' } }, 0);
    advanceTo(s, 'dawn', 1);
    expect(viewFor(s, 'p4', 0).you?.poisoned).toBe(true);
    const other = viewFor(s, 'p2', 0);
    expect(other.log.some((e) => /poison/i.test(e.text))).toBe(false);
  });

  it('the control tower sees public information only, and everything once the flight is over', () => {
    const s = secrets();
    const tower = viewFor(s, null, 0);
    expect(tower.you).toBeNull();
    expect(tower.mine).toBeNull();
    expect(tower.players.every((p) => p.role === null)).toBe(true);
    s.phase.kind = 'ended';
    s.result = { winner: 'passengers', reason: 'eliminated', night: 1 };
    const after = viewFor(s, null, 0);
    expect(after.players.every((p) => p.role !== null)).toBe(true);
    expect(after.result).not.toBeNull();
  });
});

describe('viewFor options', () => {
  it('lists only legal choices for the current phase', () => {
    const s = secrets();
    advanceTo(s, 'night_move', 1);
    const pilot = viewFor(s, 'pilot', 0).options!;
    expect(pilot.seatbelt).not.toContain('pilot');
    expect(pilot.seatbelt).toHaveLength(6);
    expect(pilot.seats).not.toContain('2B');
    expect(pilot.actions).toEqual([]);
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'inv', 0).options!.actions).toContainEqual({ kind: 'sweep' });
    expect(viewFor(s, 'p2', 0).options!.actions).toEqual([]);
    advanceTo(s, 'day_vote', 1);
    const voter = viewFor(s, 'p2', 0).options!;
    expect(voter.vote).not.toContain('p2');
    expect(voter.vote).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/view.test.ts`
Expected: FAIL — cannot resolve `./view`.

- [ ] **Step 3: Implement views**

```ts file=src/engine/view.ts
import { isNightPhase, isWhisperPhase, phaseDue } from './engine';
import { WHISPER_RADIUS, distance } from './grid';
import { isSaboteur, teamOf } from './roles';
import { checkSeatbelt, possibleActions } from './rules';
import { activePlayers, cellOf, emptySeats, getPlayer, isActive } from './state';
import type {
  BombLocation,
  Cabin,
  Cell,
  ChatMessage,
  DeathCause,
  GameResult,
  GameState,
  LogEntry,
  Look,
  NightAction,
  PhaseKind,
  PlayerState,
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
}

export interface YouView {
  id: string;
  name: string;
  role: RoleId;
  team: Team;
  status: PlayerStatus;
  seat: SeatId | null;
  poisoned: boolean;
  buckled: 'pilot' | 'turbulence' | null;
  bombUsed: boolean;
  selfTreatUsed: boolean;
  lastSeatbeltTarget: string | null;
}

export interface MineView {
  move: SeatId | 'stay' | null;
  seatbelt: string | null;
  action: NightAction | null;
  acted: boolean;
  ready: boolean;
  vote: string | null;
}

/** Legal choices for the current phase, computed by the host so the UI never re-implements rules. */
export interface OptionsView {
  seats: SeatId[];
  seatbelt: string[];
  actions: NightAction[];
  whisper: string[];
  vote: string[];
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
  you: YouView | null;
  phase: PhaseView;
  settings: Settings;
  players: PlayerSummary[];
  cabin: Cabin;
  blackout: boolean;
  bombs: BombView[];
  mine: MineView | null;
  options: OptionsView | null;
  votes: VotesView | null;
  verdict: Verdict | null;
  chat: ChatMessage[];
  log: LogEntry[];
  result: GameResult | null;
}

const CHAT_IN_VIEW = 150;
const BLACKOUT_PHASES: ReadonlySet<PhaseKind> = new Set(['dawn', 'day_discuss', 'day_vote', 'verdict']);

function optionsFor(s: GameState, me: PlayerState): OptionsView {
  const kind = s.phase.kind;
  const buckled = s.night.buckled[me.id] !== undefined;
  const others = activePlayers(s).filter((p) => p.id !== me.id);
  return {
    seats: kind === 'night_move' && !buckled ? emptySeats(s) : [],
    seatbelt:
      kind === 'night_move' && !buckled && me.role === 'pilot'
        ? others.filter((t) => checkSeatbelt(s, me, t.id) === null).map((t) => t.id)
        : [],
    actions: kind === 'night_act' && !buckled ? possibleActions(s, me) : [],
    whisper:
      s.settings.whispers && isWhisperPhase(kind)
        ? others.filter((t) => distance(cellOf(me), cellOf(t)) <= WHISPER_RADIUS).map((t) => t.id)
        : [],
    vote: kind === 'day_vote' ? others.map((t) => t.id) : [],
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
    }));

  const chat = s.chat
    .filter(
      (m) =>
        ended ||
        m.channel === 'cabin' ||
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
  };

  const mine: MineView | null = me && {
    move: s.night.moves[me.id] ?? null,
    seatbelt: s.night.seatbelts[me.id] ?? null,
    action: s.night.actions[me.id] ?? null,
    acted: me.id in s.night.actions,
    ready: s.day.ready[me.id] === true,
    vote: s.day.votes[me.id] ?? null,
  };

  let votes: VotesView | null = null;
  if (s.phase.kind === 'day_vote') {
    const counts: Record<string, number> = {};
    for (const target of Object.values(s.day.votes)) counts[target] = (counts[target] ?? 0) + 1;
    votes = { counts, byVoter: s.settings.anonymousVotes ? null : { ...s.day.votes } };
  }

  return {
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
    blackout: s.blackoutNight === s.phase.night && BLACKOUT_PHASES.has(s.phase.kind),
    bombs,
    mine,
    options: me && isActive(me) && !ended ? optionsFor(s, me) : null,
    votes,
    verdict: s.verdict,
    chat,
    log,
    result: ended ? s.result : null,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/engine/view.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/view.ts src/engine/view.test.ts
git commit -m "feat(engine): redacted per-player views with legal options"
```

---

### Task 8: Bots and the simulation

**Files:**
- Create: `src/engine/bots.ts`
- Test: `src/engine/sim.test.ts`

- [ ] **Step 1: Write the failing simulation test**

```ts file=src/engine/sim.test.ts
import { describe, expect, it } from 'vitest';
import { botIntents } from './bots';
import { DESTINATION_ORDER } from './destinations';
import { applyIntent, phaseDue, tick } from './engine';
import { isSeatInCabin } from './grid';
import { defaultSettings } from './settings';
import { createGame } from './setup';
import { TEST_LOOK } from './testkit';
import type { DestinationId, GameState } from './types';

function assertInvariants(s: GameState): void {
  const seats = s.players.map((p) => p.seat).filter((seat): seat is string => seat !== null);
  expect(new Set(seats).size).toBe(seats.length);
  for (const p of s.players) {
    if (p.status === 'restrained') expect(p.seat).toBeNull();
    else expect(p.seat !== null && isSeatInCabin(p.seat, s.cabin.rows)).toBe(true);
    if (p.status !== 'alive') {
      expect(p.cause).not.toBeNull();
      expect(p.outNight).not.toBeNull();
    }
  }
  expect(s.phase.night).toBeLessThanOrEqual(s.nights);
  const planters = s.bombs.map((b) => b.planterId);
  expect(new Set(planters).size).toBe(planters.length);
  expect(s.cabin.cartRow).toBeGreaterThanOrEqual(1);
  expect(s.cabin.cartRow).toBeLessThanOrEqual(s.cabin.rows);
}

function simulate(seed: number, players: number, destination: DestinationId): GameState {
  const settings = { ...defaultSettings(), destination, maxPassengers: players };
  const roster = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, look: TEST_LOOK }));
  let now = 0;
  const s = createGame({ settings, players: roster, seed, now });
  const bots = { rng: seed * 7919 + 1 };
  for (let step = 0; step < 400 && s.phase.kind !== 'ended'; step++) {
    for (const p of s.players) {
      for (const intent of botIntents(s, p.id, bots)) {
        const result = applyIntent(s, p.id, intent, now);
        if (!result.ok) throw new Error(`Bot intent rejected in ${s.phase.kind}: ${result.error} ${JSON.stringify(intent)}`);
      }
    }
    now = phaseDue(s);
    tick(s, now);
    assertInvariants(s);
  }
  return s;
}

describe('bot simulation', () => {
  it('every game ends cleanly across sizes and destinations', () => {
    const wins: Record<string, number> = {};
    let games = 0;
    for (let players = 4; players <= 16; players++) {
      for (const destination of DESTINATION_ORDER) {
        for (let seed = 1; seed <= 6; seed++) {
          const s = simulate(seed * 1000 + players, players, destination);
          expect(s.phase.kind).toBe('ended');
          expect(s.result).not.toBeNull();
          wins[s.result!.winner] = (wins[s.result!.winner] ?? 0) + 1;
          games++;
        }
      }
    }
    if (process.env.SIM_REPORT) console.table(wins);
    expect(games).toBe(13 * 5 * 6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/sim.test.ts`
Expected: FAIL — cannot resolve `./bots`.

- [ ] **Step 3: Implement bots**

```ts file=src/engine/bots.ts
import { nextFloat, pick, type RngHolder } from './rng';
import { checkSeatbelt, possibleActions } from './rules';
import { activePlayers, emptySeats, getPlayer, isActive } from './state';
import type { GameState, Intent } from './types';

/** Random legal choices for one player in the current phase (simulation and dev bots). */
export function botIntents(s: GameState, playerId: string, h: RngHolder): Intent[] {
  const p = getPlayer(s, playerId);
  if (!p || !isActive(p)) return [];
  switch (s.phase.kind) {
    case 'night_move': {
      if (s.night.buckled[p.id]) return [];
      const seats = emptySeats(s);
      const intents: Intent[] = [{ kind: 'move', to: seats.length > 0 && nextFloat(h) < 0.4 ? pick(h, seats) : 'stay' }];
      if (p.role === 'pilot') {
        const targets = activePlayers(s).filter((t) => checkSeatbelt(s, p, t.id) === null);
        intents.push({ kind: 'seatbelt', target: targets.length > 0 && nextFloat(h) < 0.8 ? pick(h, targets).id : 'none' });
      }
      return intents;
    }
    case 'night_act': {
      if (s.night.buckled[p.id]) return [];
      const actions = possibleActions(s, p);
      return [{ kind: 'act', action: actions.length > 0 && nextFloat(h) < 0.85 ? pick(h, actions) : null }];
    }
    case 'day_discuss':
      return [{ kind: 'ready' }];
    case 'day_vote': {
      const targets = activePlayers(s).filter((t) => t.id !== p.id);
      return [{ kind: 'vote', target: targets.length > 0 && nextFloat(h) < 0.6 ? pick(h, targets).id : 'skip' }];
    }
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run it and watch it pass, with the win-rate report**

Run: `SIM_REPORT=1 npx vitest run src/engine/sim.test.ts`
Expected: 1 passed, plus a table of wins by team (random bots, so the split only needs to be non-degenerate: both teams win some games).

- [ ] **Step 5: Commit**

```bash
git add src/engine/bots.ts src/engine/sim.test.ts
git commit -m "feat(engine): random bots and a 390-game simulation"
```

---

### Task 9: Public API and final checks

**Files:**
- Create: `src/engine/index.ts`

- [ ] **Step 1: Write the public API**

```ts file=src/engine/index.ts
export * from './types';
export { createGame, checkTakeoff, cardsForGame, type NewPlayer } from './setup';
export { applyIntent, tick, phaseDue, submitDefaults, isNightPhase, isWhisperPhase } from './engine';
export {
  viewFor,
  type PlayerView,
  type PlayerSummary,
  type BombView,
  type YouView,
  type MineView,
  type OptionsView,
  type VotesView,
  type PhaseView,
} from './view';
export {
  ROLES,
  SPECIAL_CARDS,
  teamOf,
  apparentTeam,
  isSaboteur,
  presetCards,
  validateCards,
  emptyCards,
  countSpecials,
  type RoleInfo,
} from './roles';
export { DESTINATIONS, DESTINATION_ORDER, type Destination } from './destinations';
export {
  defaultSettings,
  validateSettings,
  phaseDurationMs,
  TIMERS,
  FIXED_TIMERS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  CHAT_MAX_LENGTH,
} from './settings';
export { possibleActions, checkAction, checkMove, checkSeatbelt } from './rules';
export { botIntents } from './bots';
export { describeLocation } from './night';
export * as grid from './grid';
```

- [ ] **Step 2: Full test run and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: every test file passes; tsc prints nothing.

- [ ] **Step 3: Commit**

```bash
git add src/engine/index.ts
git commit -m "feat(engine): public API"
```
