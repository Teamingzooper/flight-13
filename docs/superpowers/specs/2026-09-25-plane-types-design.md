# Plane types (M21)

2026-09-25. The user picked "Plane types" from the ideas list, pitched as "a private jet for 4–6 players (tiny cabin), a red-eye (3 nights, quick timers), a jumbo for 16+ with an upper deck". They then said "DO ALL" and "keep going", so the details below are my calls. The red-eye already exists as a destination effect (Tokyo, and any custom destination), so this milestone is about the planes themselves.

## The planes

| Plane | Passengers | Cabin |
| --- | --- | --- |
| Airliner (default) | 4–16 | As now: three seats either side of the aisle (A B C \| D E F), 8–12 rows. |
| Private jet | 4–6 | Five rows of cream leather seats, two by two with a wide aisle (A B \| E F). |
| Jumbo | 10–24 | 14 rows for up to 16 passengers, 16 rows beyond that. A spiral staircase in the galley goes up to the upper deck. |

- **The private jet:** because of the wide aisle, a blast, a whisper or a pair of handcuffs never reaches across it. The drink cart still runs down the middle, and the aisle seats (B and E) count as next to it.
- **The jumbo:** 24 passengers bring new role presets for 17–20 and 21–24 players, with more Bombers, Nurses, Investigators and Air Marshals.

## Engine

- `Settings.plane: PlaneId` defaults to airliner, and older settings are filled in. Validation checks that the passenger count fits the plane. `MAX_PLAYERS` becomes 24; each plane has its own range.
- `Cabin.cols` holds the seat columns, set at takeoff (older saves get the airliner's).
- The grid's seat functions take the columns:
  - `allSeats`, `isSeatInCabin`, `seatsWithin`, `placesWithin` and `rowSeats` default to the airliner's six columns;
  - every engine and UI caller passes `cabin.cols`.
- `rowsFor(maxPassengers, plane)`.
- Next to the cart means an aisle seat (the column nearest the aisle on each side) within a row of the cart, or one step from it. On the airliner that is the same as before.

## 3D and screens

- `seats.ts` and `effects.ts` build seats and masks only in the plane's columns, and the jet's seats are cream leather.
- The jumbo gets a spiral staircase in the front galley.
- `People` can hold 24 passengers plus 24 recorder stand-ins and the police. Instanced draws only cover the slots in use.
- The seat map draws only the plane's seats.
- The lobby gets a plane picker above the destinations. The passenger slider follows the plane's range, and the rules summary names the plane.

## Tests

- **Grid:** seats, rows and blasts on the jet. The jet's aisle seats are next to the cart.
- **Settings:** each plane's range, and cleaning plane settings.
- **Presets:** 17–24 passengers keep the saboteurs a minority.
- **Simulation:** whole flights on the jet with 4–6 players and on the jumbo with 10–24.
