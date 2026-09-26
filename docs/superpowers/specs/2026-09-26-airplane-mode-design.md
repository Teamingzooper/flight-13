# M39: The Mastermind's airplane mode

The Mastermind gets a new night action: **take your phone off airplane mode**. Its signal floods the cabin, and the Pilot's cabin cameras show nothing but static that night.

## Rules

- It is **once per flight** (`PlayerState.jamUsed`). Used every night, it would make the Pilot's cameras worthless.
- It **is** the night's action: no planting that night. Its value is cover for the rest of the team (a Bomber planting, a Rogue Stewardess serving).
- It is offered only while a Pilot is on the flight deck (loyal or rogue: the Mastermind can't tell which).
- It is not available from the lavatory or the jump seat, like the other seat-bound actions.

## What people see

| Who | What they see |
|---|---|
| Pilot | At dawn, the camera report says "The cabin cameras over rows X–Y showed nothing but static all night: somebody's phone was off airplane mode." The log entry carries `{ rows, seen: [], jammed: true }`. The console's replay of last night's tape is rolling static with NO SIGNAL. The Pilot learns the cameras were jammed, not who jammed them. |
| Saboteurs | "X took their phone off airplane mode: the cabin cameras show nothing but static tonight." |
| Flight recorder | The end-of-flight black box has the line "Mastermind X jammed the cabin cameras (airplane mode off)." |
| Bots | A bot Pilot says so over the PA (`pa_jammed`). A bot Mastermind jams now and then on a night it does not plant. |

## Code

- `NightAction { kind: 'jam' }`, log tag `jam`, `jamUsed` (migrated with `??= false`). The rules are in `checkAction` and `possibleActions`.
- `resolveNight` handles it at step 1d (jam), then 5c: while jammed, the cameras report static.
- `Tape.jammed`, and `Cabin3D.staticFeed` for the console.
- The Mastermind's action tab gets a `JamCard`.

Tests: the engine (static report, the saboteurs are told, once per flight, the Mastermind only, a Pilot needed) and the tape (a jammed night makes a static tape).
