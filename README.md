# Flight 13

A social-deduction game at 35,000 feet: saboteurs, passengers and a bomb or two, played peer to peer in
the browser. Live at https://teamingzooper.github.io/flight-13/.

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
