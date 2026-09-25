import { isNightPhase, type ChatChannel, type Intent, type PlayerView, type SeatId } from '../engine';
import { nextFloat, type RngHolder } from '../engine/rng';
import { chooseNight, chooseVote, followOrder, type NightChoice, type VoteChoice } from './decide';
import { hear, type Order } from './hear';
import { know, type Knowledge } from './knowledge';
import type { TalkLimiter } from './limiter';
import { believe, type Beliefs, type HeardLine, type SeatHistory } from './mind';
import { hash01, personality, type Personality } from './personality';
import { say } from './phrasebook';
import { choose, newMemory, reasonText, record, wants, type Say, type TalkContext } from './talk';

/**
 * One bot's mind. The host hands it the bot's own view (`viewFor`): it hears the chat, keeps track of who
 * sat where, and decides what to do and say. It keeps nothing it could not rebuild but seat history and
 * small talk, so a host reload costs little.
 */

export interface BotTurn {
  chat: { channel: ChatChannel; text: string }[];
  intents: Intent[];
}

interface Standing {
  order: Order;
  night: number;
}

export class BotBrain {
  private readonly personality: Personality;
  private readonly rng: RngHolder;
  private readonly heard = new Map<number, HeardLine>();
  private readonly history: SeatHistory = new Map();
  private readonly memory = newMemory();
  private readonly pending = new Map<string, Say>();
  private phaseKey = '';
  private phaseStart = 0;
  private order: Standing | null = null;
  private tonight: NightChoice | null = null;
  private vote: (VoteChoice & { day: number }) | null = null;

  constructor(
    readonly id: string,
    seed: number,
  ) {
    this.personality = personality(id);
    this.rng = { rng: seed | 0 || 1 };
  }

  private readonly random = () => nextFloat(this.rng);

  /** Names as bots say them ("Jo", not "Jo (bot)"). */
  private namer(view: PlayerView): (id: string) => string {
    const names = new Map(view.players.map((p) => [p.id, p.name.replace(/\s*\(bot\)/i, '').trim()]));
    return (id) => names.get(id) ?? 'someone';
  }

  /** New chat lines, heard once each; and everything heard so far. */
  private listen(view: PlayerView): { lines: HeardLine[]; fresh: HeardLine[] } {
    const roster = view.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
    const fresh: HeardLine[] = [];
    for (const m of view.chat) {
      if (this.heard.has(m.id) || m.channel === 'whisper') continue;
      const line: HeardLine = { id: m.id, t: m.t, night: view.phase.night, from: m.from, channel: m.channel, heard: hear(m.text, m.from, roster, m.channel) };
      this.heard.set(m.id, line);
      if (m.from !== this.id) fresh.push(line);
    }
    return { lines: [...this.heard.values()], fresh };
  }

  /** New phase: note when it started; a new day or night clears what was waiting to be said. */
  private track(view: PlayerView, now: number): void {
    const key = `${view.phase.kind}:${view.phase.night}`;
    if (key !== this.phaseKey) {
      const wasNight = this.phaseKey !== '' && isNightPhase(this.phaseKey.split(':')[0] as PlayerView['phase']['kind']);
      if (wasNight !== isNightPhase(view.phase.kind)) this.pending.clear();
      this.phaseKey = key;
      this.phaseStart = now;
      if (view.phase.kind === 'night_move') this.tonight = null;
    }
    // Seats are set for the night once it is acting; they stay put all day.
    if (view.phase.kind !== 'night_move') {
      this.history.set(view.phase.night, new Map(view.players.filter((p) => p.seat).map((p) => [p.id, p.seat as SeatId])));
    }
  }

  private think_(view: PlayerView, lines: HeardLine[]): { k: Knowledge; b: Beliefs } {
    const k = know(view);
    const day = view.phase.night;
    const b = believe(k, lines, this.history, view.settings.botSkill, (id) => hash01(`${this.id}:${id}:${day}`));
    return { k, b };
  }

  /**
   * The phase's random plan (from the engine's botIntents), made smarter: tonight's aimed choice (or a
   * teammate's order) and a reasoned vote replace the random ones.
   */
  adjust(view: PlayerView, planned: Intent[], now: number): Intent[] {
    if (!view.you || view.you.status !== 'alive') return planned;
    this.track(view, now);
    const { k, b } = this.think_(view, this.listen(view).lines);
    const skill = view.settings.botSkill;
    const kind = view.phase.kind;
    if (kind === 'day_vote') {
      const v = chooseVote(view, k, b, skill, this.random);
      this.vote = { ...v, day: view.phase.night };
      return [...planned.filter((i) => i.kind !== 'vote'), { kind: 'vote', target: v.target }];
    }
    if (kind === 'night_move' || kind === 'night_act') {
      const ordered = this.order?.night === view.phase.night ? followOrder(view, k, this.order.order) : null;
      const choice: NightChoice = ordered?.ok ? ordered : chooseNight(view, k, b, skill, this.random);
      if (kind === 'night_act') {
        const random = planned.find((i): i is Extract<Intent, { kind: 'act' }> => i.kind === 'act');
        this.tonight = choice.act !== undefined ? choice : { act: random?.action ?? null };
      }
      let out = planned;
      if (choice.move) out = [...out.filter((i) => i.kind !== 'move'), { kind: 'move', to: choice.move }];
      if (choice.act !== undefined) out = [...out.filter((i) => i.kind !== 'act'), { kind: 'act', action: choice.act }];
      if (choice.calls?.length) {
        const kinds = new Set(choice.calls.map((c) => c.kind));
        out = [...out.filter((i) => !kinds.has(i.kind)), ...choice.calls];
      }
      return out;
    }
    return planned;
  }

