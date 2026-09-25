# Meal service (M26)

2026-09-25. The user picked "Meal service" from the ideas list: a daytime meal round once per flight, where the Stewardess serves and a saboteur can tamper with one tray. The details below are my calls.

## The rules

- **When:** lunch is served once per flight, halfway through: on day `max(1, floor(nights / 2))` (day 2 for London's 5 nights).
  - It happens during that day's discussion.
  - The host can turn it off with the **Meal service** rule. It's on by default and off in the tutorial.
- **Ordering:** everyone in play orders **chicken or pasta**, and can change their mind until the discussion ends.
  - Orders are said out loud, so everyone sees them.
  - Anyone who hasn't ordered when the discussion ends is handed a random dish.
- **Drugging:** the saboteur team gets **one** go at the food. A saboteur drugs one dish around a row:
  - **Bomber and Mastermind:** their own row.
  - **Rogue Stewardess:** any row she picks, since she serves them all.
  - **Rogue Pilot:** can't; he's shut away on the flight deck.
  - Only the saboteur who drugged the food can call it off, and once they do, a teammate can take the go.
- **The effect:** everyone who ordered the drugged dish in that row or the rows either side **sleeps through the next night**. They can't change seats, use an ability, use items or be called up to the jump seat.
  - The drugger eats their own tray too: if they ordered the drugged dish, they sleep as well. That can be good cover.
  - **Crew:** the crew eat in the galley, so the Stewardess is never drugged. The Pilot is only drugged by a rogue Stewardess drugging row 1, because the flight deck's tray goes up through her.
  - **A drugged Pilot** makes no calls that night: the autopilot has the plane.
- **Clues:**
  - The loyal Stewardess, clearing the trays, privately learns which dish was touched and the row it was done around. That's the drugger's own row, unless a rogue Stewardess did it.
  - Sleepers learn at nightfall that their lunch did it.
  - The orders are public, so the drugger probably ordered the other dish.

## Where it shows

- **2D and the seatback screen:**
  - A lunch bar at the top of Chat for one-tap orders.
  - A Lunch card on the Action tab. It shows your order, both order lists with seats, and for saboteurs the "Drug the food" box: rows in reach, both dishes, a row picker for a rogue Stewardess, and "leave the food alone".
  - At night, sleepers get a "Zzz" card instead of the move and ability panels.
- **3D:**
  - During lunch, a fold-down tray table appears in front of everyone who ordered: a tray, a white plate with drumsticks or pasta with sauce, and a cup.
  - An order shows as a 🍗 or 🍝 bubble over the head.
  - The crew announce lunch over the PA.
  - The HUD nudges you to order.
  - Sleepers get the dark "asleep" vignette and "Something in your lunch…".
- **Rules and records:**
  - The lobby rules list says when lunch is.
  - The black box and the flight recorder show who drugged what, around which row (a day caption over that row), and who slept.
- **Bots:**
  - Bots order at random.
  - Saboteur bots drug the dish they didn't order about half the time, around the row that puts the most non-teammates to sleep and the fewest teammates.
  - A drugged bot says so the next morning ("My pasta was drugged… who was near 4D at lunch?").
  - A loyal Stewardess bot reports the trays.
  - Bots weigh both as evidence: people who sat in the drugged row, and to a lesser degree the drugged bot's neighbours.

## Code

- **Engine:**
  - New file `engine/meal.ts`: `mealDay`, `lunchOpen`, `inReach`, `tamperReach`, `checkOrder`/`checkTamper`, `serveLunch` (the day starts), `closeLunch` (the discussion ends), `lunchDrowsiness` (night starts).
  - Types: `GameState.meal`, `NightChoices.drowsy`, intents `order` and `tamper`, `Settings.mealService`, log tag `meal`.
  - Views: `PlayerView.meal` (orders public, the tamper for saboteurs only) and `YouView.drowsy`.
- **Wiring:**
  - Drowsy players count as done in early ends. They're refused moves, acts, items and flight deck calls.
  - `normalizeGame`/`normalizeSettings` fill in the new fields for saved games.
- **UI:** `tv/Lunch.tsx`, `world/scene/trays.ts`, the lunch bubble and HUD hint in `Cabin3D`/`World`, the director's PA cue, and a day caption in the recorder.
- **Fix found along the way:** the phrasebook's "capitalise after a full stop" step had been commented out by accident in M16. It works again.

## Tests

- `engine/meal.test.ts`:
  - timing, public orders and the one-tamper limit;
  - reach (rows ±1; the Pilot only through a rogue Stewardess at row 1; never the rogue Pilot);
  - closing orders, the Stewardess's note and the sleepers' night;
  - early ends, the drugger eating their own dish, no meal service, and legal bot orders.
- `bots/lunch.test.ts`: knowledge, the lines, and the Stewardess's suspicion.
- A director cue, a recorder caption, and the cockpit refusing a drugged Pilot.
- Browser-checked in 3D (trays from the seat, bubbles, night vignette and hint) and 2D (the lunch bar, the Lunch card with the drug box, the "Zzz" card).

## Refined (later the same day)

The user asked to remove meals or refine them. Picking chicken or pasta was busywork: passengers can't know which dish will be drugged, so the choice was a coin flip. So now:

- **Dishes are handed out.** When lunch opens, the cart hands everyone chicken or pasta at random, and everyone can see who got what. Nobody has to do anything; the `order` intent is gone.
- **The saboteurs' decision stays, and gets sharper.** They choose which dish to drug knowing everyone's tray, including their own. Drugging your own dish puts you to sleep too, which costs you a night but makes good cover.
- **Less on screen.**
  - The Chat tab's lunch line says what you got.
  - The Action card lists who got what, plus the drug box for saboteurs.
  - The 3D order bubbles and the "order now" HUD hint are gone. Every tray appears at once.
