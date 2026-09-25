# M15: Talking bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bots read the chat, reason from their own seat's view, talk (claims, results, accusations, answers, vote reasons, night plans), follow a human saboteur's orders, and vote with reasons. The host sets their chatter and skill. Spec: `docs/superpowers/specs/2026-09-24-talking-bots-design.md` (M16 adds bubbles and babble in 3D).

**Architecture:**
- A new pure folder `src/bots/` (no DOM, no network).
- `hear.ts` parses chat lines into facts, `knowledge.ts` reads a `PlayerView` into certain facts, and `mind.ts` turns both into claims and suspicion.
- `decide.ts` picks votes, aimed night choices and orders. `talk.ts` and `phrasebook.ts` say things in a bot's tone.
- `BotBrain` (`brain.ts`) ties them together per bot. A `TalkLimiter` (`limiter.ts`) spaces lines across all bots.
- The host keeps one brain per bot and gives it `viewFor(game, botId)` about once a second.
- The engine only gains machine-readable `data` on some log entries, the two settings, and unique bot names (host).

**Tech Stack:** TypeScript 7, Vitest 5, the existing engine (`viewFor`, `applyIntent`, `botIntents`).

---

### Task 1: Bot settings

**Files:**
- Modify: `src/engine/types.ts` (Settings)
- Modify: `src/engine/settings.ts` (defaults, validation)
- Modify: `src/net/protocol.ts` (`cleanSettings`)
- Modify: `src/app/SettingsForm.tsx` (a Bots block and the summary)
- Test: `src/engine/settings.test.ts` (or the existing settings tests), `src/net/protocol.test.ts`

- [ ] Add the types and fields:
  ```ts
  export type BotChatter = 'quiet' | 'normal' | 'lively';
  export type BotSkill = 'easy' | 'normal' | 'hard';
  // in Settings:
  /** How much bots talk. */
  botChatter: BotChatter;
  /** How well bots reason and lie. */
  botSkill: BotSkill;
  ```
- [ ] Wire them through:
  - `defaultSettings()` gets `botChatter: 'normal', botSkill: 'normal'`;
  - `validateSettings` returns `'Unknown bot chatter.'` / `'Unknown bot skill.'` for other values;
  - `normalizeSettings` already spreads the defaults.
- [ ] `cleanSettings`: `const botChatter = raw.botChatter ?? 'normal'` and `const botSkill = raw.botSkill ?? 'normal'`, rejecting anything outside the unions. Include both in the returned object.
- [ ] `SettingsForm`, in the Rules column after "Pilot must fly":
  - a `<h2>Bots</h2>` with two segmented controls: Quiet / Normal / Lively, and Easy / Normal / Hard;
  - a hint: "Only matters when bots are aboard.";
  - the summary gains `Bots: ${chatter} chatter, ${skill}.`.
- [ ] Tests:
  - defaults are normal/normal;
  - `validateSettings({...defaultSettings(), botSkill: 'godlike'})` returns `'Unknown bot skill.'`;
  - `cleanSettings` of settings without the fields fills in normal/normal;
  - `cleanSettings` with `botChatter: 'loud'` returns null.
- [ ] Run `npx tsc --noEmit -p . && npx vitest run`, then commit `feat: bot chatter and skill settings`.

### Task 2: Machine-readable results in the log

**Files:**
- Modify: `src/engine/night.ts`, `src/engine/day.ts`
- Modify: `src/engine/types.ts` (a `Sighting` type)
- Test: `src/engine/pilot.test.ts`, `src/engine/night.test.ts`, `src/engine/mechanics.test.ts` (wherever each result is already tested)

- [ ] Add `data` to the actor's own result entries (their text does not change):
  - `'treat'`: `{ target: t.id }`;
  - `'serve'`: `{ target: t.id }`;
  - the actor's private `'cuff'` (both outcomes): `{ target: t.id }`;
  - `'sweep'`: `{ bombs, seats }`, where `seats` are the seat ids within `SWEEP_RADIUS` of the actor's cell, in the cabin;
  - `'inspect'`: `{ bombs, what: action.what }`.
