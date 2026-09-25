# M14: The flight deck in 3D, PA voice, and cutscenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the Pilot remake (spec `docs/superpowers/specs/2026-09-24-pilot-flight-deck-design.md`, the "flight deck in 3D" and "PA voice" sections). The flight deck gets:
- a live forward view and instruments;
- a camera monitor;
- the jump seat guest, visibly sitting there;
- the Pilot's PA voice;
- boarding into the cockpit;
- the takeoff, landing and hijack seen from the flight deck.

**Architecture:**
- `world/forwardview.ts` draws the view through the windscreen (runway, cloud sea, night, dawn, aurora) onto one canvas, which the four panes share.
- `world/instruments.ts` draws the primary flight displays from an attitude that `Cabin3D.flight()` already works out.
- The camera monitor renders a ceiling camera into a small render target, only while the Pilot is looking from the flight deck.
- PA voice adds `{t:'pa', on}`: the host keeps `ClientState.pa` (the Pilot on the air), and `VoiceChat` plays that voice to everyone through a speaker filter.

**Tech Stack:** three.js 0.186 (WebGLRenderTarget, CanvasTexture), Web Audio (BiquadFilterNode, WaveShaperNode), Preact.

---

### Task 1: The forward view and the instruments
- Create `src/world/forwardview.ts`: `class ForwardView { texture; update(dt, mode, speed, pitch, time) }`.
  - It draws the sky for the mode (day, night with stars, dawn, aurora) and the horizon, which drops as the nose pitches up.
  - In runway mode it adds a perspective runway whose centre-line dashes run by at `speed`. In the air it adds a cloud sea that drifts towards you.
- Create `src/world/instruments.ts`: `class FlightDisplay { texture; draw({ speed, altitude, pitch, roll }) }`. It shows an attitude ball, a speed tape and an altitude tape, redrawn at most 10 times a second.
- `flightdeck.ts`:
  - panes get UVs so the view spans all four (pane i shows u ∈ [i/4, (i+1)/4]);
  - a display on each side of the two screens;
  - an overhead panel with a seatbelt switch light (`setSeatbeltLight(on)`);
  - `setView(texture)` and `setDisplays(texture)`.
- `Cabin3D.flight()`:
  - keeps `attitude` up to date: on the ground 0/0; the takeoff roll to 160 kt; after rotation, climbing at 12°; cruise at 450 kt and 35,000 ft; small sway, and more in turbulence;
  - drives the forward view in runway mode while packing, boarding and taking off. Endings set runway mode through `showRunway`.
- Check: canvas captures at takeoff, climb, night and day from the captain's seat.

### Task 2: The camera monitor
- `flightdeck.ts`: a monitor (bezel plus screen) on the pedestal top, between the pilots.
- `Cabin3D`:
  - a 256×160 `WebGLRenderTarget` and a ceiling camera over the watched rows, looking down the aisle;
  - the rows come from the Pilot's `watch` choice during night_act; otherwise it cycles through three-row sections every 6 s;
  - it renders about 8 times a second, only when you are the Pilot (seat `'Cockpit'`) and not in a cutscene set. The label strip is drawn on a small canvas.
- Check: a capture of the monitor at night with a watch choice.

### Task 3: The jump seat guest in person, and the door
- `People.sync` away entries take an optional `sit` spot. The guest walks through the door into the jump seat and sits there all night, visibly; at dawn they walk back.
- `Actor`: `goAway(door, sit?)` builds a path door → inside → seat. At the end it sits (`away` with a seat stays drawn and seated).
- `FlightDeck.setDoor(open)` swings the door smoothly.
- `Cabin3D` opens it while anyone is within 0.9 m of the doorway (`people.anyNear`).
- Check: a capture from the Pilot's seat looking back at the guest.

### Task 4: PA voice
- `protocol.ts`: `ClientMessage` gains `{t:'pa', on:boolean}`, and `ClientState` gains `pa?: string | null`.
- `host.ts`: `peer.pa`, which only a living Pilot can hold, and only by day (dawn, discussion, vote, verdict). `stateFor` sends `pa`. It is cleared when the phase changes to one without the PA, or when he stops.
- `client.ts`: `sendPa(on)`.
- `voiceRules.ts`: `paPhase(kind)`.
- `voice.ts`: when `state.pa === speaker`, gain is 1 for everyone, through a band-pass filter (1.7 kHz, Q 0.8) and light drive, placed at the listener.
- `World.tsx`: hold **P** (keydown/keyup; releasing or losing focus ends it), a press-and-hold "PA" chip for touch, and an "On air" badge.
- `Cabin3D`: a ding when someone goes on the air.
- Tests: `voiceRules` `paPhase`, and the host relays `pa` only from a living Pilot by day.

### Task 5: Boarding into the cockpit, and the endings from the flight deck
- `controls.boardScript`: when the target is forward of the start (`to.z < from.z`), walk forward through the galley and the door, then sit facing forward.
- `endings.ts`:
  - Home: the Pilot looks through the windscreen. `restTarget` for the Pilot is straight ahead.
  - Hijack, loyal Pilot: the leader walks to the flight deck door and hammers on it (thuds, shake); the door bursts open (`ctx.setCockpitDoor(true)`); the leader steps in and aims at the Pilot, and the Pilot puts his hands up.
  - Hijack, rogue Pilot: he gets up, opens the door for them, and sits back down to bank the plane.
  - The Pilot's camera shows the view out the windscreen as the plane banks.
- `EndingContext` gains `setCockpitDoor(open | null)`, where null gives the door back to the proximity rule.

### Task 6: Ship M14
- `npx tsc --noEmit -p . && npx vitest run && npm run build`, merge to main, push, check the deploy, update memory.
