# Endings pass, voice overhaul, graphics tiers, model check

Four requests from 2026-09-25, built in this order.

## M34: Endings, smooth and natural (the cutscene rule)

Rule: nothing moves unless a person moves it. Motion eases in, overshoots slightly and settles, like RE7 and Call of Duty.

- **Bodies (people.ts).**
  - Critically damped springs replace the exponential approaches for standing, head turns, hands up, bracing and aiming. Head turns may overshoot a little.
  - Gait advances with distance walked, so feet don't slide. Hips sway, the body leans into speed and acceleration, arms counter-swing, and running bends the arms.
  - Getting up: the body leans forward, hands press down, and only then steps off. Sitting down reverses this.
- **Hands (two-bone IK).**
  - A hand can reach a point: a door handle, or a prisoner's shoulder.
  - Pistols are drawn from the waistband. The hand goes to the hip, the gun appears in it there, then the arm comes up to aim. No more guns popping into the air.
  - Blows: a fist pound (wind up, hit, recoil) and a shoulder charge. Each is timed so the impact lands on the thud's sound.
- **Doors and cloth.**
  - The flight deck door is a sprung hinge. A shove bursts it open, it bangs against its stop and settles. A pilot opening it pulls it by the handle.
  - The galley curtain parts around anyone walking through it, then swings back and settles.
- **Endings.**
  - Police come in through the curtain. The lead officer walks each prisoner off with a hand on their shoulder. Anyone who leaves through the curtain is gone from view.
  - The hijacker pounds on the door (the fist moves with each thud), then charges it with his shoulder. A rogue Pilot opens it with his hand on the handle.
  - Gunmen stand up, draw, and then step into the aisle.
- **Camera.** The first-person camera is on springs:
  - riding a body adds its footfall bob and roll;
  - watching adds breathing;
  - looks glance ahead with the eyes and the head follows.

## M35: Voice overhaul

- **Distance.** Voices fall off like real speech: inverse distance from 1 m, and silent at the flight's voice radius.
  - The farther the speaker, the duller the voice (air, and seats in between) and the more room sound, relative to the direct voice.
- **Rooms.** Each place has its own reverb, from procedural impulse responses: the cabin (soft and damped), the galley (hard and bright), the lavatory (tiny, tiled), the flight deck (small), and the jumbo's upper deck.
  - A voice gets the reverb of the room it is spoken in.
  - A wall or door in between muffles it: the lavatory door, the flight deck door, and more gently the galley curtain.
- **Night whispers.** The living may talk at night, but only within the night radius. By default this is one seat all round.
  - The captain sets it: `nightVoiceRange` from 0 (silent nights) to 4 rows, next to the day `voiceRange`.
- **PA.** The Pilot's PA sounds like a real intercom:
  - band-limited and driven into saturation;
  - a squelch click on the key and on release, and crackle while he talks;
  - played from the cabin speakers with the cabin's reverb.
- **Lobby.** There is voice chat while boarding: everyone hears everyone.
- **Channel voice.** With the seatback chat open on a channel you may write in, your voice goes to that channel instead of the cabin. Everyone else on the same channel screen hears it at full volume, like a headset:
  - the cabin channel by day;
  - the saboteur channel at night.

  Ghosts already talk only among themselves.
  - The client tells the host its channel (`{t:'tune'}`), and the host checks it may use it. The host only tells people who can read a channel who is on it, so the saboteur channel stays secret.

## M36: Graphics tiers

The tiers are **Basic, Low, Medium, High and Ultra**.

| Tier | Resolution | Post effects | Shadows and lighting |
| --- | --- | --- | --- |
| Basic | 0.75× pixels | none (tone mapping in the renderer) | no shadows, no environment reflections |
| Low | 1× | tone mapping and vignette | no shadows |
| Medium | 1.25× | bloom and film grain | shadows |
| High | 1.75× | High's effects plus SMAA | High's shadows |
| Ultra | native (up to 2.5×) | ambient occlusion, stronger bloom | bigger soft shadow maps, richer environment lighting, sharper textures |

The materials get better on every tier: fabric and carpet normal maps, and lit windows.

## M37: Model check and polish

- **Models.** Look at every model and fix gaps, intersections, flicker and odd scales:
  - passengers with every hair, hat, eyewear and neckwear;
  - seats, the cart, galley, flight deck, lavatory and trays;
  - the hotel items, the gate and the tarmac.
- **Polish.** A final pass on anything rough found along the way.
