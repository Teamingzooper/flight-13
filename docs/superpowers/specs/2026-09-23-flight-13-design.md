# Flight 13 — Design Spec

- **Date:** 2026-09-23
- **Status:** Approved in chat ("go")
- **Hosting:** GitHub Pages, peer-to-peer multiplayer (no game server)

## 1. Summary

Flight 13 is a browser-based multiplayer social-deduction game in the lineage of Town of Salem,
Mafia, Ultimate Werewolf and Among Us. Every player is a passenger strapped into a seat of a 3D
airliner cabin, seen in first person. A hidden **Saboteur** team plants bombs and poisons drinks;
the **Passenger** team must find and restrain them before the plane lands. Nearly all interaction
happens through each player's seatback TV.

## 2. Goals and non-goals

**Goals**
- Friends play online by sharing a short flight number (join code) or a link.
- Hosted entirely on GitHub Pages. No game server: the host's browser is authoritative.
- Atmospheric first-person 3D (seated view, strong lighting, smooth avatar animation), minimal HUD,
  diegetic seatback-TV interface.
- A deterministic, fully unit-tested rules engine that knows nothing about rendering or networking.

**Non-goals for v1**
- Voice chat, accounts, public matchmaking, joining mid-game (reconnects are supported),
  host migration, photoreal graphics, neutral roles (e.g. a Jester-style role may come later).

## 3. Architecture

```
GitHub Pages (static files) ──> browser app (Vite + TypeScript)
  src/engine/  pure rules: state, intents, night/day resolution, redacted views (no DOM, no network)
  src/net/     transports (Trystero WebRTC, in-memory), HostSession, ClientSession, protocol
  src/tv/      seatback TV app (Preact) — also runs full-screen as the 2D mode
  src/app/     hash routing, landing, booking (host setup), boarding (lobby)
  src/world/   Three.js cabin, lighting, avatars, cinematics, audio (milestones 3–5)
```

- **Host-authoritative P2P.** The player who books the flight runs `HostSession`, which owns the
  authoritative `Session` (lobby + `GameState`), validates every intent, and advances timers. The
  host also runs a normal `ClientSession` connected through an in-memory link, so the host plays
  through the same code path as everyone else.
- **Clients** connect to the host over WebRTC data channels via **Trystero** (Nostr signaling, no
  accounts). Clients send *intents*; the host answers each player with their own redacted
  `PlayerView`. Secret state leaves the host only inside the recipient's own view.
- **Avatar pose** (head yaw/pitch, small animation flags) is broadcast directly peer-to-peer at
  ~10 Hz; it is not secret. Pose flags that could leak roles (e.g. "using TV") are suppressed at night.
- **Resilience.** The host saves the session to `localStorage` on every change; reloading the host
  tab resumes the flight. Clients keep a token in `localStorage` and get their seat back after a
  refresh. Host timers tick from a Web Worker so a backgrounded host tab does not stall.
- **Transport seam.** A `Transport` interface has `TrysteroTransport` (production) and
  `MemoryTransport` (tests and the host's local client). A future Cloudflare Durable Object server
  could host the same engine without a rewrite.
- **Known trade-offs (accepted):** the host's browser holds all roles (a host with dev tools could
  peek; "Control tower" mode lets a non-player host); the flight pauses if the host leaves; some
  strict networks block P2P (a TURN relay can be added later).

**Deployment:** public repo `Teamingzooper/flight-13`; GitHub Actions runs tests, builds, and deploys
to `https://teamingzooper.github.io/flight-13/`. Hash routing (`#/f/7K2Q`) so deep links work on Pages.

## 4. Game flow

`boarding (lobby) → takeoff → [night_move → night_act → dawn] → [day_discuss → day_vote → verdict] → … → ended`

| Phase | Standard timer | What happens |
|---|---|---|
| `takeoff` | 12 s | Takeoff cutscene; random seats; each TV shows the player's boarding pass (role) |
| `night_move` | 20 s | Lights out. Anyone may move once to an empty seat. Pilot picks a seatbelt target |
| `night_act` | 30 s | Abilities, using post-move positions. Everyone presses **Done** (Sleep) |
| `dawn` | 10 s | Resolution cutscene and morning report |
| `day_discuss` | 90 s | Cabin chat and whispers |
| `day_vote` | 30 s | Vote to restrain a suspect, or Skip |
| `verdict` | 8 s | Result; restrained player's role revealed (setting) |