- [ ] `'watch'`: `{ rows, seen }` with
  ```ts
  export interface Sighting { actor: string; kind: NightAction['kind'] | 'flashlight' | 'pills'; target?: string; seat?: SeatId }
  ```
  One entry per line of the text: the acting player and the action kind; the target for treat, serve and cuff; the seat for flashlight and the check side's seats.
- [ ] `'verdict'` (both entries) gains `votes: { ...s.day.votes }` when `!s.settings.anonymousVotes`: voter to target or `'skip'`, voters only.
- [ ] Tests:
  - a Nurse's treat entry has `data.target`;
  - a Pilot watching a row where someone plants gets `data.seen` containing `{ actor, kind: 'plant' }`;
  - a verdict entry has `data.votes[voter] === target` with open votes and no `votes` with anonymous votes.
- [ ] Run `npx vitest run`, then commit `feat(engine): machine-readable night results and votes`.

### Task 3: Unique bot names

**Files:**
- Modify: `src/net/host.ts` (`BOT_NAMES`, the `addBot` command)
- Test: `src/net/net.test.ts`

- [ ] Extend `BOT_NAMES` to 32 short names: add `Ana, Ben, Dot, Gil, Kai, Liv, Moe, Ned, Ola, Rex, Sal, Tam, Uma, Vic, Wes, Zoe`.
- [ ] `addBot` picks at random among names whose lower-case form is not the first word of any player's name. Only when all 32 are taken does it fall back to today's random pick plus `uniqueName` numbering.
- [ ] Test: a flight with the captain and 15 added bots has 16 different first words.
- [ ] Run the tests, then commit `fix(host): bots get names nobody has`.

### Task 4: Hearing (`src/bots/hear.ts`)

**Files:**
- Create: `src/bots/hear.ts`, `src/bots/hear.test.ts`

- [ ] Types:
  ```ts
  export interface RosterEntry { id: string; name: string; seat: SeatId | null }
  export interface ResultClaim { what: 'clear' | 'bomb'; seats: SeatId[]; where: 'seat' | 'cart' | 'lavatory' }
  export type Ask = 'role' | 'result' | 'suspect' | 'general';
  export interface Order { who: string[] | 'all'; act: 'plant' | 'poison' | 'move' | 'stay' | 'knockout'; seat?: SeatId; target?: string; where?: 'seat' | 'cart' | 'lavatory' }
  export interface Heard {
    /** Everyone the line names (by name, first name, or the seat they sit in). */
    about: string[];
    /** Who it is said to: named at the start ("Jo, …", "@Jo") or at the end of a question; '*' for everyone/anyone. */
    to: string[];
    claim: RoleId | null;
    results: ResultClaim[];
    accuse: { id: string; role: RoleId | null }[];
    defend: string[];
    vote: string | null;
    ask: Ask | null;
    order: Order | null;
  }
  export function hear(text: string, speaker: string, roster: RosterEntry[], channel: ChatChannel | 'whisper'): Heard
  ```
- [ ] Names: lower-case word-boundary matches for:
  - the full name;
  - the name without ` (bot)` and trailing numbers;
  - the first word when it is unique among the roster and at least 2 letters.

  The speaker never counts as `about` themselves. Seats: `/\b(\d{1,2})\s?([a-f])\b/i` becomes `"4C"`; the player sitting there counts as named.
