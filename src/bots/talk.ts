import { ROLES, grid, isNightPhase, type BotChatter, type BotSkill, type ChatChannel, type PlayerView, type RoleId } from '../engine';
import type { Knowledge, Seen } from './knowledge';
import type { TalkLimiter } from './limiter';
import { suspects, SABOTEUR_ROLES, type Beliefs, type HeardLine, type Reason } from './mind';
import type { Personality } from './personality';
import type { Fill, LineKind } from './phrasebook';

/**
 * When a bot talks, and about what: reactions to the night, results, claims, accusations, answers to
 * whoever talks to it, its vote, and (for saboteurs, in their own channel) plans and orders. `wants`
 * lists everything the bot would like to say now; `choose` picks one line within the budgets.
 */

export interface Say {
  kind: LineKind;
  channel: ChatChannel;
  fill: Fill;
  /** Higher goes first. */
  priority: number;
  /** Said once: repeating the key is skipped. */
  key: string;
  /** Not before (ms). */
  at: number;
  /** An answer to someone (skips the shared gap and has its own budget). */
  reply: boolean;
  /** The chat line it answers. */
  line?: number;
}

export interface TalkMemory {
  said: Set<string>;
  /** The day the counters below are for. */
  day: number;
  proactive: number;
  replies: number;
  /** Chat lines already answered. */
  answered: Set<number>;
  /** A saboteur's cover story, kept once told. */
  cover: RoleId | null;
}

export function newMemory(): TalkMemory {
  return { said: new Set(), day: -1, proactive: 0, replies: 0, answered: new Set(), cover: null };
}

/** Proactive lines a day, by chatter. Answers, votes and verdict reactions do not count. */
export const BUDGET: Record<BotChatter, number> = { quiet: 1, normal: 4, lively: 8 };
const REPLY_BUDGET = 4;
const FREE: ReadonlySet<LineKind> = new Set(['vote', 'skip', 'verdict_right', 'verdict_wrong', 'order_ok', 'order_no', 'plan_plant', 'plan_poison', 'plan_low']);
const ACCUSE_BAR: Record<BotSkill, number> = { easy: 0.35, normal: 0.5, hard: 0.55 };

export interface TalkContext {
  view: PlayerView;
  k: Knowledge;
  b: Beliefs;
  /** Lines heard since the last think (never my own). */
  fresh: HeardLine[];
  memory: TalkMemory;
  chatter: BotChatter;
  skill: BotSkill;
  now: number;
  /** When the current phase started (ms, on the same clock as `now`). */
  phaseStart: number;
  me: Personality;
  rng: () => number;
  /** A player's name as bots say it ("Jo", not "Jo (bot)"). */
  name: (id: string) => string;
}

export function roleName(role: RoleId): string {
  if (role === 'stewardess_loyal' || role === 'stewardess_rogue') return 'Stewardess';
  if (role === 'pilot_rogue') return 'Pilot';
  return ROLES[role].name;
}

/** A reason as a clause: "a bomb turned up under 5C". */
export function reasonText(r: Reason, name: (id: string) => string): string {
  switch (r.kind) {
    case 'bomb':
      return `a bomb turned up under ${r.seat}, their seat`;
    case 'double_claim':
      return `${name(r.other)} is the ${roleName(r.role)} too, supposedly`;
    case 'lied_role':
      return r.role === 'pilot' ? "the Pilot doesn't sit back here" : 'the Stewardess works the aisle, not a seat';
    case 'lied':
      return `their story about ${r.seat} doesn't match what I found`;
    case 'reported':
      return `${name(r.by)} found a bomb under ${r.seat}`;
    case 'seen':
      return r.what === 'drink' ? `the cameras saw them hand ${r.target ? name(r.target) : 'someone'} a drink` : 'the cameras caught them up to something';
    case 'votes':
      return 'they keep voting out passengers';
    case 'defended':
      return `they stuck up for ${name(r.saboteur)}`;
    case 'accused':
      return "everyone's pointing at them";
    case 'hunch':
      return 'just a feeling';
  }
}