- Timer presets: **Quick** (move 15, act 20, discuss 60, vote 20), **Standard** (above),
  **Relaxed** (move 30, act 45, discuss 150, vote 45). `takeoff`, `dawn`, `verdict` are fixed.
- A phase ends early (after a 3 s grace) once every eligible player has submitted. In `night_move`
  every active, unbuckled player confirms a seat or **Stay** (the Pilot also confirms a seatbelt
  target or **None**). In `night_act` *every* active, unbuckled player must press **Done** —
  including role-less Passengers — so phase timing never reveals who has an ability. In `day_vote`
  every active player has voted.
- Nights are numbered `1..N`, where `N` is the destination's length. Day `k` follows night `k`.
  After day `N`'s verdict the plane lands.
- Seat positions are always public (the TV seat map shows who sits where), so night moves are a
  major source of clues.

## 5. Win conditions

Checked after every dawn and every verdict. A player is **active** while alive and not restrained.

1. **Passengers win** when no saboteur is active and at least one passenger is active.
2. **Saboteurs win** when active saboteurs ≥ active passengers (with at least one saboteur active).
3. **Landing:** after day `N`'s verdict, if any saboteur is still active, **Saboteurs win**.
4. **No survivors:** if nobody is active, the result is a draw.

`voteMode = "daily"` (default) holds a vote every day. `voteMode = "afterIncident"` (the original
idea, available as a host toggle) skips `day_vote` when the preceding dawn had no death or explosion.

## 6. Cabin model

- Columns `A B C | aisle | D E F` map to indices `0..6`; the aisle is index `3`.
- Rows `1..R`, front to back. `R` = 8 rows when max passengers ≤ 8, 10 rows when ≤ 12, 12 rows when ≤ 16
  (48 / 60 / 72 seats).
- Seat ids are `${row}${letter}`, e.g. `12C`.
- **Distance** is Chebyshev: `max(|Δrow|, |Δcol|)` over grid cells; the aisle counts as a cell.
- **Adjacent** means distance 1. Aisle seats are C and D (seat C and seat D are distance 2 apart).
- **Galley** sits in front of row 1. **Lavatory** occupies cells `(R+1, A..C)`; seats adjacent to it
  are `R`A, `R`B, `R`C.
- **Drink cart** occupies the aisle cell of one row; it starts at row 1.
- At takeoff every player gets a uniformly random seat.
- Dead players stay slumped in their seats (seat unavailable). Restrained players are taken to the
  rear galley (their seat becomes free).
- Dead and restrained players become **ghosts**: they keep public information, read the cabin chat,
  and talk in the ghost channel; they learn hidden roles only when the game ends.

## 7. Roles

The host chooses how many of each special card to include; everyone else is a **Passenger**.

### Passenger team

| Role | Ability | Timing | Requirement |
|---|---|---|---|
| Passenger | None — moves, chats, votes | — | — |
| Pilot | `seatbelt(target)`: target cannot move or act tonight | `night_move` | Not self; not the same target as the previous night |
| Nurse | `treat(target)`: target cannot die tonight, existing poison is cured, poison applied tonight fails | `night_act` | Target within distance 1; self-treat once per game |
| Investigator | `sweep`: finds seat bombs within distance 1 of own seat; or `inspect(cart \| lavatory)` | `night_act` | Inspect requires adjacency to that object (and it must not be destroyed) |
| Stewardess (loyal) | `serve(target)`: learns target's team; the cart rolls to target's row | `night_act` | Any other living player |

### Saboteur team

Saboteurs know each other (names and roles), share a private night chat, and see all team bombs.

| Role | Ability | Timing | Requirement |
|---|---|---|---|
| Bomber | `plant(where, fuse)` once per game; `where` ∈ own seat, cart, lavatory; `fuse` ∈ {1, 2} | `night_act` | Cart: own seat adjacent to the cart. Lavatory: own seat adjacent to the lavatory. Target object not destroyed |
| Mastermind | Same as Bomber; appears as **Passenger team** to the Stewardess | `night_act` | Same as Bomber |
| Stewardess (rogue) | `serve(target)`: poisons target (fails if treated); the cart rolls to target's row | `night_act` | Any other living player |

