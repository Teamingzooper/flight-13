# M38: The safety card (tutorial picker and role lessons)

## What the player sees

1. On the Terminal, **Tutorial flight** no longer boards at once. The view pans right: the Terminal slides off to the left and a 3D cabin slides in from the right. You are sitting in 3A with the window on your left. Your head turns from the window to the seat ahead as the pan settles, so the pan and the head turn read as one motion.
2. First person, all by hand (the cutscene rule: nothing moves unless a hand moves it):
   - you glance down at the seatback pocket ahead and lean in;
   - your right hand pinches the top of the laminated safety card and draws it up out of the pocket (it slides along the pocket until it is free);
   - you sit back and bring it up in front of you, turning it to face you;
   - your left hand takes the left edge, then your right hand moves its hold to the right edge;
   - your left hand lets go and points.
3. The card is a real airline safety card: "Flight 13 · Safety information". It has five numbered panels (**Passenger, Nurse, Stewardess, Pilot, Bomber**), each with a pictogram and one line. A sixth panel says how the game works.
   - Your left forefinger follows the pointer (or the role buttons along the bottom). The panel it points at is the one described in the caption.
4. Click a panel (or its button). Your hands bring the card up close, you lean in, and your eyes focus in on that panel (the view narrows onto it). The card fills the view, the screen fades, and that lesson's tutorial flight boards.
5. **Back** (or Escape) pans back to the Terminal.

The picker scene uses the Graphics setting (Basic to Ultra) with the same effects chain as the cabin. With Reduce motion on, the pan is a cross-fade.

## The lessons

Each lesson is the same short flight: you plus the five bots Mia, Ravi, Sam, Nora and Leo, 3 nights and 8 rows. Only who plays which role, and where everyone sits, changes. In each lesson you take one role, and the bot who normally plays it becomes a Passenger. The bots follow a script (cues). The coach tells you what to do, and the clocks wait for you.

| Lesson | You | The scenario |
|---|---|---|
| Passenger | Passenger 3B, next to Mia (Bomber, 3C) | Unchanged: your flashlight finds her bomb, you tell the cabin, and the cabin votes her out. |
| Nurse | Nurse 6B; Ravi 5B right in front | Mia's bomb under 3C goes off at the end of night 1, and she slips away to 6F. The coach tips you off, and you treat Ravi. The blast kills Sam, but Ravi lives. By day Leo's cameras and the scorched seat point at Mia. |
| Stewardess | Loyal Stewardess, Aisle 6 | You walk the cart to row 3 and check under the left seats. You find the bomb under 3C, tell the cabin, and the cabin votes Mia out. |
| Pilot | Pilot on the flight deck | You leave the seatbelt sign off, then watch rows 2–4 on the cameras and see Mia bend under her seat. You tell the plane over the PA, Ravi confirms it, and the cabin votes Mia out. |
| Bomber | Bomber 3C | Night 1: plant under your seat (fuse 1). Day 1: Leo's cameras caught Ravi sweeping, so you point at him and the cabin restrains the real Investigator. Night 2: you move to row 6. The blast takes Mia, Sam and Nora (who walked the cart to row 3), which leaves one saboteur against the Pilot. The saboteurs win on numbers. |

If you stray from the script (vote someone else, skip a step), the game carries on. In a phase with no cues, the bots fall back to their ordinary bot brains, so no phase waits forever.

## Code

- `src/tutorial/lessons.ts`: `LessonId`, `LESSONS`, and per lesson:
  - `you`, `cast` (the role and seat for each bot), and a `bomb` planted at boarding (or none);
  - `cues(kind, night)` (null means none: the bot brains play);
  - `coach(game)` for that lesson's phases.
- `script.ts` keeps the shared parts: the bots' names and looks, `tutorialSettings`, `TUTORIAL_WAITS`, and the shared coach steps. `tutorialCoach(game, lesson)` asks the lesson first.
- Host:
  - `HostSnapshot.lesson` and `ClientState.lesson` (a missing lesson means `passenger`, for saved flights);
  - `newHostSnapshot(…, tutorial, lesson)`;
  - `castTutorial` takes the lesson;
  - `runTutorialBots` falls back to `runBots`' brains when the lesson has no cues for the phase.
- `bookTutorial(lesson)`.
- `src/world/post.ts`: the effects chain for a graphics profile, moved out of `Cabin3D.buildPasses`, so the picker shares it.
- `arms.ts`:
  - a `point` pose (forefinger out, the rest curled, thumb tucked) and `INDEX_TIP`;
  - a fix: the left hand's finger order (its forefinger was treated as its little finger).
- `seats.ts`: every seatback gets a lower shell with a literature pocket and a safety card's top edge showing. `hideCard(seat)` hides one card (the picker holds a real one there).
- `src/world/sets/safetyCardArt.ts`: draws the card (front and back) on canvases, plus `SECTIONS`, the rectangle of each panel in card UV.
- `src/world/sets/safetyCard.ts`, the `SafetyCardSet`:
  - the cabin around seat 3A (`buildCabin`, `buildSeats`, windows, day lighting, sunbeams);
  - arms, the card, and the stage machine: pan → look → reach → pull → raise → regrip → choose → zoom;
  - hover by raycast; `onPick`.
- `src/app/TutorialPicker.tsx`: its own renderer plus the effects chain, the set, and the DOM overlay (caption, the five role buttons, Back).
- Home:
  - the Terminal and the picker sit side by side in a track that pans on Tutorial and back;
  - the renderer compiles its shaders before the pan starts.

## Testing

- `lessons.test.ts`: each lesson played through by a scripted student to its ending (Passenger, Nurse, Stewardess and Pilot: passengers win; Bomber: saboteurs win).
- Each lesson also has coach checkpoints, and there is a test that a bot with no cues still acts (the fallback).
- Arms: the pointing pose puts the forefinger tip on the target (unit test through `INDEX_TIP`).
- Browser:
  - contact sheets of the whole sequence at several points;
  - hover pointing at each panel, the zoom, and each lesson booting with the right role;
  - Basic and Ultra.
