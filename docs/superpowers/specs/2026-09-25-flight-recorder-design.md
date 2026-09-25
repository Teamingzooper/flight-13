# The flight recorder (M19)

2026-09-25. The user picked "Flight recorder replay" from the ideas list and then said "DO ALL" and "keep going", so the details below are my calls.

When a flight ends, everyone can watch it again, night by night: every secret action, every blast and every vote, with the roles revealed. The black box already lists these as text; the flight recorder shows them.

## What it shows

- **Reels:** one per night, and each reel is a list of clips. It starts with a title card ("Night 2") and everyone in the seat they had that night. Then come:
  1. the Pilot's calls: seatbelt sign, jump seat, rough air and course;
  2. every action in the order the night resolved them, including flashlights, sleeping pills and defusing;
  3. dawn: each blast and its victims, and poison deaths;
  4. the day's verdict.
- **Captions:** each clip's caption is the black box line for it (without the "Night n:" prefix), or the public line for blasts, deaths and verdicts.

## Where it plays

- **The end screen** gets a third view, **Flight recorder**, next to Everyone's roles and Black box. It is a 2D reel:
  - night tabs, and a seat map showing that night's seats (a copy of the view with the recorded seats);
  - the current clip's people highlighted, and a blast's reach shown on the map;
  - the clip list with the current clip lit, and Play/Pause stepping every 2.5 s. Clicking a clip jumps to it.
- **In 3D** the same view adds "Watch it in the cabin". That opens a recorder screen over the view, built like the camera console:
  - Cabin3D draws a ceiling camera over the row where the clip happens;
  - stand-ins play that night's cast (only the recorder sees them), lit as night, and act out each clip as the camera tape does;
  - blasts flash and their victims fall; poison victims slump; the restrained put their hands up;
  - the screen shows `FLIGHT RECORDER · NIGHT 2 · 02:10`, the caption, the clip list and Play/Pause, and it runs night after night to the end.
- It is available to everyone at the end, whatever seat they had, the dead included.

## Engine

- `GameState.recorder: NightRecord[]`, one per resolved night. Each record holds:
  - `seats`: everyone in play, before the handcuffs;
  - `washroom`, `jumpseat` and `cartRow`;
  - `acts`: what was actually done, after pills and handcuffs;
  - `items`: flashlight and pill uses.
- `normalizeGame` fills `recorder: []` for older saves.
- `PlayerView.recorder` is null until the flight has ended, and then it is the whole record.

## Plan

`world/recorder.ts` (pure) turns the view into reels. `planReels(game)` returns one `Tape` per recorded night. Clips gain:

- `row`: where the camera looks;
- `victims`: who falls in a blast or a poison death;
- new kinds: `caption`, `blast`, `slump` and `restrained`.

## Tests

- Engine: the recorder notes seats, acts after pills and handcuffs, items, and the washroom and jump seat. It is hidden until the end.
- Plan: clip order across a night (calls, acts, dawn, verdict); captions from the black box; blast victims; seats that night; a reel per night.
- A browser check of the 2D reel and the 3D recorder screen.
