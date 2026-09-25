# The tutorial flight (M22)

2026-09-25. The user picked "Tutorial flight" from the ideas list ("a first flight where scripted bots walk you through moving, searching, items and voting"). They then said "DO ALL" and "keep going", so the details below are my calls.

## The flight

The home page has a Tutorial flight button. New players (no flights yet) see "New here? Take the tutorial flight". It books a local flight called Flight School (code FLY, 3 nights) with you and five scripted bots:

| Bot | Role | Seat |
| --- | --- | --- |
| Mia | Bomber | 3C |
| Ravi | Investigator | 5E |
| Sam | Nurse | 2A |
| Nora | Stewardess (loyal) | Aisle 6 |
| Leo | Pilot | Flight deck |

You are a Passenger in 3B, next to Mia. She boarded with a bomb already under her seat, set for the end of night 2, and it counts as her one bomb. If you have no flashlight, the button puts one in your bag.

## The script

1. **Lobby:** the coach welcomes you, and you take off.
2. **Packing:** you pack the Pocket flashlight. The bots pack nothing.
3. **Boarding and takeoff:** your secret role.
4. **Night 1, seats change:** you stay put. Ravi moves to 4C and Nora walks the cart to row 1.
5. **Night 1, in the dark:** your flashlight on 3C finds the bomb. Mia bends down to check on it, Ravi sweeps and finds it too, and Leo watches rows 2–4.
6. **Day 1:**
   - Ravi reports the bomb under 3C, Leo's PA says his cameras saw Mia bend down, Mia denies it, and Sam says she never left 3C.
   - You tell the cabin, then everyone is ready.
7. **The vote:** four bots vote Mia and she votes Ravi. The passengers win whatever you vote.
8. **End:** "You graduated!", pointing you at the flight recorder.

## How it runs

- **Host:** `HostSnapshot.tutorial` does four things.
  - The cast boards with the snapshot.
  - At takeoff, roles, seats and Mia's bomb are set.
  - Each phase that waits for you gets 30 minutes on the clock, so the early end (everyone done) moves it on.
  - The bots play their cues (`tutorial/script.ts`) instead of their brains.
- **Clients:** `ClientState.tutorial` shows the coach card, in the lobby, over the 3D view, on the seatback screen and on the end screen. It also hides the countdown while the tutorial waits for you.
- `tutorialCoach(view)` picks what to say from the phase and what you have done: packed, moved, used the flashlight, spoken, got ready, voted.

## Tests

- A tutorial run over the in-memory network: the cast and seats, the clock waiting on you, the flashlight finding the bomb, the bots' lines, the vote, the passengers' win, and each coach step along the way.
