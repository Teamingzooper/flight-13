# M13: The Pilot's flight deck (rules, screens, bots) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Pilot flies from the flight deck. Every night he gets the seatbelt sign, the jump seat and the cabin cameras. Once per flight he can fly through rough air and change course, and by day he makes typed PA announcements. His card sometimes turns rogue.

**Architecture:**
- **Engine** (`src/engine`):
  - The Pilot's place is the pseudo-seat `'Cockpit'`, parsed to a grid cell far in front of row 1 so every distance rule leaves him alone (like the Stewardess's `'Aisle N'`).
  - New intents: `jumpseat`, `roughair` and `course`. New night actions: `watch` and `knockout`.
  - PA announcements are a chat channel `'pa'`.
- **TV** (`src/tv`): a cockpit block and three-row section picking on the seat map, plus Flight deck, Cameras, Jump seat and PA panels.
- **3D**: M13 adds a plain flight deck room so the Pilot's view works. M14 fills it with instruments, cameras, the visible jump seat guest, PA voice and cutscenes.

**Tech Stack:** TypeScript 7, Preact 10, three.js 0.186, Vitest 5 (`npx vitest run`), Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-24-pilot-flight-deck-design.md`

---

## File map

| File | What changes |
|---|---|
| `src/engine/types.ts` | `pilot_rogue` role, `pilotRogueChance` setting, Pilot state fields, night choices, intents, actions, `'pa'` chat channel, log tags |
| `src/engine/roles.ts` | Pilot texts, `isPilot`, one-Pilot rule |
| `src/engine/settings.ts` | `pilotRogueChance` default and validation, PA limits |
| `src/engine/setup.ts` | rogue Pilot deal (only while saboteurs stay a minority), Pilot sits in the cockpit, new night fields |
| `src/engine/grid.ts` | `COCKPIT`, `COCKPIT_ROW`, `isCockpit`, `parsePlace` |
| `src/engine/state.ts` | `isGuest`, `onFlightDeck`, `normalizeGame` |
| `src/engine/rules.ts` | `flightDeckError`, `checkJumpseat`, `checkRoughAir`, `checkCourse`, Pilot moves, guest and camera actions, coffee |
| `src/engine/night.ts` | Lights-out order, knockout, cameras, blasts skip the flight deck |
| `src/engine/engine.ts` | New intents, early end for the Pilot, PA posts |
| `src/engine/view.ts` | Pilot options and flags, `jumpseat`, `'pa'` chat |
| `src/engine/bots.ts` | Bot Pilot and bot guests |
| `src/engine/pilot.test.ts` (new) | Engine tests for all of the above |
| `src/net/protocol.ts` | `pilotRogueChance` in `cleanSettings` |
| `src/tv/SeatMap.tsx`, `src/styles/tv.css` | Cockpit block, row sections |
| `src/tv/ActionTab.tsx`, `src/tv/PilotPanels.tsx` (new) | Pilot and guest panels |
| `src/tv/ChatTab.tsx`, `src/tv/format.ts`, `src/tv/Overlays.tsx`, `src/tv/VoteTab.tsx`, `src/tv/TV.tsx` | PA lines, texts, pass, PA banner |
| `src/app/SettingsForm.tsx` | Rogue odds slider |
| `src/world/layout.ts`, `src/world/scene/flightdeck.ts` (new), `src/world/Cabin3D.ts`, `src/world/scene/people.ts`, `src/world/director.ts` | Plain flight deck, Pilot camera, guest walk, PA captions |

---

### Task 1: Rogue Pilots and the Pilot's settings

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/roles.ts`, `src/engine/settings.ts`, `src/engine/setup.ts`, `src/net/protocol.ts`
- Test: `src/engine/pilot.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
// src/engine/pilot.test.ts
import { describe, expect, it } from 'vitest';
import { emptyCards, isPilot, validateCards } from './roles';
import { defaultSettings, validateSettings } from './settings';
import { dealRoles } from './setup';

describe('rogue Pilots', () => {
  it('turn rogue by the odds, but only while the saboteurs stay outnumbered', () => {
    const cards = { ...emptyCards(), bomber: 1, pilot: 1 };
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 1)).toContain('pilot_rogue');
    expect(dealRoles({ rng: 1 }, cards, 6, 0, 0)).toContain('pilot');
    // Four passengers: a second saboteur would be half the cabin, so the Pilot stays loyal.
    expect(dealRoles({ rng: 1 }, cards, 4, 0, 1)).toContain('pilot');
    expect(isPilot('pilot_rogue')).toBe(true);
    expect(isPilot('stewardess_rogue')).toBe(false);
  });

  it('fit one to a flight deck, with odds the host can set', () => {
    expect(validateCards({ ...emptyCards(), bomber: 1, pilot: 2 }, 8, 0)).toBe('Only one Pilot fits on the flight deck.');
    expect(defaultSettings().pilotRogueChance).toBe(0.3);
    expect(validateSettings({ ...defaultSettings(), pilotRogueChance: 2 })).toBe('Pilot odds must be between 0 and 1.');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/engine/pilot.test.ts`
Expected: FAIL. `isPilot` and `pilotRogueChance` don't exist yet.

- [ ] **Step 3: Implement**

In `src/engine/types.ts`, add `| 'pilot_rogue'` to `RoleId`, and to `Settings`:
```ts
  /** Chance the Pilot card turns rogue (only when the saboteurs would still be outnumbered). */
  pilotRogueChance: number;
```

In `src/engine/roles.ts`, replace the `pilot` entry and add `pilot_rogue` after `stewardess_rogue`:
```ts
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    team: 'passengers',
    blurb: 'Your plane. Fly everyone home.',
    howTo:
      'You fly from the flight deck: bombs, handcuffs and the Nurse cannot reach you, and everyone knows who you are. Every night, turn on the seatbelt sign for one passenger, call someone up to the jump seat (safe for the night, but a saboteur up there can knock you out), and watch three rows on the cabin cameras. Once per flight, fly through rough air to buckle three rows in, and change course to land a night later (or sooner). By day, talk to the whole plane over the PA.',
  },
```
```ts
  pilot_rogue: {
    id: 'pilot_rogue',
    name: 'Rogue Pilot',
    team: 'saboteurs',
    blurb: 'Your plane. Their rules.',
    howTo:
      'Everything the Pilot can do, for the saboteurs. Buckle in whoever gets close, call passengers up to the jump seat so they cannot use their abilities, feed the camera footage to your team, and take the shortcut: land a night early while the saboteurs are still free. Everyone thinks you are on their side.',
  },
```
```ts
export function isPilot(role: RoleId): boolean {
  return role === 'pilot' || role === 'pilot_rogue';
}
```
In `validateCards`, after the `Too many special roles` check:
```ts
  if (cards.pilot > 1) return 'Only one Pilot fits on the flight deck.';
```