/** What the cabin cameras showed, as the Pilot would put it on the PA. */
function sightingText(s: Seen, name: (id: string) => string): string {
  const t = s.target ? name(s.target) : 'someone';
  switch (s.kind) {
    case 'drink':
      return `handing ${t} a drink`;
    case 'under_seat':
      return 'bending down under their seat';
    case 'cart':
      return 'fiddling with the drink cart';
    case 'lavatory':
      return 'hanging around the lavatory door';
    case 'pills':
      return `slipping something into ${t}'s water`;
    case 'cuff':
      return `snapping handcuffs on ${t}`;
    case 'lean':
      return `leaning over to ${t}`;
    case 'check':
      return 'checking under seats';
    case 'look_around':
      return 'looking around the seats nearby';
    case 'flashlight':
      return `shining a light under ${s.seat ?? 'a seat'}`;
  }
}

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** How long a bot takes to type a reply to a line said at `t`. */
function typed(ctx: TalkContext, t: number, length = 40): number {
  return t + Math.min(5000, Math.max(2000, (length / 10) * ctx.me.typing * 1000));
}

/** My story when someone asks or accuses: my claim, or a saboteur's cover. */
export function myClaim(ctx: TalkContext): RoleId {
  const { k, memory, skill, rng, b } = ctx;
  if (k.me.team !== 'saboteurs') return k.me.role === 'stewardess_loyal' ? 'stewardess_loyal' : k.me.role;
  if (k.me.role === 'stewardess_rogue' || k.me.role === 'pilot_rogue') return k.me.role === 'pilot_rogue' ? 'pilot' : 'stewardess_loyal';
  if (!memory.cover) {
    const claimed = new Set([...b.claims.values()].map((c) => c.role));
    const open = (['nurse', 'investigator'] as RoleId[]).filter((r) => !claimed.has(r));
    // Easy lies carelessly; Hard sometimes takes a role nobody has claimed yet; otherwise a plain Passenger.
    memory.cover = skill === 'easy' && rng() < 0.4 ? 'investigator' : skill === 'hard' && open.length && rng() < 0.3 ? open[0] : 'passenger';
  }
  return memory.cover;
}

/** What I found last night, as a line (a saboteur's is harmless: its own seat, clean). */
function myResult(ctx: TalkContext): { kind: LineKind; fill: Fill } | null {
  const { k } = ctx;
  if (k.me.team === 'saboteurs') return k.me.seat && grid.parseSeat(k.me.seat) ? { kind: 'result_clear', fill: { seats: k.me.seat } } : null;
  const last = k.findings.filter((f) => f.night === k.night).at(-1);
  if (!last) return null;
  const bombSeats = last.bombs
    .map((id) => k.bombs.find((b) => b.id === id)?.location)
    .filter((l): l is { kind: 'seat'; seat: string } => !!l && l.kind === 'seat')
    .map((l) => l.seat);
  if (bombSeats.length) return { kind: 'result_bomb', fill: { seats: list(bombSeats) } };
  if (last.where !== 'seat') return { kind: 'result_clear', fill: { seats: `the ${last.where}` } };
  return last.seats.length ? { kind: 'result_clear', fill: { seats: list(last.seats.slice(0, 3)) + (last.seats.length > 3 ? ' and around' : '') } } : null;
}