  /** Every second or so: orders from teammates, and at most one line of chat. */
  think(view: PlayerView, now: number, limiter: TalkLimiter): BotTurn {
    const turn: BotTurn = { chat: [], intents: [] };
    if (!view.you) return turn;
    this.track(view, now);
    const { lines, fresh } = this.listen(view);
    if (view.you.status !== 'alive') return turn;
    const { k, b } = this.think_(view, lines);
    const kind = view.phase.kind;
    const night = view.phase.night;
    const name = this.namer(view);
    const typing = (length: number) => Math.min(5000, Math.max(2000, (length / 10) * this.personality.typing * 1000));

    if ((kind === 'night_move' || kind === 'night_act') && k.me.team === 'saboteurs') {
      // Orders from a teammate: carry them out now (moves and actions can change until the phase ends).
      for (const l of fresh) {
        const o = l.heard.order;
        if (l.channel !== 'saboteurs' || !o || !k.team.includes(l.from)) continue;
        if (o.who !== 'all' && !o.who.includes(this.id)) continue;
        this.order = { order: o, night };
        const r = followOrder(view, k, o);
        if (r.ok) {
          if (r.move) turn.intents.push({ kind: 'move', to: r.move });
          if (r.act !== undefined) {
            turn.intents.push({ kind: 'act', action: r.act });
            this.tonight = r;
          }
        }
        // An order to everyone gets an answer only from those who can carry it out.
        if (o.who !== 'all' || r.ok) {
          const fill = r.ok ? (o.seat ? { seat: o.seat } : {}) : { why: r.why ?? "can't tonight" };
          this.pending.set(`order:${l.id}`, { kind: r.ok ? 'order_ok' : 'order_no', channel: 'saboteurs', fill, priority: 100, key: `order:${l.id}`, at: l.t + typing(20), reply: true, line: l.id });
        }
      }
      // An order given while seats were changing is carried out once the lights are out (plant where it moved).
      if (kind === 'night_act' && this.order?.night === night && this.tonight?.act === undefined) {
        const r = followOrder(view, k, this.order.order);
        if (r.ok && r.act !== undefined) {
          turn.intents.push({ kind: 'act', action: r.act });
          this.tonight = r;
        }
      }
      // Tonight's plan, told to the team once.
      if (kind === 'night_act' && this.tonight && view.settings.botChatter !== 'quiet') {
        const act = this.tonight.act;
        const plan: Pick<Say, 'kind' | 'fill'> | null =
          act?.kind === 'plant'
            ? { kind: 'plan_plant', fill: { seat: act.where === 'seat' ? (k.me.seat ?? 'my seat') : `the ${act.where}` } }
            : act?.kind === 'serve'
              ? { kind: 'plan_poison', fill: { name: name(act.target) } }
              : act?.kind === 'knockout'
                ? null
                : { kind: 'plan_low', fill: {} };
        if (plan && !this.memory.said.has(`plan:${night}`) && !this.pending.has(`plan:${night}`)) {
          this.pending.set(`plan:${night}`, { ...plan, channel: 'saboteurs', priority: 50, key: `plan:${night}`, at: this.phaseStart + (3 + this.random() * 5) * 1000, reply: false });
        }
      }
    }

    // Daytime talk.
    const ctx: TalkContext = {
      view,
      k,
      b,
      fresh,
      memory: this.memory,
      chatter: view.settings.botChatter,
      skill: view.settings.botSkill,
      now,
      phaseStart: this.phaseStart,
      me: this.personality,
      rng: this.random,
      name,
    };
    for (const s of wants(ctx)) if (!this.pending.has(s.key)) this.pending.set(s.key, s);
    // The vote, and why.
    if (kind === 'day_vote' && this.vote?.day === night && !this.memory.said.has(`vote:${night}`) && !this.pending.has(`vote:${night}`)) {
      const v = this.vote;
      this.pending.set(`vote:${night}`, {
        kind: v.target === 'skip' ? 'skip' : 'vote',
        channel: 'cabin',
        fill: v.target === 'skip' ? {} : { name: name(v.target), why: reasonText(v.reason ?? { kind: 'hunch' }, name) },
        priority: 90,
        key: `vote:${night}`,
        at: now + 800 + this.random() * 1500,
        reply: false,
      });
    }

    // Say one thing, if anything is due.
    const pick = choose([...this.pending.values()], this.memory, view.settings.botChatter, limiter, this.id, now, night);
    if (pick) {
      this.pending.delete(pick.key);
      record(this.memory, pick);
      const text = say(pick.kind, pick.fill, this.personality.tone, this.random);
      if (text) {
        turn.chat.push({ channel: pick.channel, text });
        limiter.spoke(this.id, now);
      }
    }
    // Answers go stale if they could not be said in time.
    for (const [key, s] of this.pending) if (s.reply && now - s.at > 15_000) this.pending.delete(key);
    return turn;
  }
}
