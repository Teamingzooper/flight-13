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

## The relay server (recommended)

By default browsers connect to each other directly, which some networks block. The relay server in `server/` (a free
Cloudflare Worker) carries every message instead, so any network works; the host's browser still runs the game. Voice
chat needs direct connections, so it is off while playing through the relay.

1. Make a free Cloudflare account, then in `server/` run `npx wrangler login` and `npx wrangler deploy`.
2. Copy the address it prints (`https://flight13-relay.YOURNAME.workers.dev`) and set it as the repository variable
   `RELAY_URL`, written with `wss://` (Settings → Secrets and variables → Actions → Variables).
3. Re-run the deploy (or push): everyone now connects through the relay.

## Players can't join?

Flight 13 has no game server: the host's browser runs the flight and everyone connects to it directly
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