export function wants(ctx: TalkContext): Say[] {
  const { view, k, b, memory, now, phaseStart, rng, name, chatter, skill } = ctx;
  const kind = view.phase.kind;
  const day = view.phase.night;
  const out: Say[] = [];
  const saboteur = k.me.team === 'saboteurs';
  if (k.me.status !== 'alive') return out;

  if (isNightPhase(kind)) return out; // Night lines (plans, orders) come from the brain.
  if (kind !== 'dawn' && kind !== 'day_discuss' && kind !== 'day_vote' && kind !== 'verdict') return out;

  // Answers to whoever talks to me or about me.
  for (const l of ctx.fresh) {
    if (memory.answered.has(l.id) || (l.channel !== 'cabin' && l.channel !== 'pa') || now - l.t > 20_000) continue;
    const h = l.heard;
    if (h.accuse.some((a) => a.id === k.me.id)) {
      const claim = myClaim(ctx);
      const result = myResult(ctx);
      const why = claim !== 'passenger' ? `I'm the ${roleName(claim)}` : result ? `I searched ${result.fill.seats}` : "I've just been sitting here";
      out.push({ kind: 'defend_self', channel: 'cabin', fill: { why }, priority: 100, key: `defend:${l.id}`, at: typed(ctx, l.t), reply: true, line: l.id });
      continue;
    }
    const toMe = h.to.includes(k.me.id) || (h.to.includes('*') && rng() < 0.3);
    if (toMe && h.ask) {
      if (h.ask === 'role') {
        out.push({ kind: 'claim', channel: 'cabin', fill: { role: roleName(myClaim(ctx)) }, priority: 95, key: `ask:${l.id}`, at: typed(ctx, l.t, 20), reply: true, line: l.id });
      } else if (h.ask === 'result') {
        const r = myResult(ctx);
        out.push({ ...(r ?? { kind: 'answer_result' as LineKind, fill: {} }), channel: 'cabin', priority: 95, key: `ask:${l.id}`, at: typed(ctx, l.t), reply: true, line: l.id });
      } else {
        const top = suspects(b)[0];
        const say: Pick<Say, 'kind' | 'fill'> =
          top && top[1] >= ACCUSE_BAR[skill] ? { kind: 'answer_suspect', fill: { name: name(top[0]), why: reasonText(b.why.get(top[0]) ?? { kind: 'hunch' }, name) } } : { kind: 'dunno', fill: {} };
        out.push({ ...say, channel: 'cabin', priority: 95, key: `ask:${l.id}`, at: typed(ctx, l.t), reply: true, line: l.id });
      }
      continue;
    }
    // Someone else accused: agree or push back (a saboteur covers for its team).
    if (chatter === 'quiet') continue;
    for (const a of h.accuse) {
      if (a.id === l.from || a.id === k.me.id) continue;
      const s = b.suspicion.get(a.id) ?? 0.2;
      const teammate = k.team.includes(a.id);
      const chance = chatter === 'lively' ? 0.7 : 0.4;
      if (teammate && rng() < (skill === 'hard' ? 0.35 : 0.5)) {
        out.push({ kind: 'disagree', channel: 'cabin', fill: { name: name(a.id) }, priority: 50, key: `re:${l.id}:${a.id}`, at: typed(ctx, l.t, 20), reply: false });
      } else if (!teammate && s >= 0.5 && rng() < chance) {
        out.push({ kind: 'agree', channel: 'cabin', fill: { name: name(a.id) }, priority: 50, key: `re:${l.id}:${a.id}`, at: typed(ctx, l.t, 20), reply: false });
      } else if (!teammate && !saboteur && s <= 0.15 && rng() < chance) {
        out.push({ kind: 'disagree', channel: 'cabin', fill: { name: name(a.id) }, priority: 45, key: `re:${l.id}:${a.id}`, at: typed(ctx, l.t, 20), reply: false });
      }
    }
  }

  if (kind === 'dawn' || kind === 'day_discuss') {
    const soon = (min: number, max: number) => phaseStart + (min + rng() * (max - min)) * 1000;
    // React to the night.
    const died = k.deaths.filter((d) => d.night === day);
    const blast = k.bombs.find((bomb) => bomb.exploded && bomb.detonateNight === day && bomb.location.kind === 'seat');
    const lav = k.washroom.find((w) => w.night === day && w.id !== k.me.id);
    const upFront = k.jumpseat.find((j) => j.night === day && j.id !== k.me.id);
    const react: Pick<Say, 'kind' | 'fill'> =
      blast && blast.location.kind === 'seat'
        ? { kind: 'react_blast', fill: { seat: blast.location.seat } }
        : died.length
          ? { kind: 'react_death', fill: { name: name(died[0].id) } }
          : lav
            ? { kind: 'react_washroom', fill: { name: name(lav.id) } }
            : upFront && !grid.isCockpit(k.me.seat)
              ? { kind: 'react_jumpseat', fill: { name: name(upFront.id) } }
              : { kind: 'react_quiet', fill: {} };
    out.push({ ...react, channel: 'cabin', priority: 40, key: `react:${day}`, at: soon(2, 6), reply: false });

    // Results, and the claim that goes with a bomb found.
    const result = myResult(ctx);
    if (result && !saboteur) {
      const bomb = result.kind === 'result_bomb';
      if (bomb && skill !== 'easy' && k.me.role !== 'passenger' && !grid.isCockpit(k.me.seat)) {
        out.push({ kind: 'claim', channel: 'cabin', fill: { role: roleName(k.me.role) }, priority: 85, key: 'claim', at: soon(3, 6), reply: false });
      }
      out.push({ ...result, channel: 'cabin', priority: bomb ? 80 : k.me.role === 'passenger' ? 25 : 45, key: `result:${day}`, at: soon(4, 9), reply: false });
    } else if (result && saboteur && rng() < 0.4) {
      out.push({ ...result, channel: 'cabin', priority: 30, key: `result:${day}`, at: soon(6, 14), reply: false });
    }

    // Accuse my top suspect (a saboteur frames whoever the cabin already blames).
    const top = suspects(b).find(([id]) => !k.team.includes(id));
    if (top && (saboteur ? top[1] >= 0.35 : top[1] >= ACCUSE_BAR[skill])) {
      const why = reasonText(b.why.get(top[0]) ?? { kind: 'hunch' }, name);
      out.push({ kind: 'accuse', channel: 'cabin', fill: { name: name(top[0]), why }, priority: 60, key: `accuse:${day}:${top[0]}`, at: soon(8, 20), reply: false });
    }

    // The Pilot reports what the cabin cameras saw, over the PA.
    if (grid.isCockpit(k.me.seat)) {
      const tonight = k.seen.filter((s) => s.night === day && !k.team.includes(s.actor));
      const worst = tonight.find((s) => s.kind === 'drink') ?? tonight.find((s) => s.kind === 'pills' || s.kind === 'under_seat') ?? tonight[0];
      if (worst) {
        out.push({ kind: 'pa_cameras', channel: 'pa', fill: { name: name(worst.actor), why: sightingText(worst, name) }, priority: 70, key: `pa:${day}`, at: soon(3, 8), reply: false });
      } else if (!saboteur || rng() < 0.5) {
        out.push({ kind: 'pa_quiet', channel: 'pa', fill: {}, priority: 20, key: `pa:${day}`, at: soon(3, 8), reply: false });
      }
    }

    if (chatter === 'lively' && rng() < 0.6) out.push({ kind: 'banter', channel: 'cabin', fill: {}, priority: 5, key: `banter:${day}`, at: soon(10, 30), reply: false });
  }

  // After the vote: was the cabin right?
  if (kind === 'verdict') {
    const v = k.verdicts.find((x) => x.night === day);
    const role = v?.restrained ? k.roleOf.get(v.restrained) : undefined;
    if (v?.restrained && role && v.restrained !== k.me.id && rng() < 0.5) {
      const right = SABOTEUR_ROLES.includes(role);
      out.push({
        kind: right ? 'verdict_right' : 'verdict_wrong',
        channel: 'cabin',
        fill: { name: name(v.restrained), role: roleName(role) },
        priority: 70,
        key: `verdict:${day}`,
        at: phaseStart + (1 + rng() * 3) * 1000,
        reply: false,
      });
    }
  }
  return out.filter((s) => !memory.said.has(s.key));
}

/** The one line to say now, if any: due, within the budgets, and allowed by the limiter. */
export function choose(says: Say[], memory: TalkMemory, chatter: BotChatter, limiter: TalkLimiter, botId: string, now: number, day: number): Say | null {
  if (memory.day !== day) {
    memory.day = day;
    memory.proactive = 0;
    memory.replies = 0;
  }
  const ready = says
    .filter((s) => s.at <= now && !memory.said.has(s.key))
    .filter((s) => (s.reply ? memory.replies < REPLY_BUDGET : FREE.has(s.kind) || memory.proactive < BUDGET[chatter]))
    .sort((a, z) => z.priority - a.priority || a.at - z.at);
  const pick = ready.find((s) => limiter.may(botId, now, s.reply || FREE.has(s.kind)));
  return pick ?? null;
}

/** Note that a line was said. */
export function record(memory: TalkMemory, say: Say): void {
  memory.said.add(say.key);
  if (say.line !== undefined) memory.answered.add(say.line);
  if (say.reply) memory.replies++;
  else if (!FREE.has(say.kind)) memory.proactive++;
}