- [ ] Roles: passenger; pilot/captain; nurse/doctor/medic; investigator/detective; air marshal/marshal/cop; stewardess/steward/flight attendant/crew; bomber; mastermind; saboteur (role null in an accusation).
- [ ] The kinds of fact (a line can hold several):
  - **claim:** first person ("i'm", "i am", "im", "as the", "i'm the") followed by a role word.
  - **results:** searched/checked/swept/looked under/inspected with seats, "my seat" (the speaker's seat), the cart or the lavatory; plus an outcome. Clean/clear/nothing/empty/safe means clear; bomb/wires/device/ticking/found means bomb. "Found a bomb at 5C" counts.
  - **accuse:** a named player plus an accusation word (sus, suspicious, bomber, saboteur, mastermind, liar, lying, guilty, did it, killer, restrain, cuff), or "it's X", or "vote X". Negation within three words before ("not sus", "isn't the bomber") flips it to defend.
  - **defend:** a named player plus clear/trust/innocent/good/safe/vouch/confirmed/legit/"with me".
  - **vote:** vote/voting/"i vote" plus a name or seat, or skip/skipping/abstain.
  - **ask:** "?" or a question word first:
    - "what did you (find|search|check)" is `result`;
    - "who are you" / "what('s| is) your role" / "what are you" is `role`;
    - "who('s| is) (sus|the bomber|it)" / "who do you suspect" is `suspect`;
    - anything else is `general`.
  - **order:** only when `channel === 'saboteurs'`, and addressed names or everyone/all/team (otherwise 'all'):
    - plant/bomb plus a seat, the cart or the lavatory;
    - poison/serve plus a name or seat;
    - move/switch/sit/go to plus a seat;
    - stay/lay low/wait/do nothing;
    - knock/knockout/"take out the pilot".
- [ ] Tests (one `it` per kind, with at least these lines, the roster Jo (bot) in 4C, Cal (bot) in 5C, Ann in 2B, and Captain Kay in Cockpit):
  - `"I'm the investigator, searched 4C and it's clean"`: claim investigator, results clear [4C], about [jo];
  - `"Jo is the bomber"`: accuse jo with role bomber;
  - `"jo isn't sus"`: defend jo, and no accusation;
  - `"Cal, what did you find?"`: to [cal], ask result;
  - `"voting 5C"`: vote cal;
  - `"skip"`: vote skip;
  - `"found wires under 2B!"`: result bomb [2B], about [ann];
  - `"anyone?"`: to ['*'], ask general;
  - saboteur channel `"Cal, plant 5C"`: order { who: [cal], act: plant, seat: 5C, where: seat };
  - `"everyone lay low"`: order { who: all, act: stay };
  - the same "plant 5C" in the cabin gives no order;
  - `"Jo (bot) 2"` matching when two Jos exist: the full name wins over the shared first name.
- [ ] Run `npx vitest run src/bots/hear.test.ts`, then commit `feat(bots): hear claims, results, accusations, questions and orders`.

### Task 5: Knowledge (`src/bots/knowledge.ts`)

**Files:**
- Create: `src/bots/knowledge.ts`, `src/bots/knowledge.test.ts`
- Create: `src/bots/testkit.ts` (views for tests, built with the engine's `createGame` + `applyIntent` + `tick` + `viewFor`)

- [ ] Types:
  ```ts
  export interface Finding { night: number; where: 'seat' | 'cart' | 'lavatory'; seats: SeatId[]; bombs: string[] }
  export interface Seen { night: number; actor: string; kind: string; target?: string }
  export interface VerdictFact { night: number; restrained: string | null; votes: Record<string, string> | null }
  export interface Knowledge {
    me: YouView;
    night: number;
    /** Other players still in play. */
    others: PlayerSummary[];
    /** Saboteur teammates (ids); empty for passengers. */
    team: string[];
    /** Roles I know for certain: revealed ones, and my team's. */
    roleOf: Map<string, RoleId>;
    findings: Finding[];
    treated: { night: number; target: string }[];
    seen: Seen[];
    verdicts: VerdictFact[];
    deaths: { night: number; id: string; cause: string }[];
    /** Bombs I know of: live, defused or exploded, with their location (from view.bombs). */
    bombs: BombView[];
    poisoned: boolean;
  }
  export function know(view: PlayerView): Knowledge
  ```
- [ ] Read everything from `view.you`, `view.players`, `view.bombs` and `view.log` (tags `search`, `check`, `sweep`, `inspect`, `treat`, `watch`, `verdict`, `death`, `explosion`, `cuff`, using the Task 2 data). Never touch `GameState`.
- [ ] Tests:
  - an Investigator who swept and found the bomb has one finding with that bomb id and the seats;
  - a saboteur's `team` lists the other saboteurs, and a passenger's is empty;
  - after a verdict with open votes, `verdicts[0].votes` has everyone's votes;
  - a restrained, revealed saboteur appears in `roleOf`.
- [ ] Commit `feat(bots): what a bot knows from its own view`.

### Task 6: Beliefs (`src/bots/mind.ts`)

**Files:**
- Create: `src/bots/mind.ts`, `src/bots/mind.test.ts`

- [ ] Types:
  ```ts
  export interface Claim { role: RoleId | null; results: (ResultClaim & { night: number })[]; at: number }
  export interface HeardLine { id: number; t: number; night: number; from: string; channel: ChatChannel | 'whisper'; heard: Heard }
  export interface Beliefs {
    claims: Map<string, Claim>;
    /** 0..1 per other player in play: how likely a saboteur (for a saboteur bot: how much the cabin blames them). */
    suspicion: Map<string, number>;
    /** The strongest piece of evidence per player, for the phrasebook. */
    why: Map<string, Reason>;
  }
  export type Reason =
    | { kind: 'bomb'; seat: SeatId }
    | { kind: 'double_claim'; role: RoleId; other: string }
    | { kind: 'lied'; seat: SeatId }
    | { kind: 'seen'; what: string }
    | { kind: 'votes' }
    | { kind: 'defended'; saboteur: string }
    | { kind: 'accused' }
    | { kind: 'hunch' };
  export function believe(k: Knowledge, lines: HeardLine[], seatsByNight: Map<number, Map<string, SeatId>>, skill: BotSkill, noise: (id: string) => number): Beliefs
  ```
- [ ] Passenger bots start everyone at 0.2. Evidence:

  | Evidence | Change |
  | --- | --- |
  | Sat on a seat where I found (or saw explode) a bomb, that night or the night before | +0.5 |
  | Sat next to such a seat | +0.15 |
  | Claims a unique role (Nurse, Investigator, Air Marshal, Stewardess) someone else also claims | +0.25 each |
  | Claims a role a revealed player had | +0.6 |
  | Claims a result that contradicts my own finding for that seat and night | +0.5 |
  | Pilot bot: my cameras saw them hand a drink to someone who fell sick | +0.7 |
  | Pilot bot: my cameras saw them bend down under their seat on a night a seat bomb appeared | +0.15 |
  | Defended a revealed saboteur | +0.3 |
  | Each vote for a revealed passenger | +0.1 |
  | Each vote for a revealed saboteur | −0.1 |
  | Each accusation from a trusted player (suspicion under 0.3) | +0.05 |
  | Claimed a bomb that turned up where they said | −0.2 |
  | I searched their seat and it was clean | −0.1 |

  Clamp to [0, 1].
- [ ] Skill mixes in noise: `easy = 0.5*e + 0.5*n`, `normal = 0.8*e + 0.2*n`, `hard = e + 0.05*n`. Easy also believes every claim: no double-claim or contradiction terms.
- [ ] Saboteur bots:
  - teammates get 0 and never appear as suspects;
  - `suspicion` becomes cabin heat: accusations and votes against each non-teammate, normalized.
- [ ] Tests:
  - a bomb found at 5C raises the suspicion of whoever sat in 5C that night above everyone else;
  - two Investigator claims raise both claimers (Normal) but not on Easy;
  - a saboteur bot's teammates stay at 0 while the cabin accuses them;
  - fairness: two games with the same seed where only two other players swap hidden roles give identical views for a passenger bot, and so identical beliefs (`expect(believe(...)).toEqual(believe(...))`).
- [ ] Commit `feat(bots): claims and suspicion`.

### Task 7: Decisions (`src/bots/decide.ts`)

**Files:**
- Create: `src/bots/decide.ts`, `src/bots/decide.test.ts`

- [ ] `chooseVote(view, k, b, skill, rng): { target: string; reason: Reason | null }` (`target` is an id or `'skip'`):
  - Passenger bots vote for the top suspect when their suspicion is at least `easy 0.3 / normal 0.45 / hard 0.55`, otherwise `'skip'`.
  - Saboteur bots vote for the non-teammate with the most heat, else the player they framed, else a random non-teammate. They never vote for a teammate, except on Hard when that teammate already has more than half the votes cast (`view.votes.counts`).
- [ ] `chooseNight(view, k, b, skill, rng): { move?: MoveTarget; act?: NightAction | null; calls?: Intent[] }`. Easy returns `{}`, and Normal returns `{}` half of the time; `{}` keeps `botIntents`' random choice. Every returned choice must be in `view.options` (`seats`, `actions`, `seatbelt`, `jumpseat`), otherwise it is dropped. By role:
  - **Investigator:** move next to the top suspect in `night_move`; sweep in `night_act`.
  - **Nurse:** treat herself when poisoned, else the claimed Investigator or Stewardess when in reach.
  - **Air Marshal:** cuff the top suspect in reach when suspicion is at least 0.8 (Normal) or 0.7 (Hard).
  - **Loyal Stewardess:** walk to the top suspect's row and check their side.
  - **Pilot:** seatbelt on the top suspect, watch the three rows starting one above the top suspect's row, and on Hard call the most trusted player to the jump seat.
  - **Bomber and Mastermind:** move next to the loudest claimed Investigator or Stewardess, then plant under their own seat (fuse 1 on Hard, else 2).
  - **Rogue Stewardess:** walk to the loudest claimer's row and serve them.
  - **Rogue Pilot:** seatbelt the loudest claimer, and send them to the jump seat so they can't act.
- [ ] `followOrder(view, order): { move?: MoveTarget; act?: NightAction | null; ok: boolean; why?: string }` maps an order onto legal options:
  - plant: my seat means plant at the seat, and cart or lavatory when that option is legal; a seat elsewhere means move there in `night_move` when legal;
  - poison: serve the target when legal;
  - move: to the seat;
  - stay: `{ move: 'stay' }` or `{ act: null }`;
  - knockout: when legal.
  - When nothing is legal, return `ok: false` with a short reason: "can't reach 9A tonight", "my bomb's already out", "I'm buckled in".
- [ ] Tests:
  - a Normal passenger bot votes for the only player with bomb evidence and skips when nothing is known;
  - a saboteur bot never votes for a teammate even when the teammate is the top suspect by heat;
  - Hard Investigator moves next to the top suspect;
  - every `chooseNight` result across 200 random views is in `view.options`;
  - `followOrder` plants when told to plant at my own seat, refuses a seat it cannot reach, and stays when told to lay low.
- [ ] Commit `feat(bots): votes, aimed night choices and orders`.

### Task 8: Voice (`src/bots/personality.ts`, `src/bots/phrasebook.ts`)

**Files:**
- Create: `src/bots/personality.ts`, `src/bots/phrasebook.ts`, `src/bots/phrasebook.test.ts`

- [ ] `personality(id): { tone: Tone; typing: number; pitch: number }`, seeded from a hash of the id:
  - `Tone = 'blunt' | 'nervous' | 'chatty' | 'formal'`;
  - typing is seconds per 10 characters, 0.35–0.8;
  - pitch is 0–1, for M16's babble.
- [ ] `LineKind` covers:
  - react_death, react_blast, react_quiet, react_washroom, react_jumpseat;
  - claim, result_clear, result_bomb, accuse, defend_self, defend_other, agree, disagree;
  - answer_role, answer_result, answer_suspect, dunno;
  - vote, skip, verdict_right, verdict_wrong;
  - plan_plant, plan_poison, plan_low, order_ok, order_no;
  - pa_cameras, pa_quiet, banter.

  Each has 4–6 templates with `{name}`, `{seat}`, `{seats}`, `{role}`, `{why}`, `{target}` and `{night}` slots. `why` comes from `Reason`: bomb gives "the bomb was right under {seat}", double_claim gives "{other} claims {role} too", and so on.
- [ ] Tone is a light pass over the filled template:
  - blunt: drop the leading filler, end without "!";
  - nervous: sometimes lead with "um," / "I think" / "not sure but";
  - chatty: sometimes lead with "okay so" / "honestly";
  - formal: capitalized, no slang ("sus" becomes "suspicious").

  Cut at 120 characters.
- [ ] `say(kind, fill, tone, rng): string`.
- [ ] Tests: every template of every kind fills in with a full `Fill` for every tone, contains no `{`, stays under 121 characters, and two different seeds give at least two different wordings for `accuse`.
- [ ] Commit `feat(bots): personalities and a phrasebook`.

### Task 9: What to say, and when (`src/bots/talk.ts`, `src/bots/limiter.ts`)

**Files:**
- Create: `src/bots/talk.ts`, `src/bots/limiter.ts`, `src/bots/talk.test.ts`

- [ ] `limiter.ts`: `class TalkLimiter { constructor(globalMs = 2500, perBotMs = 6000); may(botId, now, reply: boolean): boolean; spoke(botId, now): void }`. Replies ignore the global gap but not the per-bot gap. The engine's 1 s cooldown still applies.
- [ ] `talk.ts`:
  ```ts
  export interface Say { kind: LineKind; channel: ChatChannel; fill: Fill; priority: number; key: string; at: number; reply: boolean }
  export function wants(view, k, b, fresh: HeardLine[], memory: TalkMemory, chatter: BotChatter, now): Say[]
  ```
  `TalkMemory` records the keys said, lines said per day, and the reply count per day.
- [ ] Triggers:
  - **Dawn and discussion, once per day each:**
    - react to the night: a death, a blast, the washroom, the jump seat, or a quiet night;
    - a result from last night when the role has one: Investigator, Stewardess, Nurse;
    - a claim when accused or asked, or proactively on Normal/Lively when holding a bomb result;
    - accuse the top suspect when above the vote threshold.
  - **Fresh lines addressed to me:**
    - accused: defend_self (with my claim and result);
    - asked: answer_role, answer_result, answer_suspect or dunno;
    - due 2–5 s after the line (typing).
  - **Someone else accused X** (Normal/Lively): agree when my suspicion of X is at least 0.5, and disagree when it is at most 0.15 and I have a claim to back it.
  - **day_vote:** vote/skip when the vote is cast, with the reason.
  - **verdict:** verdict_right or verdict_wrong from the revealed role.
  - **Pilot bot by day:** pa_cameras or pa_quiet once per day on the `'pa'` channel.
  - **Night, saboteur bots only, on the `'saboteurs'` channel:**
    - plan_* once per night;
    - order_ok or order_no in answer to a teammate's order.
  - **Ghosts:** nothing.
- [ ] Budgets for proactive lines per day: quiet 1, normal 4, lively 8. Replies are capped at 4 per day, and vote and verdict lines are always allowed.
- [ ] Tests:
  - an accused bot wants a defend_self reply due 2–5 s later;
  - a quiet bot makes at most one proactive line a day across a long discussion;
  - a lively bot makes more than a normal one in the same situation;
  - a saboteur bot only ever says night lines on `'saboteurs'`;
  - `TalkLimiter` blocks a second line from any bot within 2.5 s and from the same bot within 6 s.
- [ ] Commit `feat(bots): when bots talk`.

### Task 10: The brain (`src/bots/brain.ts`)

**Files:**
- Create: `src/bots/brain.ts`, `src/bots/index.ts`, `src/bots/brain.test.ts`

- [ ] The class:
  ```ts
  export interface BotTurn { chat: { channel: ChatChannel; text: string }[]; intents: Intent[] }
  export class BotBrain {
    constructor(readonly id: string, seed: number);
    /** The phase's random plan (from botIntents), adjusted: aimed night choices and the vote come from here. */
    adjust(view: PlayerView, planned: Intent[], now: number): Intent[];
    /** Every second or so: follow-ups (orders, the vote if not cast yet) and at most one line of chat. */
    think(view: PlayerView, now: number, limiter: TalkLimiter): BotTurn;
  }
  ```
- [ ] Internals:
  - a `Map<messageId, Heard>` cache;
  - the last chat id seen;
  - a seat history by night, recorded from `view.players` whenever the night changes;
  - the talk memory;
  - a seeded RNG (`nextFloat`-style, from `src/engine/rng.ts`);
  - noise per (player, day) from a hash.

  The brain keeps nothing else, so a host reload only loses seat history and small talk.
- [ ] `adjust`:
  - replaces a planned `vote` with `chooseVote`;
  - replaces planned `move`/`act`/Pilot calls with `chooseNight` when it returns them;
  - when an order is pending for this phase, `followOrder` wins.
- [ ] `think`:
  - parses fresh lines;
  - rebuilds knowledge and beliefs;
  - in night phases, turns a fresh order from a teammate into intents (resubmitted, since moves and actions can change until the phase ends), and queues order_ok or order_no;
  - in day_vote, casts the vote 3–8 s into the phase if `view.mine.vote` is null;
  - picks the highest-priority `Say` that is due and allowed by the limiter, fills it with `say()`, and returns it.
- [ ] Tests (with the testkit):
  - a bot accused in chat answers within 6 s of game time across repeated `think` calls, and not before 2 s;
  - a saboteur bot ordered "Cal, plant 5C" while sitting in 5C in night_act returns an `act` intent `{ kind: 'plant', where: 'seat' }` and an order_ok line on `'saboteurs'`;
  - `think` in day_vote casts one vote and never votes twice.
- [ ] Commit `feat(bots): a brain per bot`.

### Task 11: The host runs the brains

**Files:**
- Modify: `src/net/host.ts`

- [ ] Fields:
  - `private readonly brains = new Map<string, BotBrain>()`, cleared when `game.id` changes and at `boardAgain`;
  - `private readonly limiter = new TalkLimiter()`;
  - `private thinkAt = new Map<string, number>()`, so each bot thinks every 900–1300 ms, staggered.
- [ ] `runBots`:
  - when a plan is due: `intents = brain.adjust(viewFor(game, id, now), botIntents(game, id, rng), now)`, applied as today;
  - when a think is due: `turn = brain.think(viewFor(game, id, now), now, limiter)`. Apply `turn.intents`, then each chat line as `{ kind: 'chat', channel, text }`. Failures are ignored.
  - Return true when anything was applied, so the state goes out.
  - Easy skill still runs `think`: bots talk and vote by noisy suspicion.
- [ ] Bots think only in live phases (`dawn` through `verdict`, plus nights), never in packing, boarding or ended.
- [ ] Commit `feat(host): bots think and talk`.

### Task 12: The talking simulation

**Files:**
- Create: `src/bots/sim.test.ts`

- [ ] Like `src/engine/sim.test.ts`, but each step also runs the brains:
  - `adjust` for the planned intents;
  - `think` three times per phase at advancing times;
  - every skill × chatter combination;
  - 5, 8 and 12 players;
  - three seeds each.

  Every planned or thought intent must be accepted by `applyIntent`, except chat that loses a race with the 1 s cooldown. Assert zero other rejections.
- [ ] Every game ends, and the chat volume per day stays under the budgets plus replies.
- [ ] 30 s timeout, like the engine sim.
- [ ] Commit `test(bots): talking bots play whole flights`.

### Task 13: Check in the browser and ship M15

- [ ] `npx tsc --noEmit -p . && npx vitest run && npm run build`.
- [ ] In the preview, a solo flight with 7 bots on Normal/Normal:
  - bots react at dawn;
  - an Investigator bot reports a result;
  - typing "Jo is the bomber" gets Jo to defend itself within about 5 s, and others agree or disagree;
  - bots announce votes with reasons;
  - as a saboteur (force the role in the host snapshot), "Cal, plant 5C" in the saboteur channel gets "On it" and the plant;
  - Quiet and Lively visibly change the volume.
- [ ] Merge to main, push, check the deploy (`gh run list`, live bundle hash), and update the project memory with M15 and M16 next.