In `src/engine/settings.ts`:
- add `pilotRogueChance: 0.3,` to `defaultSettings()`;
- in `validateSettings`, after the Stewardess odds:
```ts
  if (!(s.pilotRogueChance >= 0 && s.pilotRogueChance <= 1)) return 'Pilot odds must be between 0 and 1.';
```

In `src/engine/setup.ts`, replace `dealRoles`:
```ts
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
```
(import `isSaboteur` from `./roles`.) In `createGame`, pass `settings.pilotRogueChance` as the fifth argument.

In `src/net/protocol.ts` `cleanSettings`:
- after `const pilotMustFly = raw.pilotMustFly ?? false;` add `const pilotRogueChance = raw.pilotRogueChance ?? 0.3;`
- add `if (typeof pilotRogueChance !== 'number') return null;`
- add `pilotRogueChance,` to the returned object.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine src/net`
Expected: PASS. Fix any existing test that dealt with seeded roles and now sees a different shuffle.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): the Pilot card can turn rogue"
```

---

### Task 2: The flight deck is the Pilot's place

**Files:**
- Modify: `src/engine/grid.ts`, `src/engine/setup.ts`, `src/engine/rules.ts`, `src/engine/state.ts`
- Test: `src/engine/pilot.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `pilot.test.ts`; add these imports at the top)

```ts
import { applyIntent } from './engine';
import { COCKPIT, parsePlace } from './grid';
import { advanceTo, logTexts, makeGame, player, type TestPlayer } from './testkit';
import type { GameState, MoveTarget, NightAction } from './types';
import { viewFor } from './view';

const act = (s: GameState, id: string, action: NightAction | null) => applyIntent(s, id, { kind: 'act', action }, 0);
const move = (s: GameState, id: string, to: MoveTarget) => applyIntent(s, id, { kind: 'move', to }, 0);

/** A loyal Pilot on the flight deck of an 8-row cabin. */
function cabin(extra: TestPlayer[] = [], role: TestPlayer['role'] = 'pilot'): GameState {
  return makeGame([
    { id: 'pilot', role, seat: COCKPIT },
    { id: 'bomber', role: 'bomber', seat: '1C' },
    { id: 'front', role: 'passenger', seat: '1D' },
    { id: 'mid', role: 'passenger', seat: '4B' },
    { id: 'back', role: 'passenger', seat: '7F' },
    { id: 'p5', role: 'passenger', seat: '8A' },
    ...extra,
  ]);
}

describe('the flight deck', () => {
  it('is where the Pilot sits, and he never leaves it', () => {
    const s = cabin();
    expect(parsePlace(COCKPIT)).toEqual({ row: -3, col: 3 });
    advanceTo(s, 'night_move', 1);
    expect(move(s, 'pilot', '5A')).toEqual({ ok: false, error: 'The Pilot stays on the flight deck.' });
    expect(move(s, 'pilot', 'washroom').ok).toBe(false);
    expect(viewFor(s, 'pilot', 0).options?.seats).toEqual([]);
    expect(viewFor(s, 'pilot', 0).options?.washroom).toBe('You cannot leave the flight deck.');
  });

  it('is out of reach of blasts in row 1', () => {
    const s = cabin();
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'front').status).toBe('dead');
    expect(player(s, 'pilot').status).toBe('alive');
  });
});
```
Also add a `'seats the Pilot on the flight deck at takeoff'` test using `createGame` with `pilot: 1` custom cards: exactly one player has seat `'Cockpit'`, and it is the one whose role `isPilot`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/engine/pilot.test.ts`
Expected: FAIL. `COCKPIT` isn't exported yet.

- [ ] **Step 3: Implement**

In `src/engine/grid.ts`:
```ts
/** The flight deck, in front of the galley: the Pilot's place. */
export const COCKPIT = 'Cockpit';
/** Where the flight deck sits on the grid: far enough ahead of row 1 that no blast, cuff, whisper or treatment reaches it. */
export const COCKPIT_ROW = -3;

export function isCockpit(id: SeatId | null | undefined): boolean {
  return id === COCKPIT;
}
```
and in `parsePlace`, before the aisle check:
```ts
  if (id === COCKPIT) return { row: COCKPIT_ROW, col: AISLE_COL };
```

In `src/engine/setup.ts` `placeFor`:
```ts
    if (isPilot(role)) return COCKPIT;
```

In `src/engine/rules.ts`:
- in `checkMove`, right after `if (to === 'stay') return null;`:
```ts
  if (isPilot(p.role)) return 'The Pilot stays on the flight deck.';
```
- in `checkWashroom`, first line: `if (isPilot(p.role)) return 'You cannot leave the flight deck.';`
- in `possibleMoves`, first line: `if (isPilot(p.role)) return [];`
- in `checkAction` `case 'search'`:
```ts
      return p.seat && !isAisleSpot(p.seat) && !isCockpit(p.seat) ? null : 'You have no seat to look under.';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine`
