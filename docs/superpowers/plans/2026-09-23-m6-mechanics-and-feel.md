# Flight 13 — Milestone 6: New Mechanics and First-Person Feel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three new mechanics the user picked — *Look under your seat*, *Black box notes*, the *Air Marshal*
role — plus a host rule *Pilot must fly* (restraining the Pilot hands the saboteurs the win). Make the
first-person camera feel physical like RE7 / Hellraiser: Revival (neck pivot, springs instead of lerps,
footsteps and gait, standing up and sitting down, turning into lean), a scripted search animation with a
phone flashlight, and a scripted glance at a bomb just before it goes off.

**Architecture:** Engine first, test-first (types → rules → resolution → views → bots). The search
resolves the moment it is chosen (a bomb under your seat can only have been left by an earlier occupant,
so nothing tonight can change the answer) and locks your action for the night. The 3D layer reads the
results from state: a new pre-roll step delays the blast (and the victims' deaths) while the camera turns
to look; your own body is driven by the camera rig during walks so you see your legs move.

**Tech Stack:** TypeScript engine + Vitest, Preact TV, three.js.

---

### Task 1: Engine — types, settings and roles

- `RoleId` + `'marshal'` (Air Marshal, passengers); `SpecialCard` + `'marshal'`; presets add a Marshal from
  10 passengers up.
- `Settings.pilotMustFly` (default false); `normalizeSettings()` fills fields missing from old saves;
  `cleanSettings` accepts settings without the new fields.
- `NightAction` + `{ kind: 'search' }` + `{ kind: 'cuff'; target }`; `Intent` + `{ kind: 'note'; text }`.
- `PlayerState.note` (≤ 300 chars), `cuffsUsed`; `NightChoices.searched`; `GameResult.reason` + `'pilot'`;
  `LogTag` + `'note' | 'search' | 'cuff'`. `normalizeGame()` for restored snapshots.

### Task 2: Engine — rules and resolution (test-first)

- `checkAction`: search allowed for anyone seated; cuff only for the Marshal, once per game, target active
  and within 2 seats.
- `applyIntent('act', search)`: resolves immediately (private log, found bombs join `knownBombIds`) and
  locks the night's action. `applyIntent('note')`: any time while in play.
- `resolveNight`: cuffs first (target restrained, their action cancelled, public log without naming the
  Marshal), then the existing order. Notes are read out (public `note` log) whenever someone dies or is
  restrained, at night or by vote.
- `checkWin`: after "no saboteurs left", `pilotMustFly` + a restrained Pilot with no free Pilot left →
  saboteurs win (`reason: 'pilot'`).
- Views: `you.note`, `you.cuffsUsed`, search in `options.actions`. Bots may search or cuff.

Tests: search finds a bomb left by the previous occupant and locks the action; search with nothing there;
cuff restrains and cancels the target's plant; cuff range and once-per-game; notes read out on blast,
poison, vote and cuff; pilot rule on/off; presets include the Marshal and stay valid; old settings clean.

### Task 3: TV

- Action tab: "Look under your seat" for everyone (with the result), Air Marshal cuff picker, a *Black box
  note* editor; the private log panel is renamed "Your log". Verdict card reads the restrained player's
  note; boarding pass and role strip warn the Pilot when *Pilot must fly* is on. Settings form: Marshal
  card and the new rule. `describeAction` for search and cuff; end-screen text for `'pilot'`.

### Task 4: First-person rig

`controls.ts` rewrite around a body + neck: springs for position, lean and look; turn roll; neck pivot
parallax; walks as stand-up → aisle gait (step-phase bob, sway, footsteps) → sit-down with a settle;
`glance(point, seconds)` to look at something; `search(seatPose)` scripted crouch-and-look; `slump()` on
death. Your own actor follows the rig while walking or searching.

### Task 5: Cabin moments

- Bomb devices (known bombs only) with blinking LEDs. Search: close the TV, crouch and look with a phone
  flashlight, then reopen the TV with the result. Explosion: close the TV, glance at the blast point while
  the device beeps faster, then the blast; victims die at the blast, not before; lights and the dawn report
  wait for it. Captions read out black box notes and arrests.
- Audio: footsteps, fuse beeps, flashlight click, cloth rustle.

### Task 6: Verify and ship

Tests, type-check, build; browser: search animation with and without a bomb, cuff, note read-out, pilot
rule, explosion glance; commit, merge, push, deploy check.
