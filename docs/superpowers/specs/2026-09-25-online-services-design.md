# Online services: server flights, departures board, rejoin links, accounts, settings, proximity chat

Six requests from 2026-09-25, built in this order, each merged and deployed on its own.

## M28: Flights that survive the host leaving

The game's brain moves from the host's tab into the flight's room on the Cloudflare server (the `Room` Durable Object).

- **Booking.** When the build has a relay, `bookFlight` POSTs `/flights` with `{settings, controlTower, token}`. The Worker checks the settings (`cleanSettings`, `validateSettings`) and picks a flight code. The room stores a fresh `HostSnapshot` and answers `{code}`; if the code is taken, the Worker tries another.
- **Running.** The room runs the same `HostSession` as the browser, bundled into the Worker from `src/net/host.ts`. It is peer `server` on the relay: clients find it the way they find a browser host (its `hello`), so `ClientSession` is unchanged.
- **The captain.** The captain is whoever joins with the booking token (`serverHosted` mode), instead of the tab that runs the game.
  - In a control-tower flight, the captain joins as the tower automatically, from any device.
  - If the captain has been gone for 60 s and another human is aboard, the longest-aboard human becomes captain. This does not apply to tower flights.
- **Ending.** A new `end` command lets the captain end the flight for everyone. The room refuses everyone and deletes its storage.
- **Saving and restarts.**
  - The snapshot is saved to room storage at most every 5 s while it changes, and again when the room empties.
  - After a restart (eviction, deploy), the room reloads it and greets every connected socket again, so every client re-joins with its token.
- **Clock.**
  - A 250 ms interval ticks the game while anyone is connected. An alarm every 30 s keeps the room awake, since timers alone do not.
  - When the last person leaves, the flight pauses itself (`idlePaused`) and resumes when someone returns, so a flight nobody watches does not run to the end.
  - A room empty for 3 hours deletes itself.
- **Browser hosting stays** for the tutorial, and for builds with no relay (Trystero).
- **UI.**
  - The "End flight" buttons follow `state.isHost`.
  - The leave dialog tells a server flight's captain that the flight carries on without them.

## M29: Departures board

- **Listing a flight.** A new flight setting, `listed` (default on), shows it on a public board. Only flights still boarding are listed.
- **The board.** A `Board` Durable Object keeps `code → {city, destination code, plane, captain name, aboard, max, updatedAt}`.
  - Rooms report on lobby changes (throttled to 1 per 5 s) and every 60 s while boarding.
  - Rooms remove their entry on takeoff or end.
  - Entries not refreshed within 3 minutes drop off.
- **Home page.** It polls `GET /board` every 15 s and shows "London · 3/10 boarding" rows that open the flight.

## M30: Switch devices mid-flight

- **Getting a link.** The seatback TV and the boarding page offer "Move to another device". The client asks the host for a transfer ticket (`ticket` command), which is random, lasts 10 minutes and is tied to your seat. The page shows the link and a QR code.
- **Using it.** Opening `#/f/CODE?move=TICKET` joins with that ticket. The host then:
  - moves the seat to the new device's token (and the captaincy, if the seat has it);
  - refuses the old device ("You moved to another device").
- **Browser-hosted flights.** The host's own seat cannot move, because the tab is the game.

## M31: Accounts, profiles and stats

- **Storage.** An `Accounts` Durable Object (SQLite) holds:
  - users (profile JSON, player token);
  - logins (provider + subject);
  - sessions (hashed bearer tokens);
  - pending OAuth states and one-time tickets;
  - per-role stats.
- **Email and password.**
  - Passwords are hashed with PBKDF2-SHA256 (100k iterations, random salt), inside the Durable Object (whose 30 s CPU limit allows it).
  - Emails are stored only as a SHA-256 hash, since without an email service they are never needed in plain text.
  - There is no reset or verification until an email provider is set up.
- **Google, Discord and Epic Games.**
  - These use the standard OAuth code flow through `GET /auth/:provider/start` and `/callback`.
  - They are enabled only when `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET` are set as Worker secrets. The owner sets these with `wrangler secret put`.
- **Steam.** It uses OpenID 2.0 and needs no keys.
- **Returning to the game.** The callback redirects to the game with a one-time ticket in the hash (`#/account?ticket=…`). The client exchanges the ticket for a bearer session kept in localStorage. Return URLs must match `ALLOWED_ORIGINS`.
- **Following you across devices.**
  - The account keeps your profile and your player token.
  - Signing in on a new device adopts both, so your seats follow you.
  - Profile edits sync up, throttled.
- **Stats.** At the end of a server flight (not the tutorial), the room sends `[{token, role, won}]` to the accounts store. It records games and wins per role for every token that belongs to an account. Custom roles count under their team. The account page shows win rate by role.

## M32: Settings screen

One `SettingsPanel`, reached from a gear on the home page (`#/settings`) and a Settings tab on the seatback TV. Settings are stored in localStorage (`flight13.settings`) and applied live.

- **Voice:**
  - voice chat on/off;
  - microphone choice;
  - output volume;
  - push-to-talk key or open mic;
  - per-person mute and volume, for everyone aboard.
- **Graphics:**
  - quality (low/medium/high: pixel ratio, shadows, post effects);
  - field of view;
  - 2D/3D default.
- **Accessibility:**
  - text size;
  - reduce motion (no camera shake or bob, shorter cutscenes);
  - high contrast;
  - fewer flashes.

## M33: Proximity chat for the captain

- **New settings.** `voice: {mode: 'proximity' | 'cabin' | 'off', range}` joins the flight settings. The range is in rows, 1–10, and applies to proximity mode only.
- **Where they show.** They appear in the booking form and the lobby's settings.
- **How they apply.** The voice rules use them: cabin mode is everyone at full volume and off is no voice. Night rules and the PA still apply.