Expected: PASS. The sim invariant in `sim.test.ts` needs a Pilot branch: a Pilot who isn't restrained has seat `'Cockpit'`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): the Pilot sits on the flight deck"
```

---

### Task 3: Lights-out calls (seatbelt sign, jump seat, rough air, course)

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/setup.ts`, `src/engine/state.ts`, `src/engine/rules.ts`, `src/engine/night.ts`, `src/engine/engine.ts`
- Test: `src/engine/pilot.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
const call = (s: GameState, intent: Parameters<typeof applyIntent>[2]) => applyIntent(s, 'pilot', intent, 0);

describe('lights out on the flight deck', () => {
  it('calls someone up to the jump seat: safe tonight, back by morning, and everyone sees', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'jumpseat', target: 'mid' })).toEqual({ ok: true });
    move(s, 'mid', 'washroom');
    advanceTo(s, 'night_act', 1);
    expect(s.night.jumpseat).toBe('mid');
    expect(player(s, 'mid').washroomUsed).toBe(false);
    expect(logTexts(s, 'all')).toContain('mid was called up to the flight deck for the night.');
    advanceTo(s, 'dawn', 1);
    expect(player(s, 'mid').seat).toBe('4B');
  });

  it('cannot call up anyone who is buckled in', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    call(s, { kind: 'seatbelt', target: 'mid' });
    call(s, { kind: 'jumpseat', target: 'mid' });
    advanceTo(s, 'night_act', 1);
    expect(s.night.jumpseat).toBeNull();
    expect(logTexts(s, 'pilot')).toContain('You called mid up to the flight deck, but they are buckled in tonight.');
  });

  it('flies through rough air once per flight, buckling three rows', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'roughair', startRow: 3 })).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    expect(s.night.buckled.mid).toBe('rough');
    expect(s.night.buckled.back).toBeUndefined();
    expect(logTexts(s, 'all')).toContain('The plane bucked through rough air over rows 3–5. Everyone there is buckled in tonight.');
    advanceTo(s, 'night_move', 2);
    expect(call(s, { kind: 'roughair', startRow: 1 })).toEqual({ ok: false, error: 'You already flew through rough air on this flight.' });
  });

  it('changes course once: hold adds a night, a shortcut cannot land before tonight', () => {
    const s = cabin();
    const nights = s.nights;
    advanceTo(s, 'night_move', 1);
    expect(call(s, { kind: 'course', change: 'hold' })).toEqual({ ok: true });
    advanceTo(s, 'night_act', 1);
    expect(s.nights).toBe(nights + 1);
    expect(logTexts(s, 'all')).toContain(`The captain is holding: Flight 13 now lands after night ${nights + 1}.`);
    advanceTo(s, 'night_move', 2);
    expect(call(s, { kind: 'course', change: 'shortcut' })).toEqual({ ok: false, error: 'You already changed course on this flight.' });
    const late = cabin([], 'pilot_rogue');
    advanceTo(late, 'night_move', late.nights);
    expect(call(late, { kind: 'course', change: 'shortcut' })).toEqual({ ok: false, error: 'Too late for a shortcut: we land after tonight.' });
  });

  it('makes no calls while turbulence has him, and the early end still comes', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    s.night.buckled.pilot = 'turbulence';
    expect(call(s, { kind: 'jumpseat', target: 'mid' })).toEqual({ ok: false, error: 'Turbulence has you fighting the controls tonight.' });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/engine/pilot.test.ts`
Expected: FAIL. The intents are unknown.

- [ ] **Step 3: Implement**

`src/engine/types.ts`:
- In `PlayerState` add:
```ts
  /** Pilot: rough air and a change of course are once per flight. */
  roughAirUsed: boolean;
  courseUsed: boolean;
  /** Pilot: knocked out cold by his guest, and out of action on this night. */
  knockedOutNight: number | null;
```
- In `NightChoices`:
  - change `buckled` to `Record<string, 'pilot' | 'turbulence' | 'rough'>`;
  - add:
```ts
  /** Pilot id → who he calls up to the jump seat ('none' for nobody). */
  jumpseats: Record<string, string>;
  /** Pilot id → the first of three rows to fly rough air over. */
  roughair: Record<string, number>;
  /** Pilot id → a change of course. */
  courses: Record<string, 'hold' | 'shortcut'>;
  /** Who is up on the flight deck tonight, once seats have changed. */
  jumpseat: string | null;
```
- In `Intent` add:
```ts
  | { kind: 'jumpseat'; target: string }
  | { kind: 'roughair'; startRow: number | null }
  | { kind: 'course'; change: 'hold' | 'shortcut' | null }
```
- Add log tags `'jumpseat' | 'roughair' | 'course' | 'knockout' | 'watch'`.

`src/engine/setup.ts`:
- `emptyNight()` gains `jumpseats: {}, roughair: {}, courses: {}, jumpseat: null`;
- each new player gains `roughAirUsed: false, courseUsed: false, knockedOutNight: null`.

`src/engine/state.ts` `normalizeGame` gains `s.night.jumpseats ??= {}; s.night.roughair ??= {}; s.night.courses ??= {}; s.night.jumpseat ??= null;`, and for each player `p.roughAirUsed ??= false; p.courseUsed ??= false; p.knockedOutNight ??= null;`.

`src/engine/rules.ts`:
```ts
/** Why the Pilot cannot make flight deck calls (or watch the cameras) right now, or null. */
export function flightDeckError(s: GameState, p: PlayerState): string | null {
  if (!isPilot(p.role)) return 'Only the Pilot flies the plane.';
  if (!isActive(p)) return 'You are out of play.';
  if (s.night.buckled[p.id]) return 'Turbulence has you fighting the controls tonight.';
  if (p.knockedOutNight === s.phase.night) return 'You are still out cold.';
  return null;
}

export function checkJumpseat(s: GameState, pilot: PlayerState, target: string): string | null {
  const error = flightDeckError(s, pilot);
  if (error || target === 'none') return error;
  const t = getPlayer(s, target);
  if (!t || !isActive(t)) return 'Pick someone who is still in play.';
  if (t.id === pilot.id) return 'You are already on the flight deck.';
  return null;
}

export function checkRoughAir(s: GameState, pilot: PlayerState, startRow: number | null): string | null {
  const error = flightDeckError(s, pilot);
  if (error || startRow === null) return error;
  if (pilot.roughAirUsed) return 'You already flew through rough air on this flight.';
  if (!Number.isInteger(startRow) || startRow < 1 || startRow > s.cabin.rows - 2) return 'Pick three rows of the cabin.';
  return null;
}

export function checkCourse(s: GameState, pilot: PlayerState, change: 'hold' | 'shortcut' | null): string | null {
  const error = flightDeckError(s, pilot);
  if (error || change === null) return error;
  if (pilot.courseUsed) return 'You already changed course on this flight.';
  if (change === 'hold') return null;
  if (change === 'shortcut') return s.nights - 1 >= s.phase.night ? null : 'Too late for a shortcut: we land after tonight.';
  return 'Hold, or take a shortcut.';
}
```
In `checkSeatbelt`, make the first line `const error = flightDeckError(s, pilot); if (error) return error;`. Keep `target === 'none'` valid.

