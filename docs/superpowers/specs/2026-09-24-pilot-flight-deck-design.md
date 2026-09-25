# The Pilot remake: the flight deck

The Pilot leaves his seat and flies Flight 13 from a real cockpit. He has much more control, and his card can now turn rogue. The user chose every power and wants all of them usable every night.

There are two deploys:
- **M13** covers the rules, the screens and bots, plus a plain flight deck room so the Pilot has a view. It is fully playable.
- **M14** adds the 3D flight deck, PA voice and the cutscenes.

## Who the Pilot is

- The Pilot card deals `pilot` (loyal, passengers) or the new `pilot_rogue` (saboteurs).
  - It turns rogue with the new host setting `pilotRogueChance`: default 0.3, with a slider like the Stewardess's.
  - `isPilot(role)` covers both. A rogue Pilot knows his teammates and gets the saboteur channel, like any saboteur.
- The Pilot card only turns rogue while the saboteurs would still be outnumbered: `(saboteurs + 1) * 2 < players` at the deal. `validateCards` does not count it towards the minority check; counting it would rule out the 4–6 player presets.
- `validateCards` allows at most one Pilot: "Only one Pilot fits on the flight deck."
- His place is the cockpit: `seat = 'Cockpit'`. The grid gets `COCKPIT = 'Cockpit'` and `isCockpit(id)`.
  - `parsePlace('Cockpit')` is `{ row: -3, col: AISLE_COL }`, four rows in front of row 1. That is beyond the reach of every distance rule (blast 2, cuffs 2, whispers 2, Nurse 1, sweep 1).
  - It is not a seat: `isSeatInCabin`, `allSeats` and `emptySeats` never include it.
- Everyone can see who the Pilot is, because the seat map shows him in the cockpit. His team is secret.
- He never moves: his move is always 'stay', and he cannot use the washroom ("You cannot leave the flight deck.").
- If he dies or is restrained, the autopilot flies on and the flight lands on schedule.
- "Pilot must fly" is unchanged. Restraining the loyal Pilot, with no loyal Pilot left free, hands the saboteurs the win. Restraining a rogue Pilot never does.

## Lights out (night_move): every night

All four calls are available the same night. None of them work if the Pilot is buckled in by turbulence or is knocked out tonight (see below).

- **Seatbelt sign** (existing intent `seatbelt {target}`): one person cannot move or act tonight, and never the same person two nights running.
- **Jump seat** (new intent `jumpseat {target | 'none'}`): he calls one person (any active player but himself, and the same guest may be called night after night) up to the flight deck for the night. The guest has no choice. Tonight the guest:
  - stays in the cockpit instead of changing seats or using the washroom (an unused washroom trip is not spent);
  - is out of reach of bombs, handcuffs, the Nurse and sleeping pills;
  - can only be poisoned by the coffee (see below);
  - loses their own ability, with two exceptions: a Nurse guest may `treat` the Pilot, and a saboteur guest may `knockout` the Pilot;
  - is back in their seat by morning.
  - A guest who is buckled in (seatbelt sign, rough air or turbulence) cannot come up. The call fizzles and the Pilot is told.
  - The trip is public, like the washroom: a log line to everyone ("Anna was called up to the flight deck."), and the map shows the guest in the cockpit.
- **Rough air** (new intent `roughair {startRow | null}`, once per flight, `PlayerState.roughAirUsed`): he buckles everyone seated in rows `startRow`..`startRow + 2`, plus any Stewardess working those rows. `startRow` runs from 1 to `rows - 2`.
  - It uses the new buckle reason `'rough'`. An extender frees you as usual.
  - The cabin hears: "The plane bucked through rough air over rows 4–6."
- **Change course** (new intent `course {change: 'hold' | 'shortcut' | null}`, once per flight, `PlayerState.courseUsed`): either Pilot may pick either change.
  - `hold` adds a night: `s.nights + 1`.
  - `shortcut` lands a night earlier: `s.nights - 1`. It is only allowed while `s.nights - 1 >= s.phase.night`, so it can never end the flight before tonight.
  - It applies when seats change. Everyone hears "The captain is holding: Flight 13 now lands after night 6." or "The captain is taking a shortcut: …"

