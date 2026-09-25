# The Pilot's controls around him, and the camera replay (M18)

2026-09-25. The user asked for the Pilot's controls "all around him and not all in his tablet", a seatbelt button above him, and cameras that replay what happened when clicked. They picked four parts: overhead seatbelt switches (then pick the passenger on the camera monitor), a camera monitor replay, a jump seat intercom plus a PA handset, and a rough air lever plus a course dial on the pedestal. Then they said "DO ALL", so the details below are my calls.

## Controls

The Pilot uses each control from the captain's seat: aim the crosshair at it and click, or tap it on a touch screen. While aimed at, the crosshair lights up and a label names the control.

| Control | Where | What it does | When |
| --- | --- | --- | --- |
| Seatbelt switch | Overhead, on the forward edge above the captain | Opens the camera console to pick a passenger, or No one | While seats change |
| Camera monitor | Pedestal, forward | Opens the console: aim tonight's cameras in the dark, replay last night's tape by day, and show the live feed otherwise | Always |
| Cabin intercom (CALL) | Middle of the instrument panel, above the monitor | Opens the console to pick who comes up to the jump seat, or Nobody | While seats change |
| Rough air lever (RIDE) | Pedestal, on the captain's side | Opens the console to pick three rows and fly through them, or call it off. Once per flight | While seats change |
| Course dial (HDG) | Glareshield, in front of the captain | A small card: Hold, Shortcut or Keep course. Once per flight | While seats change |
| PA handset | Left side console | By day, picking it up puts the Pilot on air (with voice); click again or press Esc to hang up. Without voice, it opens a card to type an announcement | By day |

- Clicking a control outside its phase shows a HUD caption that says when it works.
- Each control shows its state:
  - the seatbelt switch flips down and its lamp glows while the sign is on for someone;
  - the CALL light glows while a guest is called up;
  - the lever sits pulled back while rough air is set;
  - the dial points at HOLD or SHORT;
  - the handset lifts off its cradle while the Pilot is on air.

## The camera console

The console is a framed CCTV screen over the middle of the view. Cabin3D draws the camera straight into that rectangle of the main canvas, full-size and sharp, with a night-vision tint. It frees the mouse the way the seatback screen does, and Esc or ✕ closes it.

- **Header:** `CAM 2 · ROWS 4–6 · LIVE`, or `NIGHT 3 · 02:41 · REPLAY` while a tape plays.
- **Rows:** ◀ and ▶ move the camera one row at a time, since the watch and rough air can start on any row.
- **Seatbelt and jump seat modes:** name tags float over the passengers in view.
  - Allowed targets are buttons; the rest are greyed out, with the reason as a tooltip.
  - A No one (or Nobody) button, and the current choice highlighted.
- **Watch mode (in the dark):** "Watch rows a–b tonight" and "Rest tonight", with the current choice.
- **Rough air mode:** "Fly rough air over rows a–b" and "Call it off".
- **Replay mode:** plays the tape once and offers Replay. Below the feed, a list of what the cameras caught. When nothing happened, the list says "Nobody stirred in rows a–b."

## The replay

- **Data:** the Pilot's latest `watch` log entry, `data.rows` and `data.seen`. Each sighting now carries the engine's own caption as `text`.
- **Stand-ins:** extra actors `tape:<player id>` for everyone who sat in the rows that night, plus one row either side.
  - Cabin3D takes their seats from a snapshot it keeps during the night. After a reload it falls back to current seats.
  - Stand-ins are drawn only in the camera render, and while a tape plays the live actors are left out of it. The dead of that night are alive on the tape.
- **Clips:** each sighting gets about 3.5 s, with a caption and a night clock. The actor acts it out:
  - `under_seat`: ducks;
  - `lean`: reaches toward the target, or rummages if treating themselves;
  - `drink`: hands the target a drink;
  - `check`: ducks at the row;
  - `look_around`: stands and looks both ways;
  - `cuff`: stands and reaches for the target, who puts their hands up;
  - `flashlight`: points under the seat;
  - `pills`: reaches toward the target;
  - `cart`: reaches for the cart;
  - `lavatory`: stands and looks toward the lavatory.
- `world/tape.ts` is a pure plan: clips, timings and which stand-ins to make. Cabin3D plays it.

## The seatback screen

- **In 3D:** the Pilot's screen drops the flight deck pickers, the camera picker and the PA form. It shows a "Your controls" card instead, naming each control, where it is, and tonight's calls.
- **2D screen:** keeps every panel as it is.

## Engine

- `Sighting.text`: the camera's caption for that sighting.

## Tests

- `world/cockpit.ts`: which controls work in each phase, their labels and reasons, and what state they show.
- `world/tape.ts`: clip order and timing, stand-in seats and the fallback to current seats, and a quiet night.
- Engine: sightings carry their text.
- Browser check of every control, the console modes and a replay.