`src/engine/engine.ts` `applyIntent`:
- In the `seatbelt` case, replace the role and turbulence checks with `if (!isPilot(p.role)) return fail('Only the Pilot controls the seatbelt sign.');`. `checkSeatbelt` now covers turbulence and the knockout.
- Add:
```ts
    case 'jumpseat': {
      if (s.phase.kind !== 'night_move') return fail('Call someone up while the lights are out.');
      const error = checkJumpseat(s, p, intent.target);
      if (error) return fail(error);
      s.night.jumpseats[p.id] = intent.target;
      break;
    }
    case 'roughair': {
      if (s.phase.kind !== 'night_move') return fail('Rough air is flown while the lights are out.');
      const error = checkRoughAir(s, p, intent.startRow);
      if (error) return fail(error);
      if (intent.startRow === null) delete s.night.roughair[p.id];
      else s.night.roughair[p.id] = intent.startRow;
      break;
    }
    case 'course': {
      if (s.phase.kind !== 'night_move') return fail('Change course while the lights are out.');
      const error = checkCourse(s, p, intent.change);
      if (error) return fail(error);
      if (intent.change === null) delete s.night.courses[p.id];
      else s.night.courses[p.id] = intent.change;
      break;
    }
```
- `allSubmitted`, `night_move`:
```ts
      return active.every(
        (p) =>
          s.night.buckled[p.id] !== undefined ||
          (isPilot(p.role) ? p.id in s.night.seatbelts || flightDeckError(s, p) !== null : p.id in s.night.moves),
      );
```
- `allSubmitted`, `night_act`: also count `isPilot(p.role) && flightDeckError(s, p) !== null` as done.
- `submitDefaults` `night_move`: `if (isPilot(p.role)) s.night.seatbelts[p.id] ??= 'none';` (keep `moves ??= 'stay'` for everyone).

`src/engine/night.ts` `resolveMoves`: replace the Pilot loop with calls that run in order: course, rough air, seatbelt sign, then (after every Pilot's buckles) the jump seat. Skip the guest in the seat-change claims.
```ts
  for (const pilot of activePlayers(s).filter((p) => isPilot(p.role))) {
    if (flightDeckError(s, pilot) !== null) {
      pilot.lastSeatbeltTarget = null;
      continue;
    }
    changeCourse(s, pilot, now);
    flyRoughAir(s, pilot, now);
    seatbeltSign(s, pilot, now);
  }
  for (const pilot of activePlayers(s).filter((p) => isPilot(p.role) && flightDeckError(s, p) === null)) callUp(s, pilot, now);
```
`seatbeltSign` is the existing seatbelt body, moved as is. The rest:
```ts
function changeCourse(s: GameState, pilot: PlayerState, now: number): void {
  const change = s.night.courses[pilot.id];
  if (!change || checkCourse(s, pilot, change) !== null) return;
  pilot.courseUsed = true;
  s.nights += change === 'hold' ? 1 : -1;
  const text =
    change === 'hold'
      ? `The captain is holding: Flight 13 now lands after night ${s.nights}.`
      : `The captain is taking a shortcut: Flight 13 now lands after night ${s.nights}.`;
  addLog(s, now, 'all', 'course', text, { change, nights: s.nights });
  addLog(s, now, 'end', 'course', `Night ${s.phase.night}: Pilot ${pilot.name} ${change === 'hold' ? 'flew a holding pattern' : 'took a shortcut'}.`);
}

function flyRoughAir(s: GameState, pilot: PlayerState, now: number): void {
  const start = s.night.roughair[pilot.id];
  if (start === undefined || checkRoughAir(s, pilot, start) !== null) return;
  pilot.roughAirUsed = true;
  const rows = [start, start + 1, start + 2];
  for (const p of activePlayers(s)) {
    const cell = p.seat ? parsePlace(p.seat) : null;
    if (!cell || !rows.includes(cell.row)) continue;
    if (s.night.freed[p.id]) {
      addLog(s, now, [p.id], 'item', 'The plane bucked through rough air, but your seatbelt extender keeps you free tonight.');
      continue;
    }
    s.night.buckled[p.id] ??= 'rough';
    addLog(s, now, [p.id], 'buckled', 'The plane bucked through rough air and the seatbelt sign came on over your row. You cannot move or use an ability tonight.');
  }
  addLog(s, now, 'all', 'roughair', `The plane bucked through rough air over rows ${start}–${start + 2}. Everyone there is buckled in tonight.`, { rows });
  addLog(s, now, 'end', 'roughair', `Night ${s.phase.night}: Pilot ${pilot.name} flew through rough air over rows ${start}–${start + 2}.`);
}

function callUp(s: GameState, pilot: PlayerState, now: number): void {
  const target = s.night.jumpseats[pilot.id];
  if (!target || target === 'none' || checkJumpseat(s, pilot, target) !== null) return;
  const guest = getPlayer(s, target)!;
  if (s.night.buckled[guest.id]) {
    addLog(s, now, [pilot.id], 'fizzle', `You called ${guest.name} up to the flight deck, but they are buckled in tonight.`);
    return;
  }
  s.night.jumpseat = guest.id;
  const back = isAisleSpot(guest.seat) ? 'back at your post' : `back in ${guest.seat}`;
  addLog(s, now, [guest.id], 'jumpseat', `The captain called you up to the flight deck for the night. You sit in the jump seat, out of everyone's reach, and will be ${back} by morning.`);
  addLog(s, now, [pilot.id], 'jumpseat', `${guest.name} is up in the jump seat tonight.`);
  addLog(s, now, 'all', 'jumpseat', `${guest.name} was called up to the flight deck for the night.`, { player: guest.id });
  addLog(s, now, 'end', 'jumpseat', `Night ${s.phase.night}: Pilot ${pilot.name} called ${guest.name} up to the jump seat.`);
}
```
In the claims loop add `if (p.id === s.night.jumpseat) continue;` before the move check.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): the Pilot's lights-out calls"
```

---