Resolution order in `resolveMoves`:
1. course change
2. rough air
3. seatbelt sign
4. jump seat (the guest goes up unless buckled)
5. seat changes and the washroom (the guest's own move is skipped)
6. the cart follows the Stewardess

Early end: the Pilot never needs a move (it is always 'stay'), and he counts as done once he has a seatbelt choice. The panel's Done button sends `'none'` when he has not picked anyone.

## In the dark (night_act)

- **Cabin cameras** (new action `watch {startRow}`, Pilot only, every night): he watches rows `startRow`..`startRow + 2`. At dawn his private log lists what the cameras saw. Anyone sitting in those rows (or a Stewardess working them) is visible, doing something or having something done to them:
  - Looking under your seat and planting a bomb under your seat both read "Carl bent down under his seat".
  - Checking the cart and planting on the cart both read "Carl fiddled with the drink cart". Bombers can always deny it.
  - Treating: "Dana leaned over to Ben". A Stewardess check: "The Stewardess checked under 5A–5C". Poison: "The Stewardess handed Ben a drink".
  - Handcuffs: "Eve snapped handcuffs on Ben". Pills: "Carl slipped something into Ben's water". Flashlight: "Carl shone a light under 5B".
  - A sweep: "Fay looked around the seats near her". Nothing seen: "The cameras showed rows 4–6 sleeping."
- **Jump seat guest**: in the cockpit only `treat` (the Pilot, by a Nurse), `knockout` (the Pilot, by a saboteur) or resting are allowed. Anything else: "You are on the flight deck tonight."
- **Knockout** (new action `knockout`) resolves right after the handcuffs.
  - The Pilot's camera look tonight fails, and `PlayerState.knockedOutNight = n + 1`. All his calls and his cameras are off next night; the PA by day still works.
  - He is told who did it: "Carl knocked you out cold."
  - A black-box line records it. It is not announced to the cabin; the Pilot can tell them on the PA.
- **Poisoned coffee**: a rogue Stewardess working row 1 may `serve` anyone on the flight deck, meaning the Pilot or his guest. The poison rules are as usual.
  - The only cure for the Pilot is treatment by a Nurse in the jump seat, or an antidote.
- **Blasts** never reach the cockpit. Anyone there tonight, the Pilot or his guest, is skipped explicitly as well as by distance.

## By day: the PA

- **Typed announcements**: a new chat channel `'pa'`, posted with the existing chat intent.
  - Only an active Pilot can post, only by day (dawn, discussion, vote, verdict), at most 140 characters, once every 15 seconds.
  - Everyone sees it, including ghosts and the control tower.
  - The 3D view and the 2D screen show it as a caption: "Captain Kay: …".
- **PA voice** (M14, network only): while the Pilot holds **P** (or presses a PA button on touch screens), everyone with voice on hears him at full volume.
  - It passes through a speaker filter (band-pass 300–3400 Hz with slight drive) and starts with the chime.
  - By day only, following the voice rules. The client sends `{t:'pa', on}`; the host checks the phase and passes it on to everyone.

## Views and options

- `PlayerView`:
  - `jumpseat: string | null`: who is on the flight deck tonight (night_act only).
  - `YouView` gains `roughAirUsed`, `courseUsed`, `knockedOut` (true while the Pilot is out tonight) and `inJumpSeat` (you are the guest tonight).
- `OptionsView` gains:
  - `jumpseat: string[]`;
  - `roughair: number[]`: valid start rows, empty once used;
  - `course: ('hold' | 'shortcut')[]`.
  - Camera looks go in `actions` as `watch` options.
- `MineView` gains `jumpseat`, `roughair` and `course`.
- `normalizeGame` fills in the new fields, and `normalizeSettings` fills in `pilotRogueChance` for old saves.

## Bots

A bot Pilot:
- turns the seatbelt sign on as now;
- calls a random guest half the time;
- uses rough air one night in ten;
- when loyal, holds on the second-to-last night half the time;
- when rogue, takes the shortcut on the last night it is allowed, half the time;
- always watches a random section.

A saboteur guest knocks the Pilot out 30% of the time. A Nurse guest treats a poisoned Pilot.

## Screens (M13)

- **Seat map**:
  - a cockpit block in front of the galley, with the Pilot's badge and the guest's name when there is one;
  - three-row sections can be picked (tap a row number or any seat in a row) and are previewed in cyan (cameras) or amber (rough air).
- **Action tab, Pilot**:
  - lights out: a Flight deck panel with the seatbelt sign, jump seat, rough air (once), change course (once, showing the new landing night) and Done;
  - in the dark: the camera section picker, or a knocked-out notice;
  - by day: a PA announcement box with the time until the next one.
- **Action tab, guest**: "You are on the flight deck", with Treat the Pilot (Nurse) or Knock him out (saboteurs), or rest.
- **Settings**: a Pilot rogue odds slider.
- **Boarding pass**: SEAT reads "FLIGHT DECK".
- **Chat**: `'pa'` messages are highlighted as the captain's.
- **Role texts** are rewritten for both Pilots.

## The flight deck in 3D (M14)

- **Where it is**: a cockpit room in front of the galley, entered through a door marked FLIGHT DECK.
  - The door opens for the guest at night and in the hijack. From the cabin you only see the closed door past the curtain.
- **Inside**:
  - The captain's seat (left) holds the Pilot's camera. The first officer's seat (right) is empty. The folding jump seat sits in the corner behind the first officer, clear of the door's swing, with its own small screen on an arm (the first officer's seat would hide his screen from back there).
  - A dim dome light keeps whoever is up here visible at night.
  - The windscreen panes show the same skies as the cabin windows, and the runway during takeoff and landings.
  - The instrument panel carries a live flight display (horizon, speed, altitude), the Pilot's game screen on the centre display, a camera monitor and an overhead seatbelt switch.
  - The camera monitor is a small render target (256×160, about 8 fps) from a ceiling camera over the watched rows. It is drawn only while the Pilot is looking from the cockpit. The cameras see in the dark (a light that shines only while they render), and a strip under the screen names the camera and rows.
- **People**: the guest walks up the aisle and through the door, then sits in the jump seat. The Pilot's own body sits at the controls.
- **Boarding**: the Pilot turns left at the aircraft door into the cockpit and sits down.
- **Takeoff**: through the windscreen, the runway runs past and the nose rotates up.
- **Endings**:
  - arrest and escape: the Pilot sees the touchdown through the windscreen;
  - hijack with a loyal Pilot: hammering on the door, then it bursts open and a gunman aims;
  - hijack with a rogue Pilot: he opens the door himself and banks the plane.
- **Automatic PA lines** from the director are labelled "Flight deck" rather than "Captain", so they are not mistaken for the Pilot player.

## Testing

- **Engine tests**:
  - dealing and odds, and settings validation;
  - the cockpit's reach: blasts, handcuffs, Nurse, whispers;
  - the jump seat: moves, the washroom conflict, buckled guests, safety, knockout, the Nurse treating the Pilot;
  - poisoned coffee;
  - cameras: every sighting text and the deniability pairs;
  - rough air, and course changes including their bounds;
  - PA posts: Pilot only, by day, cooldown, length, everyone sees them;
  - views and options, and the bot simulation invariants.
- **Network tests** for the PA voice relay (M14).
- **3D** checked by canvas captures, as in earlier milestones.
