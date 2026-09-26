# Release pass (2026-09-26)

The goal is a public release. This list comes from two read-only audits (gameplay and UI flows; audio and 3D feedback), plus playtest reports. A tick means fixed and verified; the notes say how.

## Gameplay and UI

- [x] G1 **Tutorial stalls 30 min when a scripted bot's action is refused.** For example, the Pilot calls a bot up to the jump seat and its night-1 cue fails. Fix: a refused cue falls back to the bot's own choice.
- [x] G2 **Leaving a browser-hosted flight doesn't pause it.** The phase ends the moment the host comes back, although the dialog promises a pause. Fix: pause on close and resume on reopen.
- [x] G3 **The Pilot's other calls are cut off 3 s after the seatbelt.** Fix: the flight deck needs an explicit "done", or a longer grace.
- [x] G4 **The compact mirror misses a Rogue Pilot's seatbelt, which gives the rogue away.** Fix: use `isPilot`.
- [x] G5 **Private jet: the Stewardess's check reads "and undefined".** "A, B and C" / "three seats" are also wrong on the jet.
- [x] G6 **Defused bombs still show as live, on the seat map and in 3D.** (Also A5.)
- [x] G7 **The Bomber lesson's fuse defaults to 2, but the coach assumes 1.**
- [x] G8 **"Pilot must fly" text is wrong for saboteurs when the Pilot is rogue.**
- [x] G9 **Sleeping pills: the 2D screen never says so, and the engine still takes the target's actions and items.**
- [x] G10 ~~A cuffed pin-holder sees ghost chat and a live Skip.~~ Fixed in M40: not a ghost while the pin might free them, and no vote.
- [x] G11 **Fuses can outlast the flight without a warning, and bots waste late bombs.**
- [x] G12 **The Bermuda blackout still shows seats on vote cards, the lunch list and whisper targets.**
- [x] G13 **A paused control-tower flight is stuck if the tower disconnects.**
- [x] G14 **Custom bomb roles show wrong bomb counts.**
- [x] G15 **"+30 seconds" does nothing once everyone has submitted (early end).**
- [x] G16 **"Vote after an incident" mode:** the text promises a vote, the frequent-flyer card is wasted, and the rule line is wrong.
- [x] G17 **Stale "!" badges and "your move" nags:** the Pilot at lights-out, drugged players.
- [x] G18 **The cart and the Stewardess drift apart.** A runaway cart snaps back to her next night, and a second Stewardess gets a teleported cart. (The tutorial start was fixed in M40.)
- [x] G19 **The rogue Stewardess is told she eats the drugged food too.**
- [x] G20 **The Pilot lesson says "switch the chat to PA", but PA isn't a chat channel.**
- [x] G21 **The boarding pass card may not show on the next flight in 2D.** Its dismissal key has no game id.

## Audio and 3D feedback

- [ ] A1 **The 2D screen (and no-WebGL players) has no sound at all.**
- [ ] A2 **The engine drone gets stuck at full power after the hijack or landing endings, and spools down too early.**
- [ ] A3 **Blast damage (scorch, cart and lavatory gone) shows about 1.25 s before the blast.**
- [ ] A4 **The tutorial picker is silent on a first visit.** The audio is never unlocked.
- [ ] A5 **Defused devices keep blinking.** There's no snip sound and no PA.
- [ ] A6 **Restrained players cut to the rear galley with no fade.**
- [ ] A7 **The seatbelt sign lights over you with no chime.**
- [ ] A8 **Poison deaths have no sound, no PA, and turn grey instantly.**
- [ ] A9 **Nothing marks the vote opening, and there's no PA for "no one restrained".**
- [ ] A10 **A stray chime plays at 1.2 s into every ending, including the hijack and ghost ones.**
- [ ] A11 **The PA ding-dong overlaps the turbulence chime and the restraint zip.**
- [ ] A12 **Every PA key press plays a 1.9 s ding-dong for everyone.** It needs a cooldown.
- [ ] A13 **Rough air makes no sound or shake.**
- [ ] A14 **A course change has no announcement.**
- [ ] A15 **Thunder uses the turbulence rumble, which is a gameplay signal.**
- [ ] A16 **The engine drone and cabin air play in the hotel and the gate.**
- [ ] A17 **Finding a bomb under your own seat makes no sound.**
- [ ] A18 **The cart rolls silently.** Only a runaway makes noise.
- [ ] A19 **The lavatory door never opens, and people pop in and out.**
- [ ] A20 **The flight deck door is silent in play.**
- [ ] A21 **Human chat is silent in 3D, and there's no private notification for whispers and team chat.**
- [ ] A22 **Your own death and rising as a ghost are silent,** as are the poison and sleep vignettes.
- [ ] A23 **Oxygen masks drop silently.**
- [ ] A24 **`thud` and `setEngine` cap at 1, so the hijack crescendo and reverse thrust flatten.**
- [ ] A25 **The ghost ending is silent.**
- [ ] A26 **The hijack opens with bomb beeps.** They use `setTimeout`, so skipping doesn't cancel them.
- [ ] A27 **The arrest and escape endings have almost no sound.**
- [ ] A28 **There's no runway rumble on takeoff and no tyre chirp at touchdown.**
- [ ] A29 **Lunch trays pop in and out, with no clinks.**
- [ ] A30 **Votes make no sound, and yours has no confirmation.**
- [ ] A31 **No clock tick in the last seconds when you still need to act.**
- [ ] A32 **Flight deck controls don't click, and a refused control makes no sound.**
- [ ] A33 **Other people's footsteps and claps are silent.**
- [ ] A34 **The voice PA squelch ignores Sound off, and blast muffling doesn't reach voices.**
- [ ] A35 **Items give no feedback in 3D** (frequent-flyer card, pills, mirror and the rest).
- [ ] A36 **Hotel: unpacking is silent, and there's no "full" blip.**
- [ ] A37 **Safety card: no hover or pick sounds.**
- [ ] A38 **Gate scan: no scanner chirp.** Success reuses the bomb beep.
- [ ] A39 **Cues pile up and all fire late after switching tabs.**
- [ ] A40 **The sound slider plays no preview.**