### Task 4: In the dark (cameras, knockout, jump seat guests, coffee)

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/state.ts`, `src/engine/rules.ts`, `src/engine/night.ts`, `src/engine/items.ts`
- Test: `src/engine/pilot.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe('in the dark on the flight deck', () => {
  it('the cameras see three rows, and planting looks just like looking under a seat', () => {
    const s = cabin([
      { id: 'b2', role: 'bomber', seat: '4C' },
      { id: 'nurse', role: 'nurse', seat: '5B' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'pilot', { kind: 'watch', startRow: 3 })).toEqual({ ok: true });
    act(s, 'b2', { kind: 'plant', where: 'seat', fuse: 2 });
    act(s, 'mid', { kind: 'search' });
    act(s, 'nurse', { kind: 'treat', target: 'mid' });
    advanceTo(s, 'dawn', 1);
    const seen = logTexts(s, 'pilot').find((t) => t.startsWith('On the cabin cameras over rows 3–5 you saw:'))!;
    expect(seen).toContain('b2 bent down under their seat');
    expect(seen).toContain('mid bent down under their seat');
    expect(seen).toContain('nurse leaned over to mid');
  });

  it('a saboteur in the jump seat can knock the Pilot out for the next night', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'bomber' }, 0);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 })).toEqual({ ok: false, error: 'You are on the flight deck tonight.' });
    expect(act(s, 'bomber', { kind: 'knockout' })).toEqual({ ok: true });
    act(s, 'pilot', { kind: 'watch', startRow: 1 });
    advanceTo(s, 'night_move', 2);
    expect(logTexts(s, 'pilot')).toContain('bomber knocked you out cold in the jump seat. You will be in no state to fly tomorrow night either.');
    expect(applyIntent(s, 'pilot', { kind: 'seatbelt', target: 'mid' }, 0)).toEqual({ ok: false, error: 'You are still out cold.' });
  });

  it('coffee from row 1 can poison the flight deck, and only a Nurse in the jump seat can treat the Pilot', () => {
    const s = cabin([
      { id: 'stew', role: 'stewardess_rogue', seat: 'Aisle 1' },
      { id: 'nurse', role: 'nurse', seat: '2B' },
    ]);
    advanceTo(s, 'night_act', 1);
    expect(act(s, 'nurse', { kind: 'treat', target: 'pilot' }).ok).toBe(false);
    expect(act(s, 'stew', { kind: 'serve', target: 'pilot' })).toEqual({ ok: true });
    advanceTo(s, 'night_move', 2);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'nurse' }, 0);
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'nurse', { kind: 'treat', target: 'pilot' })).toEqual({ ok: true });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'pilot').status).toBe('alive');
  });

  it('keeps the jump seat guest out of the cabin: no blasts, handcuffs or treatment reach them', () => {
    const s = cabin([{ id: 'marshal', role: 'marshal', seat: '4C' }]);
    advanceTo(s, 'night_act', 1);
    act(s, 'bomber', { kind: 'plant', where: 'seat', fuse: 1 });
    advanceTo(s, 'night_move', 2);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'front' }, 0);
    advanceTo(s, 'night_act', 2);
    expect(act(s, 'marshal', { kind: 'cuff', target: 'front' })).toEqual({ ok: false, error: 'front is up on the flight deck tonight.' });
    advanceTo(s, 'dawn', 2);
    expect(player(s, 'front').status).toBe('alive');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/engine/pilot.test.ts`
Expected: FAIL. `watch` and `knockout` are unknown actions.

- [ ] **Step 3: Implement**

`src/engine/types.ts` `NightAction` gains:
```ts
  /** Pilot: watch three rows on the cabin cameras. */
  | { kind: 'watch'; startRow: number }
  /** A saboteur in the jump seat knocks the Pilot out cold. */
  | { kind: 'knockout' }
```

`src/engine/state.ts`:
```ts
/** Up in the jump seat tonight. */
export function isGuest(s: GameState, id: string): boolean {
  return s.phase.kind === 'night_act' && s.night.jumpseat === id;
}

/** On the flight deck right now: the Pilot, or his guest in the jump seat tonight. */
export function onFlightDeck(s: GameState, p: PlayerState): boolean {
  return isCockpit(p.seat) || isGuest(s, p.id);
}
```

`src/engine/rules.ts`:
- `reachable()` also refuses guests: `if (t.id !== p.id && isGuest(s, t.id)) return \`${t.name} is up on the flight deck tonight.\`;`
- At the top of `checkAction`, after the washroom block:
```ts
  if (isGuest(s, p.id)) {
    // Up in the jump seat: a Nurse can treat the Pilot, a saboteur can knock him out, and that is all.
    const pilot = activePlayers(s).find((o) => isPilot(o.role) && isCockpit(o.seat));
    if (action?.kind === 'treat' && p.role === 'nurse' && pilot && action.target === pilot.id) return null;
    if (action?.kind === 'knockout' && isSaboteur(p.role) && pilot) return null;
    return 'You are on the flight deck tonight.';
  }
```
- Replace the start of `case 'serve'` so the flight deck is checked before `reachable()`:
```ts
    case 'serve': {
      if (p.role !== 'stewardess_rogue') return 'Only a rogue Stewardess poisons drinks.';
      const target = getPlayer(s, action.target);
      if (!target || !isActive(target)) return 'Pick someone who is still in play.';
      if (target.id === p.id) return 'You cannot serve yourself.';
      const row = crewRow(p);
      // Coffee for the flight deck: from row 1 the Pilot and his guest are in reach.
      if (onFlightDeck(s, target)) return row === 1 ? null : `${target.name} is on the flight deck. Take the coffee up from row 1.`;
      const t = reachable(s, p, action.target);
      if (typeof t === 'string') return t;
      if (row === null || isAisleSpot(t.seat) || cellOf(t).row !== row) return `${t.name} is not sitting in your row. Walk the cart to them first.`;
      return null;
    }
```
- Add cases:
```ts
    case 'watch': {
      const error = flightDeckError(s, p);
      if (error) return error;
      return Number.isInteger(action.startRow) && action.startRow >= 1 && action.startRow <= s.cabin.rows - 2 ? null : 'Pick three rows to watch.';
    }
    case 'knockout':
      return 'Only a saboteur up in the jump seat can do that.';
```
- `possibleActions`:
  - add `case 'pilot': case 'pilot_rogue':` pushing `{ kind: 'watch', startRow }` for each start row 1..rows-2;
  - add, before the search candidate, `if (isSaboteur(p.role)) candidates.push({ kind: 'knockout' });`.

`src/engine/items.ts` `checkItemUse` `pills`: also refuse guests on either side ("You are on the flight deck tonight." and "`${t.name}` is up on the flight deck tonight.").

