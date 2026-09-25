# Flight 13

A social-deduction game at 35,000 feet: saboteurs, passengers and a bomb or two, played peer to peer in
the browser. Live at https://teamingzooper.github.io/flight-13/.

## Voice chat

Press **Voice** in the cabin (top right) to talk out loud. Voices go straight between browsers, never
through a server, and play from where each person sits: you hear your neighbours clearly and the back
of the plane faintly. Voice follows the chat rules:
- The living are silent at night.
- Ghosts only hear each other.
- After landing, everyone hears everyone.

The Pilot can also talk to the whole plane over the PA by day: hold **P** (or the **Hold for PA** button).
Everyone hears him at the same volume through the cabin speakers, after a ding.

**M** mutes you. Use headphones so others don't hear themselves echo. Voice uses the same connections
as the game, so a network that needs a TURN relay (below) needs it for voice too.

## The game server (recommended)

By default browsers connect to each other directly, which some networks block, and the host's browser runs the game. The
server in `server/` (a free Cloudflare Worker) does both jobs instead, so any network works.

- **It runs every flight booked through it.** Each flight is a room (a Durable Object) that runs the same host code as the
  browser (`src/net/host.ts`), so a flight carries on whoever leaves.
- **The captain.** The captain is whoever holds the booking browser's token. If they stay away for a minute, the
  passenger aboard longest takes over.
- **Empty flights.** A flight with nobody aboard pauses until someone comes back, and is forgotten after three hours.
- **Voice** goes through it too. Each browser encodes its microphone as Opus (WebCodecs) and the server passes the
  packets on (silence is not sent), so browsers without WebCodecs audio get no voice button.
- **The tutorial** still runs in your own browser.

It is deployed at `wss://flight13-relay.flight-13-relay.workers.dev` (the repo's `RELAY_URL` variable). To deploy your own:

1. Make a free Cloudflare account, then in `server/` run `npx wrangler login` and `npx wrangler deploy`.
2. Copy the address it prints (`https://flight13-relay.YOURNAME.workers.dev`) and set it as the repository variable
   `RELAY_URL`, written with `wss://` (Settings → Secrets and variables → Actions → Variables).
3. Re-run the deploy (or push): flights are now booked on and run by the server.

For development, run `npm run dev` in `server/` too, and point the game at it in the browser console:
`localStorage.setItem('flight13.relay', 'http://127.0.0.1:8787')` (`'off'` for direct connections).

## Accounts

With the game server, players can sign in (**Sign in to keep your progress** on the home page, or `#/account`).
Your account keeps your passenger, your Duty Free bag and your player token (so your seats follow you to any device you
sign in on). Flights the server runs add each player's result to their win rate by role.

- **Email and password** work out of the box. Passwords are stored as PBKDF2 hashes, and emails only as SHA-256 hashes.
  There is no email service, so forgotten passwords cannot be reset.
- **Steam** works out of the box (OpenID). Optionally, `npx wrangler secret put STEAM_API_KEY` shows people's Steam
  names instead of "Steam".
- **Google, Discord and Epic Games** appear once you register an app with each and give the server its credentials.
  Run these in `server/`; each asks for the value, so it never lands in your shell history.

  | Provider | Register an app at | Redirect URL to register |
  | --- | --- | --- |
  | Google | Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application) | `https://flight13-relay.flight-13-relay.workers.dev/auth/google/callback` |
  | Discord | discord.com/developers/applications → OAuth2 | `https://flight13-relay.flight-13-relay.workers.dev/auth/discord/callback` |
  | Epic Games | dev.epicgames.com/portal → Epic Account Services → your application (Basic Profile permission) | `https://flight13-relay.flight-13-relay.workers.dev/auth/epic/callback` |

  ```
  npx wrangler secret put GOOGLE_CLIENT_ID
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  ```

  Likewise `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `EPIC_CLIENT_ID` and `EPIC_CLIENT_SECRET`. Each takes effect as
  soon as it is set.
- Sign-ins only return to the origins in `ALLOWED_ORIGINS` (`server/wrangler.jsonc`).

## Players can't join?

Without the game server (above), the host's browser runs the flight and everyone connects to it directly
(WebRTC). Most home networks allow that, but some networks (many university, office and mobile
networks, VPNs) use a strict NAT that blocks direct connections. The game checks this for you: the gate
and the "Looking for FT-…" screen say whether your network allows direct connections.

When it doesn't, a TURN relay server carries the game for those players (the data stays end-to-end
encrypted; the relay only forwards it). To switch one on:

1. Create a free TURN account, for example at [Metered](https://www.metered.ca/stun-turn) (free monthly
   quota) or [ExpressTURN](https://www.expressturn.com/), and create a username and password (static
   credentials) there.
2. Add them to this repository (Settings → Secrets and variables → Actions):
   - variable `TURN_URLS`: the relay URLs, comma separated, e.g.
     `turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp`
   - secret `TURN_USERNAME` and secret `TURN_CREDENTIAL`
3. Re-run the "Deploy to GitHub Pages" workflow. The relay is only used when a direct connection fails.

The credentials end up in the page's JavaScript (every player needs them), so use a TURN account made for
this game.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

For a local relay, put `VITE_TURN_URLS`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` in `.env.local`.
