# Custom roles (M27)

2026-09-25. The user picked "Custom roles" from the ideas list: build a role from ability pieces (what it does, how often, for which team) and add it to a flight. The details below are my calls.

## What the host builds

In the flight settings, with **Choose roles** on, the card list gains a **Custom roles** section. There can be up to three custom roles. Each has:

- **Name:** 1 to 16 characters. It must be unique, and can't be a built-in role's name ("Nurse", "Bomber" and so on).
- **Team:** Passengers or Saboteurs.
- **Ability:** one piece, built on a mechanic the game already has:
  - **No ability.** A plain role with a title: a "Tourist", or on the saboteurs' side an accomplice who knows the team and votes with it.
  - **Treat.** Like the Nurse: someone within 1 seat can't die tonight, and poison is cured. Yourself once.
  - **Investigate.** Like the Investigator: sweep the seats within 1 for bombs, or inspect the cart or lavatory beside you.
  - **Handcuffs.** Like the Air Marshal: cuff someone within 2 seats, and they're walked to the rear galley at dawn.
  - **Poison.** Slip poison to someone within 1 seat. They fall sick at dawn and die the next dawn unless treated, washed out in the lavatory, or saved by an antidote. On the cabin cameras it looks like leaning over, the same as a Nurse's treatment.
  - **Plant bombs.** Like the Bomber: under your seat, on the cart or in the lavatory, with a 1- or 2-night fuse. Saboteurs only.
- **Uses:** every night, twice per flight, or once per flight.
  - Handcuffs are once or twice per flight.
  - For bombs, "every night" means the Bomber's allowance (one bomb for every three nights); twice or once means that many bombs.
- **Cards:** 0 to 2 dealt this flight.

## Rules

- **The deck:** custom cards are dealt with the other cards, in place of Passengers.
  - The card checks count them: the saboteurs must start as a minority, and the specials must fit the passengers aboard.
  - There must be at least one saboteur card: a Bomber, a Mastermind, or a custom saboteur role.
  - With **Roles: automatic**, custom roles aren't dealt. The form says so.
- **Your role:**
  - The role card, Action tab and boarding pass show the custom name and a how-to line written from its pieces.
  - Reveals, the vote screen, the end screen, the postcard and the black box use the custom name.
- **Other rules still apply:** the saboteur channel, knocking out the Pilot from the jump seat, the washroom, lunch drugging (their own row) and so on work by team, as for any role.
- **The host's role pick** lists the custom roles in this flight's deck (with at least one card).
  - A custom role in the deck is always dealt, so the host simply swaps into one.
  - If the host picked one that has since been taken out of the deck, their role is dealt at random.
- **Bots** play custom roles like the matching built-in role: treat like a Nurse, investigate like an Investigator, cuff like a Marshal, bomb like a Bomber. A poisoner moves next to its target and poisons them. Saboteur bots target threats; passenger bots target their top suspect.

## How it's built

- **Role ids:** `custom_p1`–`custom_p3` (Passengers) and `custom_s1`–`custom_s3` (Saboteurs).
  - The number points into `settings.customRoles`, and the letter is the team. So `teamOf`/`isSaboteur` keep working from the id alone.
  - `roleInfo(role, settings)` gives the name, team, blurb and how-to for any role.
- **Engine:**
  - New file `engine/custom.ts`: definitions, validation, ids, `customAbility`, `usesLeft`, how-to text.
  - `Settings.customRoles`, and `PlayerState.abilityUses` (counted when the ability actually happens).
  - A new night action `poison {target}`.
  - `validateCards` takes the custom roles, and so does `dealRoles`.
  - Ability checks in `rules.ts` and `night.ts` ask "has this ability" rather than "is this role".
- **Network:** `cleanSettings` rebuilds `customRoles` from untrusted input.
- **UI:**
  - The builder in `SettingsForm`, plus the custom roles in the rules list.
  - Role names everywhere go through `roleName(role, settings)`.
  - The Action tab picks the ability panel from the custom ability.

## Tests

- **Engine:** validation, dealing, each ability (legal moves, resolution and uses running out), poison and treatment, bombs from a custom role, and names in logs and views.
- **Network:** settings cleaning.
- **Bots:** a bot flight with custom roles plays legal moves to the end.
- **Browser:** checked in 2D and 3D:
  - building a saboteur "Chef" (poison, once);
  - the card check asking for more passengers;
  - the rules line and picking Chef as the host;
  - the boarding pass and the night panel (the only neighbour in reach, "your last use");
  - the poison landing, "used up" the next night, and "Chef" in the end-screen reveal.