`src/engine/night.ts` `resolveNight`:
- Step 1c, after handcuffs:
```ts
  // 1c. A saboteur in the jump seat knocks the Pilot out cold (and his cameras go dark tonight).
  for (const { actor, action } of acts) {
    if (action.kind !== 'knockout') continue;
    const pilot = activePlayers(s).find((o) => isPilot(o.role) && isCockpit(o.seat));
    if (!pilot) continue;
    pilot.knockedOutNight = n + 1;
    visit(pilot.id, `${actor.name} knocked you out`);
    addLog(s, now, [pilot.id], 'knockout', `${actor.name} knocked you out cold in the jump seat. You will be in no state to fly tomorrow night either.`);
    addLog(s, now, [actor.id], 'knockout', 'You knocked the Pilot out cold. He is out of action tomorrow night too.');
    addLog(s, now, 'end', 'knockout', `Night ${n}: ${actor.name} knocked Pilot ${pilot.name} out in the jump seat.`);
    const i = acts.findIndex((a) => a.actor.id === pilot.id);
    if (i >= 0) {
      acts.splice(i, 1);
      addLog(s, now, [pilot.id], 'fizzle', 'You were knocked out before you could check the cameras.');
    }
  }
```
- Step 5c, after the investigations and checks: build the camera report from the remaining `acts` plus tonight's flashlights and pills:
```ts
/** What a cabin camera shows of one action (null: nothing to see in the rows). */
function sighting(s: GameState, actor: PlayerState, action: NightAction): string | null {
  const target = 'target' in action ? getPlayer(s, action.target) : undefined;
  switch (action.kind) {
    case 'treat':
      return target && target.id !== actor.id ? `${actor.name} leaned over to ${target.name}` : `${actor.name} rummaged in a bag`;
    case 'serve':
      return `${actor.name} handed ${target!.name} a drink`;
    case 'check':
      return `${actor.name} checked under ${rowSeats(aisleRow(actor.seat)!, action.side).join(', ')}`;
    case 'sweep':
      return `${actor.name} looked around the seats nearby`;
    case 'inspect':
      return action.what === 'cart' ? `${actor.name} fiddled with the drink cart` : `${actor.name} peered at the lavatory door`;
    case 'plant':
      return action.where === 'seat' ? `${actor.name} bent down under their seat` : action.where === 'cart' ? `${actor.name} fiddled with the drink cart` : `${actor.name} peered at the lavatory door`;
    case 'search':
      return `${actor.name} bent down under their seat`;
    case 'cuff':
      return `${actor.name} snapped handcuffs on ${target!.name}`;
    default:
      return null;
  }
}
```
```ts
  // 5c. The cabin cameras.
  for (const { actor, action } of acts) {
    if (action.kind !== 'watch') continue;
    const rows = [action.startRow, action.startRow + 1, action.startRow + 2];
    const inRows = (p: PlayerState | undefined) => {
      if (!p || !p.seat || inWashroom(s, p.id) || onFlightDeck(s, p)) return false;
      const cell = parsePlace(p.seat);
      return !!cell && rows.includes(cell.row);
    };
    const seen: string[] = [];
    for (const other of acts) {
      const text = sighting(s, other.actor, other.action);
      const target = 'target' in other.action ? getPlayer(s, other.action.target) : undefined;
      if (text && (inRows(other.actor) || inRows(target))) seen.push(text);
    }
    for (const [user, seat] of Object.entries(s.night.flashlights)) {
      const u = getPlayer(s, user)!;
      if (inRows(u) || rows.includes(parseSeat(seat)?.row ?? 0)) seen.push(`${u.name} shone a light under ${seat}`);
    }
    for (const [sleeper, by] of Object.entries(s.night.asleep)) {
      const a = getPlayer(s, by)!;
      const t = getPlayer(s, sleeper)!;
      if (inRows(a) || inRows(t)) seen.push(`${a.name} slipped something into ${t.name}'s water`);
    }
    const where = `rows ${rows[0]}–${rows[2]}`;
    addLog(s, now, [actor.id], 'watch', seen.length ? `On the cabin cameras over ${where} you saw: ${seen.join('; ')}.` : `The cabin cameras showed ${where} sleeping.`);
    addLog(s, now, 'end', 'watch', `Night ${n}: Pilot ${actor.name} watched ${where} on the cabin cameras.`);
  }
```
- In the explosions loop, skip the flight deck: `if (onFlightDeck(s, p)) continue;` before computing `caught`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): cabin cameras, the jump seat, knockouts and coffee for the flight deck"
```

---

