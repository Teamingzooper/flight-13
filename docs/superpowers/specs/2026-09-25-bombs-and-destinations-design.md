# More bombs on longer flights, and custom destinations (M17)

2026-09-25. The user picked "one bomb per 3 nights" and asked for host-made destinations ("name, abbreviation, night count, effects, etc."), then said "DO ALL", so the details below are my calls.

## Bombs

- Each Bomber and the Mastermind get `bombsFor(nights) = min(4, ceil(nights / 3))` bombs: 3 nights give 1, 4–6 give 2, 7–9 give 3, and 10 give 4. `nights` is the destination's scheduled count; a course change doesn't add a bomb.
- There's still one action a night, so at most one plant a night.
- The engine counts `PlayerState.bombsPlanted`, replacing `bombUsed`. A game saved with `bombUsed: true` counts as one bomb planted.
- A seat, the cart or the lavatory holds one live bomb at a time: "There is already a bomb there."
- Your screen says how many bombs you have left, and the role texts say "one bomb for every three nights of the flight".
- Bots read `bombsLeft` from their view.

## Custom destinations

- `Settings.destination` is one of the five destinations or `'custom'`. `Settings.customDestination` holds:
  - `city`: 1–24 characters;
  - `code`: three letters, stored upper-case;
  - `nights`: 2–10;
  - `twists`: any mix of `turbulence`, `redeye` and `triangle`.
- A destination now has a `code` and a list of twists, not one twist. `destinationOf(settings)` returns the chosen one; custom ones get a generated blurb. Every `DESTINATIONS[settings.destination]` lookup goes through it: the game's nights, the red-eye pace, the nightly twists, the Triangle's aurora skies, and the city and code on the header, boarding pass, departure board, captions, landing, endings, TV screen and lobby.
- The lobby picker gets a sixth card, Custom, with fields:
  - city and code (typed upper-case);
  - a nights slider;
  - three effect checkboxes: Turbulence, Red-eye and the Bermuda Triangle.
- The rules summary also says how many bombs each Bomber gets.
- `validateSettings` checks the custom fields, and `cleanSettings` rebuilds them from untrusted input.
- Landing at a custom destination doesn't count toward the "every destination" collection in the bag.

## Tests

- `bombsFor` at each boundary.
- A Bomber on a five-night flight plants twice and is refused a third time, and can't plant on a seat that already has a live bomb.
- An old save with `bombUsed: true` has no bombs left on a one-bomb flight.
- A custom destination sets the nights and twists. Bad codes, nights and cities are refused, and `cleanSettings` round-trips a custom destination.
- The engine simulation also flies a custom destination with every twist.