- **Stewardess card:** its team is rolled when roles are dealt — rogue with probability
  `stewardessRogueChance` (default 0.5). Both versions look identical from outside: the cart moves
  to the served row. Served players are **not** told they were served (poison victims learn at dawn).
- **Bombs:** a bomb planted on night `n` with fuse `f` detonates during the resolution of night
  `n + f` (after that night's moves). Blast = every cell within distance 2 of the bomb's cell(s):
  a seat bomb's seat; the cart's *current* cell (so the Stewardess can unknowingly deliver it; cart
  blasts reach both sides of the aisle); the lavatory's three cells. Every living player seated in
  the blast dies unless treated tonight. A cart bomb destroys the cart; a lavatory bomb destroys the
  lavatory. Bombs outlive their planter. Bombs that have not detonated at landing never do.
- **Poison:** a player poisoned on night `n` is told at dawn `n` that they feel sick, and dies at
  dawn `n + 1` unless the Nurse treats them on night `n + 1`.
- **Investigator results** list the exact bomb locations found and how many nights until each goes off.
- **Stewardess results** report the target's team ("Passenger team" / "Saboteur team").

### Role presets (special cards; the rest are Passengers)

| Players | Bomber | Mastermind | Stewardess | Pilot | Nurse | Investigator |
|---|---|---|---|---|---|---|
| 4 | 1 | 0 | 1 | 1 | 1 | 0 |
| 5–6 | 1 | 0 | 1 | 1 | 1 | 1 |
| 7–9 | 2 | 0 | 1 | 1 | 1 | 1 |
| 10–12 | 2 | 1 | 1 | 1 | 1 | 1 |
| 13–16 | 3 | 1 | 1 | 1 | 1 | 2 |

Validation: at least one Bomber or Mastermind; special cards ≤ players.

## 8. Resolution order

**Start of `night_move`:** turbulence (destination twist) buckles its victim immediately and is
announced publicly; that player cannot move or act tonight.

**End of `night_move`:**
1. Apply Pilot seatbelts. Buckled players' moves are discarded and they are notified.
2. Resolve moves. A destination must have been empty at the start of the night (no living player
   and no body). If several players picked the same seat, one random claimant gets it; the others
   stay and are notified.

**End of `night_act` (dawn of night `n`):**
1. Discard actions from buckled or inactive players; re-validate every action against current
   positions (invalid actions fizzle and the actor is told why). All adjacency checks use post-move
   seats and the cart's position during `night_act`.
2. Nurse treatments are recorded.
3. Bombs are planted.
4. Rogue Stewardess poison is applied (fails on treated targets).
5. Investigations resolve.
6. Loyal Stewardess results resolve; then the cart moves to the served row (serves processed in
   seat order), then any runaway-cart anomaly.
7. Bombs due tonight explode.
8. Poison from night `n − 1` kills untreated victims; treated victims are cured. Victims poisoned
   tonight are told they feel sick.
9. The morning report is compiled; win conditions are checked.

## 9. Day

- `day_discuss`: cabin chat; whispers to seats within distance 2 (everyone sees *that* a whisper
  happened, not its content).
- `day_vote`: each living player votes for a living player or Skip and may change their vote until
  the phase ends. Non-votes count as Skip. A player is restrained only if they have strictly the
  most votes **and** more votes than Skip. Votes are public by name unless `anonymousVotes` is on.
- `verdict`: the restrained player is removed to the rear galley; their role is revealed if
  `revealRoles` is on (default on). Deaths at dawn reveal roles under the same setting.

## 10. Destinations

| Code | City | Nights | Twist |
|---|---|---|---|
| LAS | Las Vegas | 3 | Quick hop, classic rules |
| LHR | London | 5 | Classic rules |
| HNL | Honolulu | 5 | Turbulence: at the start of each night one random active player is buckled in (public) |
| HND | Tokyo | 7 | Red-eye: discussion timer ×0.6 |
| BDA | Bermuda | 5 | The Triangle: each night one random anomaly — turbulence, runaway cart (the cart rolls to a random row at dawn), or blackout (next day the TV seat map hides names) |

The TV's flight map shows the plane's progress toward the destination, one night at a time.

## 11. Chat

| Channel | Who can write | When |
|---|---|---|
| Lobby | Everyone | Boarding |
| Cabin | Living players (ghosts read-only) | Day phases |
| Saboteurs | Living saboteurs | Night phases |
| Ghosts | Dead and restrained players | Any time |
| Whisper | Living players, to a seat within distance 2 | Day phases (setting `whispers`, default on) |

Messages are limited to 200 characters and one message per second per player.

## 12. Information and redaction

A `PlayerView` contains: the player's own role, team and status (poisoned, buckled); every player's
name, seat, life status, revealed role (if revealed) and connection state; cabin objects (cart row,
destroyed cart/lavatory, explosion marks); phase and time left; the player's own pending choices;
the vote tally (per settings); visible chat; the public log plus the player's private log.
Saboteurs also see teammates and team bombs; the Investigator sees bombs they found. When the game
ends, everyone sees everything, including the **black box** (full night-by-night timeline).

Redaction is a tested contract: tests assert that no view leaks another player's role, bombs,
poison status or private results.

## 13. Booking, boarding and settings

- **Booking (host):** destination, max passengers (4–16), role counts with a preset button,
  `stewardessRogueChance`, timer preset, `revealRoles` (on), `voteMode` (daily), `anonymousVotes`
  (off), `whispers` (on), **Control tower** (the host runs the flight without playing and sees
  only public information, like a ghost).
- **Flight number:** 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `FT-7K2Q`.
  Share link: `https://teamingzooper.github.io/flight-13/#/f/7K2Q`.
- Names are 1–16 characters and de-duplicated. At least 4 players are needed to take off.
  Doors close at takeoff; only reconnecting passengers may rejoin.
- After landing: the black box and a host button to **board again** with the same passengers.

## 14. Presentation (milestones 3–5)

- **Camera:** first person from the player's seat; mouse (pointer lock) or touch-drag look within a
  realistic head range; subtle breathing sway and turbulence shake.
- **Art:** stylized low-poly. The cabin (fuselage, seats, bins, windows with shades, galley,
  lavatory door, cart, seatback TVs, oxygen masks) is built procedurally in code. Characters use
  CC0 models and animations (Quaternius Universal Base Characters + Universal Animation Library, or
  KayKit), with randomized looks; procedural mannequins are the fallback.
- **Lighting:** day — warm sun through windows and shade shadows; night — blue moonlight, exit-sign
  glow, aisle floor lights, reading lights, faces lit by seatback screens. Post-processing: bloom,
  vignette, film grain, tone mapping.
- **Avatars:** other players' heads follow their look direction (interpolated), hands reach for the
  TV while it is in use (day only), players point at their vote target, seat changes animate as
  stand → walk the dark aisle → sit (the local camera follows the same path).
- **Moments:** takeoff roll and climb, lights-out transition, explosions (flash, shake, smoke,
  sparks, oxygen masks drop, scorch marks), poison slump, restrained passengers zip-tied and led aft.
- **Audio:** engine drone, seatbelt chime, PA ding with captain subtitles, explosions — synthesized
  with Web Audio.
- **HUD:** a center dot and a small phase clock. Everything else lives on the seatback TV: click it,
  the camera leans in, and the in-flight system opens with tabs **Map**, **Action**, **Chat**,
  **Vote**, **Flight**.
- **Devices:** desktop first; playable in phone browsers.

## 15. Testing

- Vitest unit tests: grid math, every ability, resolution order, voting, win conditions, landing,
  destinations, redaction.
- Bot simulation: thousands of seeded games with random legal actions across player counts and
  destinations; invariants (always terminates, consistent seating, no dead actors) and a win-rate report.
- Networking: `HostSession` + several `ClientSession`s over `MemoryTransport` play a complete bot game.
- Browser: multiple tabs connected over real Trystero to verify join, play, and reconnect.

## 16. Milestones (each deployed)

1. **Rules engine** — roles, phases, bombs, poison, voting, wins; tests and bot simulation.
2. **Online play in 2D** — Trystero networking, landing/booking/boarding, the TV app full-screen,
   GitHub Pages deploy. First version playable with friends.
3. **3D cabin** — interior, day/night lighting, seated camera, TV integrated in the world.
4. **Characters** — avatars, pose sync, sit/stand/walk/reach/point/death animations.
5. **Cinematics and polish** — takeoff, explosions, audio, destination twists, black box, mobile controls.