### Task 5: PA announcements

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/settings.ts`, `src/engine/engine.ts`, `src/engine/view.ts`
- Test: `src/engine/pilot.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('the PA', () => {
  it('lets only the Pilot talk to the whole plane, by day, now and then', () => {
    const s = cabin();
    const pa = (id: string, text: string, now = 0) => applyIntent(s, id, { kind: 'chat', channel: 'pa', text }, now);
    advanceTo(s, 'night_move', 1);
    expect(pa('pilot', 'Hello').ok).toBe(false);
    advanceTo(s, 'day_discuss', 1);
    expect(pa('mid', 'Hello')).toEqual({ ok: false, error: 'Only the Pilot can use the PA.' });
    expect(pa('pilot', 'x'.repeat(141)).ok).toBe(false);
    expect(pa('pilot', 'Watch row 4.', 100_000)).toEqual({ ok: true });
    expect(pa('pilot', 'Again.', 105_000)).toEqual({ ok: false, error: 'The PA needs a moment: 10s.' });
    expect(viewFor(s, 'back', 0).chat.at(-1)).toMatchObject({ channel: 'pa', from: 'pilot', text: 'Watch row 4.' });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/engine/pilot.test.ts`
Expected: FAIL with "Unknown channel.".

- [ ] **Step 3: Implement**

- `types.ts`: `export type ChatChannel = 'cabin' | 'saboteurs' | 'ghosts' | 'pa';`
- `settings.ts`:
```ts
export const PA_MAX_LENGTH = 140;
export const PA_COOLDOWN_MS = 15_000;
```
- `engine.ts`:
  - in `channelError`:
```ts
    case 'pa':
      if (!isPilot(p.role) || !isActive(p)) return 'Only the Pilot can use the PA.';
      return PA_PHASES.has(kind) ? null : 'The PA is for announcements by day.';
```
    with `const PA_PHASES: ReadonlySet<PhaseKind> = new Set(['dawn', 'day_discuss', 'day_vote', 'verdict']);`
  - in `postChat`:
```ts
  const error = textError(s, p, text, now) ?? channelError(s, p, channel) ?? (channel === 'pa' ? paError(s, p, text, now) : null);
  if (error) return fail(error);
  pushChat(s, { t: now, channel, from: p.id, to: null, text: text.trim() });
  s.lastChatAt[p.id] = now;
  if (channel === 'pa') s.lastChatAt[`pa:${p.id}`] = now;
  return OK;
```
```ts
/** Announcements are short, and the PA needs a moment between them. */
function paError(s: GameState, p: PlayerState, text: string, now: number): string | null {
  if (text.trim().length > PA_MAX_LENGTH) return `Keep announcements under ${PA_MAX_LENGTH} characters.`;
  const wait = PA_COOLDOWN_MS - (now - (s.lastChatAt[`pa:${p.id}`] ?? -Infinity));
  return wait > 0 ? `The PA needs a moment: ${Math.ceil(wait / 1000)}s.` : null;
}
```
- `view.ts`: the chat filter keeps `m.channel === 'pa'` for everyone.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): PA announcements from the flight deck"
```

---

### Task 6: Views, options and bots

**Files:**
- Modify: `src/engine/view.ts`, `src/engine/bots.ts`, `src/engine/sim.test.ts`
- Test: `src/engine/pilot.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('the Pilot on screen', () => {
  it('sees every call on offer, and everyone sees his guest', () => {
    const s = cabin();
    advanceTo(s, 'night_move', 1);
    const o = viewFor(s, 'pilot', 0).options!;
    expect(o.jumpseat).toContain('mid');
    expect(o.roughair).toEqual([1, 2, 3, 4, 5, 6]);
    expect(o.course).toEqual(['hold', 'shortcut']);
    applyIntent(s, 'pilot', { kind: 'jumpseat', target: 'mid' }, 0);
    expect(viewFor(s, 'pilot', 0).mine?.jumpseat).toBe('mid');
    advanceTo(s, 'night_act', 1);
    expect(viewFor(s, 'back', 0).jumpseat).toBe('mid');
    expect(viewFor(s, 'mid', 0).you?.inJumpSeat).toBe(true);
    expect(viewFor(s, 'pilot', 0).options?.actions).toContainEqual({ kind: 'watch', startRow: 1 });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/engine/pilot.test.ts`
Expected: FAIL. `o.jumpseat` is undefined.

- [ ] **Step 3: Implement**

`view.ts`:
- `YouView` gains `roughAirUsed`, `courseUsed`, `knockedOut: boolean` (`isPilot(me.role) && me.knockedOutNight === s.phase.night && isNightPhase(s.phase.kind)`) and `inJumpSeat: boolean` (`isGuest(s, me.id)`).
- `buckled` widens to `'pilot' | 'turbulence' | 'rough' | null`.
- `MineView` gains `jumpseat: string | null`, `roughair: number | null` and `course: 'hold' | 'shortcut' | null`.
- `OptionsView` gains `jumpseat: string[]`, `roughair: number[]` and `course: ('hold' | 'shortcut')[]`.
- `PlayerView` gains `jumpseat: string | null` (only in night_act).
- In `optionsFor`:
```ts
  const deck = kind === 'night_move' && isPilot(me.role) && flightDeckError(s, me) === null;
  ...
    seatbelt: deck ? others.filter((t) => checkSeatbelt(s, me, t.id) === null).map((t) => t.id) : [],
    jumpseat: deck ? others.filter((t) => checkJumpseat(s, me, t.id) === null).map((t) => t.id) : [],
    roughair: deck && !me.roughAirUsed ? Array.from({ length: s.cabin.rows - 2 }, (_, i) => i + 1) : [],
    course: deck ? (['hold', 'shortcut'] as const).filter((c) => checkCourse(s, me, c) === null) : [],
```

`bots.ts`, `night_move` (a Pilot never moves):
```ts
      if (isPilot(p.role)) {
        if (flightDeckError(s, p) !== null) return [];
        const intents: Intent[] = [];
        const targets = activePlayers(s).filter((t) => checkSeatbelt(s, p, t.id) === null);
        intents.push({ kind: 'seatbelt', target: targets.length > 0 && nextFloat(h) < 0.8 ? pick(h, targets).id : 'none' });
        const guests = activePlayers(s).filter((t) => t.id !== p.id);
        if (guests.length > 0 && nextFloat(h) < 0.5) intents.push({ kind: 'jumpseat', target: pick(h, guests).id });
        if (!p.roughAirUsed && nextFloat(h) < 0.1) intents.push({ kind: 'roughair', startRow: 1 + Math.floor(nextFloat(h) * (s.cabin.rows - 2)) });
        const rogue = p.role === 'pilot_rogue';
        const change = rogue ? 'shortcut' : 'hold';
        const moment = rogue ? s.phase.night === s.nights - 1 : s.phase.night === s.nights - 1;
        if (!p.courseUsed && moment && checkCourse(s, p, change) === null && nextFloat(h) < 0.5) intents.push({ kind: 'course', change });
        return [...intents, ...maybeUse(s, p, h, 'mirror', 0.3)];
      }
```
In `night_act`, before the generic pick, handle the guest:
```ts
      if (isGuest(s, p.id)) {
        const actions = possibleActions(s, p);
        const knock = actions.find((a) => a.kind === 'knockout');
        const treat = actions.find((a) => a.kind === 'treat');
        const pilot = activePlayers(s).find((o) => isPilot(o.role));
        const action = knock && nextFloat(h) < 0.3 ? knock : treat && pilot?.poisonedNight !== null ? treat : null;
        return [{ kind: 'act', action }];
      }
```
`sim.test.ts` invariant: `else if (isPilot(p.role)) expect(p.seat).toBe('Cockpit');`.

- [ ] **Step 4: Run all the tests**

Run: `npx vitest run`
Expected: PASS, the simulation included.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): Pilot views, options and bots"
```

---

### Task 7: The seat map gets a flight deck and row sections

**Files:**
- Modify: `src/tv/SeatMap.tsx`, `src/styles/tv.css`

- [ ] **Step 1: Implement**

In `SeatMap.tsx`:
- Add a prop:
```ts
export interface RowPick {
  /** Valid first rows of a three-row section. */
  options: ReadonlySet<number>;
  selected: number | null;
  onPick: (startRow: number) => void;
}
```
- Clamp any tapped row to the nearest valid start: `const startFor = (r: number) => Math.min(Math.max(r - 1, first), last)`, where `first` and `last` are the smallest and largest option.
- Shift the layout one track: `at(r, c)` uses `r + 3`. The letter labels move to `r = -2`, the cockpit block goes at `r = -1`, and the galley stays at `r = 0`. In `tv.css`:
  - `grid-template-columns: 22px 46px 36px repeat(var(--rows), minmax(30px, 1fr)) 44px` for the horizontal map;
  - `grid-template-rows: 18px 40px 30px repeat(var(--rows), var(--cell)) 40px` for the vertical one.
- The cockpit block `sm-block sm-cockpit`, spanning `at(-1, 0, 7)`, shows:
  - "Flight deck";
  - the Pilot's crew dot (initial and top colour; a cyan ring if it's you);
  - the guest's short name when `game.jumpseat` is set.
- With `rowPick`, seats and row numbers become buttons that call `rowPick.onPick(startFor(r))`. Seats in the selected section get the `preview` class, so parents pass `preview` as before.

- [ ] **Step 2: Check it**

Run: `npx tsc --noEmit -p .` (no errors). In the preview server, open the Map tab and see the Flight deck block in front of the galley.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(tv): the seat map shows the flight deck and picks three-row sections"
```

---

### Task 8: The Pilot's screens

**Files:**
- Create: `src/tv/PilotPanels.tsx`
- Modify: `src/tv/ActionTab.tsx`, `src/tv/ChatTab.tsx`, `src/tv/format.ts`, `src/tv/Overlays.tsx`, `src/tv/VoteTab.tsx`, `src/tv/TV.tsx`, `src/app/SettingsForm.tsx`, `src/styles/tv.css`

- [ ] **Step 1: Implement**

`PilotPanels.tsx` exports four panels, each built from the existing `SeatMap`, `choice-grid` and `chips` styles:
- `FlightDeckPanel`, shown during `night_move`. In order:
  - `SeatbeltPicker`, moved from ActionTab;
  - Jump seat: chips from `options.jumpseat` plus "Nobody", sending `{ kind: 'jumpseat', target }`, and a map `playerPick`;
  - Rough air: a map with `rowPick` over `options.roughair`, amber preview, "Fly rough air over rows X–Y" and "Cancel" (`startRow: null`);
  - Change course: Hold ("Land after night N+1") and Shortcut ("Land after night N−1", disabled unless offered), sending `{ kind: 'course', change }`, plus Cancel;
  - status lines: "Calls are in" once the seatbelt choice is set, and "Used" for spent once-per-flight calls.
- `CameraPanel`, shown during `night_act`:
  - a `rowPick` map with a cyan preview, then "Watch rows X–Y" sending `{ kind: 'act', action: { kind: 'watch', startRow } }`, plus Rest;
  - when `you.knockedOut`: "You are out cold tonight."
- `JumpSeatPanel`, for `you.inJumpSeat`:
  - "You are up on the flight deck";
  - buttons for the offered `treat` (the Pilot) or `knockout` actions, plus Rest.
- `PaPanel`, by day for Pilots:
  - an input (max 140) sending `{ kind: 'chat', channel: 'pa', text }`;
  - the note "Everyone sees your announcements. The PA needs 15 seconds between them."

`ActionTab.tsx` changes:
- For Pilots, `night_move` shows `FlightDeckPanel` (or a turbulence or knocked-out notice) instead of `MovePanel`, and `night_act` shows `CameraPanel`.
- Guests get `JumpSeatPanel` instead of `AbilityPanel`.
- By day, Pilots also get `PaPanel`.
- `RoleStrip` shows "On the flight deck" instead of the seat, with no washroom line for Pilots.

`format.ts` changes:
- `placeLabel('Cockpit')` returns `'flight deck'`;
- a new `seatPill(seat)` returns `'Crew'`, `'Pilot'` or the seat;
- `describeAction` covers `watch` (`watch rows X–Y on the cabin cameras`) and `knockout` (`knock the Pilot out cold`);
- `phaseHint` gets Pilot and guest lines.

Other files:
- `VoteTab` and the boarding pass (`Overlays`, "FLIGHT DECK") use these labels.
- `ChatTab` shows `'pa'` messages in the cabin list as `📢 Captain {name}` with a `msg pa` class.
- `TV.tsx` shows the newest PA message (under 8 s old) as a banner under the header.
- `SettingsForm` gets a "Pilot turns rogue: 30%" slider and a matching rules line.

- [ ] **Step 2: Check it**

Run: `npx tsc --noEmit -p . && npx vitest run`. Then in the preview, make yourself the Pilot (`f13.host.snapshot.game`), and on the Action tab try every call and panel.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(tv): the Pilot's flight deck, cameras and PA screens"
```

---

### Task 9: A plain flight deck in 3D, and PA captions

**Files:**
- Create: `src/world/scene/flightdeck.ts`
- Modify: `src/world/layout.ts`, `src/world/Cabin3D.ts`, `src/world/scene/people.ts`, `src/world/director.ts`, `src/world/World.tsx`

- [ ] **Step 1: Implement**

- `layout.ts`:
  - `FLIGHT_DECK` constants: the door at `BULKHEAD_Z - 1.85`, the captain's seat at x −0.42 and z `BULKHEAD_Z - 3.0`, and the screen on the centre panel;
  - `seatPose('Cockpit')`, `eyePosition('Cockpit')` (seated, eye 1.18) and `screenPose('Cockpit')` read from it.
- `scene/flightdeck.ts` `buildFlightDeck()` returns `{ group, screen, door, setSky(texture) }`:
  - a room from the galley's end forward about 2 m, narrowing to the nose;
  - a door frame with a "FLIGHT DECK" sign facing the galley;
  - the captain's and first officer's seats and a dark instrument panel;
  - windscreen panes using a sky material.
- `Cabin3D.ts`:
  - builds the flight deck next to the cabin;
  - the Pilot's camera sits in the captain's seat and uses `screen` for the live screen;
  - `windows.show(sky)` also calls `flightDeck.setSky(sky)`;
  - the jump seat guest walks to `door` and goes out of sight, through the same away list as the washroom (`People.sync` takes a list of `{ id, door }`).
- `director.ts`:
  - new `'pa'` chat messages become caption cues, labelled `Captain {name}`;
  - automatic announcements are labelled "Flight deck".
- `World.tsx`: the walking hint reads "Walking to the flight deck…" for the Pilot.

- [ ] **Step 2: Check it**

Run: `npx tsc --noEmit -p . && npx vitest run`. In the preview, as the Pilot, capture the canvas (`__shot`) and check that the flight deck view shows the screen and sky. As a passenger, check that the guest walks to the door.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(world): a flight deck for the Pilot, and PA captions"
```

---

### Task 10: Ship M13

- [ ] **Step 1:** Run `npx tsc --noEmit -p . && npx vitest run && npm run build`. All pass.
- [ ] **Step 2:** Update the Pilot rows of `docs/superpowers/specs/2026-09-23-flight-13-design.md`, and add the Pilot to the README's roles, if it lists them.
- [ ] **Step 3:** Merge `feat/pilot-deck` into `main` and push. Wait for "Deploy to GitHub Pages". Check that the live `assets/index-*.js` matches `dist/index.html`.
- [ ] **Step 4:** Update the project memory.
