# Flight 13 — Milestone 5: Cinematics and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the flight feel like a flight: a takeoff roll and climb, lights that clunk off at night and
flicker back on at dawn, explosions with a flash, shake, sparks, smoke, fire, dropping oxygen masks and
lasting scorch marks, turbulence bumps, a runaway cart, a blackout day, a sunrise at dawn and an aurora
over Bermuda. Add synthesized sound (engine drone, chimes, PA ding, blasts) and captain announcements
shown as captions. Hold the dawn report back long enough to see the blast, and give touch players a
"Use screen" button.

**Architecture:** A pure *director* compares the previous and next `PlayerView` and returns cues
(takeoff, lights out/on, explosion, turbulence, cart roll, restrained, landing, captain lines). It is
unit-tested. `Cabin3D` plays cues through a Web Audio engine (`audio.ts`, a module singleton so the HUD
can mute it) and a scene effects module (`scene/effects.ts`). Lasting damage (masks down, scorched
seats and floor) is derived from state, so a reload shows the same cabin. The takeoff is driven by the
phase clock, so a reload mid-takeoff resumes at the right moment. Window views move into a small
`WindowView` that crossfades between sky textures (runway, day, dawn, night, aurora).

**Tech Stack:** three 0.186 (Points, Sprites, InstancedMesh), Web Audio API, Preact, Vitest.

---

### Task 1: Director (test-first)

**Files:** Create `src/world/director.ts`, test `src/world/director.test.ts`; modify `src/engine/night.ts`
(anomaly log entries carry `data: { anomaly }`).

```ts
export type Cue =
  | { kind: 'takeoff' }
  | { kind: 'lightsOut' }
  | { kind: 'lightsOn'; afterBlast: boolean }
  | { kind: 'explosion'; id: string; centers: Cell[]; where: 'seat' | 'cart' | 'lavatory' }
  | { kind: 'turbulence' }
  | { kind: 'cartRoll'; from: number; to: number; runaway: boolean }
  | { kind: 'restrained'; playerId: string }
  | { kind: 'landing'; result: GameResult }
  | { kind: 'pa'; text: string };
export function directorCues(prev: PlayerView | null, next: PlayerView): Cue[];
```

Rules: first view → only `takeoff` + its captain line when the phase is takeoff (no replays of old
explosions); a bomb that turns `exploded` → one `explosion` cue; crossing into/out of a night phase →
`lightsOut` / `lightsOn` (afterBlast when an explosion cue is in the same batch); a new `turbulence` log
entry for the current night → `turbulence`; cart row change → `cartRoll` (runaway when a new anomaly
entry has `data.anomaly === 'runaway_cart'`); a player newly `restrained` → `restrained`; entering
`ended` → `landing`. Captain lines: takeoff welcome (city, nights), lights out (night n of N; turbulence
warning when bumpy), dawn (calm/"remain calm, masks"/lights trouble on blackout), restraint (name,
public), ending (landed / saboteurs took over / all saboteurs restrained). Lines never reveal secrets.

Tests: no cues for an identical view; explosion once; lights cues; afterBlast; turbulence; runaway cart;
restrained line names the passenger; landing; first view in the middle of a night gives nothing.

### Task 2: Audio

**File:** `src/world/audio.ts` — `CabinAudio` singleton `cabinAudio`: lazy `AudioContext` unlocked on the
first pointer/key gesture, master gain, `muted` persisted in localStorage (`f13-muted`). Beds: engine
(looped brown noise → low-pass + two low oscillators, `setEngine(level)` ramps), cabin air (high-passed
noise). One-shots: `chime()` (two-tone seatbelt bing-bong), `ding()` (PA), `clunk()` (lights relay),
`boom(distance)` (filtered noise sweep + sub thump + short ring when close), `rumble()` (turbulence),
`rattle()` (runaway cart), `zip()` (zip tie), `thunk()` (gear up). `start()`/`stop()` for the beds.

### Task 3: Scene effects

**Files:** Create `src/world/scene/effects.ts`, `src/world/windows.ts`; modify `src/world/textures.ts`
(runway, dawn and aurora skies, smoke/flame/scorch sprites), `src/world/scene/seats.ts` (`tint(seat, f)`),
`src/world/scene/cart.ts` (runaway speed), `src/world/lighting.ts` (flicker curves, `blackout` preset,
window brightness via `WindowView`).

- `Explosion` at a world point: flash point light, additive fireball, 140 sparks (gravity, floor bounce),
  36 smoke sprites that billow toward the ceiling and linger, flickering fire for ~6 s.
- `OxygenMasks`: one per seat hanging from the service panel above the row; `drop()` springs them down
  with a damped swing and keeps a gentle sway; `setDown()` for reloads.
- `Scorch`: floor decals at blast centres; seats within two cells darkened by distance.
- `WindowView`: owns the window glass; `setSky(texture)` crossfades through dark; runway view scrolls and
  tilts during takeoff.

### Task 4: Integration

**Files:** Modify `src/world/Cabin3D.ts`, `src/world/World.tsx`, `src/styles/world.css`.

- `Cabin3D` keeps the previous view, runs `directorCues`, and plays them: sounds, effects, camera shake,
  flash overlay (a DOM div it owns), captions via `onCaption`. Lights stay dark ~1.6 s after a blast.
- Takeoff from the phase clock: engine spool, runway scroll and rotation, vibration, gear thunk, climb
  into the day sky.
- Turbulence nights bump the camera every few seconds with a rumble; the blackout day uses the
  `blackout` preset; dawn shows a sunrise; Bermuda nights show an aurora.
- `World`: caption strip, mute button, dawn report held ~1.5 s (3.8 s after a blast), a touch-only
  "Use screen" button.

### Task 5: Verify and ship

Tests, type-check, build; browser: takeoff sequence, lights out/on, a forced explosion (flash, sparks,
smoke, masks, scorch), captions, mute, mobile viewport; commit, merge, push, check the deploy.
