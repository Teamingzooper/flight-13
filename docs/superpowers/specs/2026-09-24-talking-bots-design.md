# Talking bots (M15–M16)

Approved 2026-09-24. Bots stop being silent random movers: they read the chat, reason about what they have seen, talk, and vote with reasons. By default they are honest passengers and lying saboteurs. In 3D, chat lines appear as speech bubbles, and bots babble out loud.

## Decisions

| Question | Answer |
| --- | --- |
| How talk comes across | Chat, plus speech bubbles over heads in 3D (for everyone's cabin lines), plus gibberish babble from bots |
| Reacting to humans | Fully: answer when named, join accusations between others, count chat in votes |
| Night talk | Both ways: saboteur bots share plans and follow a human teammate's orders |
| Host settings | Bot chatter (Quiet / Normal / Lively) and bot skill (Easy / Normal / Hard) |
| Approach | A brain that only sees its own seat's view (`viewFor`), in a new pure `src/bots/` folder |

Not a language model: there is no server to call one from, a key would sit in every browser, and every line would cost money and time.

## How a bot thinks

### Data flow

The host already runs bots from `HostSession.tickNow()`. From M15, each bot gets a `BotBrain` (one per bot, created lazily and dropped when the game ends). Every tick:

1. `view = viewFor(game, botId, now)`: exactly what a human in that seat would see.
2. `brain.think(view, now)` returns what the bot wants to do now:
   - chat intents;
   - a vote;
   - night intents: moves, calls or an action.
3. The host applies them with `applyIntent` as the bot. Anything the engine rejects is dropped. The bot never learns the rules any other way.

`think` is deterministic for a given view, time and seed. It keeps only caches (parsed chat lines by message id) and a small talk memory (what it has said and when), so a host reload costs nothing but some repeated small talk.

### Modules (`src/bots/`)

- `hear.ts`: turns one chat message into facts: who is named (full name, first name, or the name without " (bot)"; seats like `4C`; "you" when replying to the last speaker), and what kind of line it is:
  - an accusation ("Jo is the bomber", "sus", "vote Jo", "liar");
  - a defense ("Cal is clear", "trust Eli");
  - a role claim ("I'm the Nurse");
  - a result claim ("searched 4C, clean"; "found a bomb at 5C"; "treated Gus");
  - a question to someone ("Jo, what did you find?");
  - a vote announcement;
  - in the saboteur channel, an order ("Cal, plant 5C", "everyone lay low", "poison 3A", "stay").

  Keyword and regex based, English only, and pure, so each message is parsed once and cached.
- `knowledge.ts`: what the bot knows for sure, read from its own view:
  - its role, seat, items and poisoning;
  - private results in its log: sweep, inspect, check and search findings (bomb ids plus the bomb locations in `view.bombs`), treatments, cuffs, camera sightings (see the engine additions);
  - public events: deaths and causes, blasts and where, verdicts (and past votes, when votes are not anonymous), washroom and jump seat use, and revealed roles;
  - for saboteurs, teammates and the plans in the saboteur channel.
- `mind.ts`: beliefs:
  - a claims table: who claims which role and which results, from `hear`;
  - a suspicion score in [0, 1] for every other active player.

  Evidence that raises suspicion:
  - a bomb found at or next to their seat;
  - a unique role claimed by two players (one of them is lying);
  - a claimed result that contradicts the bot's own findings;
  - having defended someone later revealed as a saboteur;
  - having voted out a passenger;
  - being accused by players the bot trusts.

  Evidence that lowers it: results that check out, being cleared by a trusted result, being treated by a confirmed Nurse. Quiet players drift slightly up.
- `decide.ts`:
  - the vote: the top suspect if the bot is confident enough (the threshold depends on skill), otherwise skip;
  - night choices, always picked from `view.options` (legal by construction), aimed by skill (below).
- `talk.ts`: what the bot wants to say now, as a list of talk intents with priorities: react, claim, share result, accuse, defend, answer, agree, disagree, announce vote, react to verdict, night plan, confirm order, refuse order, PA report.
- `phrasebook.ts`: 3–6 wordings per talk intent, in four tones (blunt, nervous, chatty, formal), filled in with names, seats and roles. Lines stay under about 120 characters.
- `personality.ts`: a tone, a typing speed and a babble voice, seeded from the bot's id.

### Saboteur bots

They know their team (their view shows it). By default they:
- fake a passenger claim: a plain Passenger, or an ability role nobody has claimed yet;
- invent believable results: "searched my seat, clean"; on Normal and Hard, framing someone the cabin already suspects ("found wires under 5C");
- never accuse a teammate. On Hard, a teammate who is certainly going to be voted out may be abandoned to earn trust;
- vote with the crowd against passengers;
- at night, post their plan in the saboteur channel and follow a human teammate's orders (below).

### Difficulty (host setting)

| | Easy | Normal | Hard |
| --- | --- | --- | --- |
| Suspicion | Mostly noise; believes what it is told | Weighs evidence; doubts clashing claims | Checks every claim against its own findings and the vote history |
| Saboteur lies | Can contradict themselves | Consistent | Coordinated with teammates (no clashing claims), frames suspects |
| Vote threshold | Low (votes on hunches) | Medium | High, but acts on hard evidence at once |
| Night actions | Random legal (today's behavior) | Aimed about half the time | Aimed: search or sweep near suspects, treat the likely victim, plant next to the loudest Investigator or Stewardess |

### Engine additions (small, for machine-readable knowledge)

- The Pilot's `'watch'` log entry gains `data.seen: { actor, kind, target? }[]`, alongside the existing text.
- The `'verdict'` log entry gains `data.votes` (voter → target or `'skip'`) when votes are not anonymous. This is the same information everyone saw during the vote.

## What bots say, and when

**When they talk:**
- **Dawn and discussion:**
  - they react to the night: a death, a blast, who used the washroom, who was on the flight deck;
  - they share results, make claims, and accuse or defend.
- **When named or asked:**
  - the bot types for 2–5 s (by personality and line length), then answers;
  - accused, it defends itself with its claim and results;
  - asked a question, it answers;
  - when someone else is accused, it agrees or pushes back, depending on its own suspicion.
- **Voting:**
  - it announces its vote with a reason ("Voting Jo: two bombs right by her seat."), or says it is skipping because it is not sure;
  - bots cast their vote a few seconds into the vote phase, not all at once.
- **Verdict:** a reaction ("Knew it." / "Oh no, she was the Nurse.").
- **Bot Pilot:** uses the PA by day to report what the cabin cameras saw. The typed PA already becomes 3D captions for everyone.
- **At night, in the saboteur channel only:**
  - saboteur bots post their plan ("Planting under 6D.");
  - they follow a human teammate's order when the order names them or everyone, and confirm by name ("On it: 5C.");
  - an order that cannot be carried out gets a refusal with the reason ("Can't reach 9A tonight.");
  - orders can change a bot's move and action until the phase ends. The bot re-submits.
- **Ghost bots** stay quiet.

**Chattiness (host setting):**

| | Quiet | Normal | Lively |
| --- | --- | --- | --- |
| Proactive lines per bot per day | 0–1 | 2–4 | 5–8 |
| Answers when named | Yes | Yes | Yes |
| Vote line | Yes | Yes | Yes |
| Banter and agreeing | No | Some | Yes |

**Rate limits:**
- across all bots, at most one line every 2.5 s;
- each bot waits at least 6 s between its own lines;
- answers to a human jump the queue;
- the engine's 1 s chat cooldown and 200-character limit still apply.

## In 3D (M16)

- **Speech bubbles:**
  - every cabin chat line, from humans and bots alike, pops up over the speaker's head for about 5 s (longer for long lines);
  - styled like the emote bubbles, cut at about 80 characters with an ellipsis, and placed above an emote bubble if both show;
  - not for the PA (it has captions), whispers, the saboteur channel or the ghost channel. The chat tab does not change.
- **Babble:**
  - when a bot's cabin line arrives, each player's game plays a burst of gibberish from the bot's head, one blip per syllable;
  - vowels shift the pitch and timbre, and each bot has its own voice pitch (from its personality);
  - it follows the voice chat's distance falloff (`proximityGain`) and the sound mute;
  - Web Audio only: no libraries or audio files. The text-to-syllables planner is pure and tested.

## Settings

- `Settings.botChatter: 'quiet' | 'normal' | 'lively'`, default `'normal'`.
- `Settings.botSkill: 'easy' | 'normal' | 'hard'`, default `'normal'`.
- Shown in the lobby settings form, validated by `validateSettings`, filled in for older snapshots by `normalizeSettings`, and carried by the protocol's `cleanSettings`.

## Testing

- **Unit tests:**
  - `hear`: names, first names, seats, roles, claims, results, questions and orders;
  - `mind`: each kind of evidence moves suspicion the right way; saboteur bots never accuse teammates (Easy and Normal);
  - fairness: the bot only uses its view. Two games that differ only in who the hidden bomber is give an identical view, and so identical beliefs;
  - `phrasebook`: every template fills in for every tone;
  - `talk` timing: chattiness budgets, reply delays and the global rate limit;
  - the babble planner: text to syllables.
- **Simulation:** full flights with talking bots at every skill and chattiness level. No engine error from a bot intent, and chat stays inside the rate limits.
- **In the browser:**
  - a solo flight where bots chat, and in M16 bubble and babble;
  - accusing a bot by name and watching it answer;
  - playing a saboteur and ordering bot teammates at night.

## Delivery

- **M15:** the brains, chat, votes, night talk and orders, the Pilot's PA reports, the settings, and the engine additions.
- **M16:** speech bubbles and babble in 3D.

The tutorial, accessories, flight recorder replay and plane types follow as M17–M20.

## Out of scope

- Language models.
- Parsing languages other than English.
- Bots whispering.
- Ghost bot chat.
- Bot difficulty per bot: one setting covers every bot on a flight.
