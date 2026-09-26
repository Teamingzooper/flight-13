import { customAbility, grid, type BotSkill, type Cell, type CustomAbility, type Intent, type MoveTarget, type NightAction, type PlayerView, type RoleId, type SeatId } from '../engine';
import type { Order } from './hear';
import type { Knowledge } from './knowledge';
import { suspects, type Beliefs, type Reason } from './mind';

/**
 * What a bot does: who it votes for, where it aims its night, and how it carries out a teammate's order.
 * Every choice is picked from the view's options, so it is always legal.
 */

export type Rng = () => number;

export interface VoteChoice {
  target: string;
  reason: Reason | null;
}

export interface NightChoice {
  move?: MoveTarget;
  act?: NightAction | null;
  calls?: Intent[];
}

export interface OrderResult extends NightChoice {
  ok: boolean;
  /** Why not, in a few words ("can't reach 9A tonight"). */
  why?: string;
}

const VOTE_BAR: Record<BotSkill, number> = { easy: 0.3, normal: 0.45, hard: 0.55 };
const CUFF_BAR: Record<BotSkill, number> = { easy: 1.1, normal: 0.8, hard: 0.7 };
const THREAT_ROLES: readonly RoleId[] = ['investigator', 'stewardess_loyal', 'marshal', 'nurse'];
/** The built-in role a custom ability plays like (poison has its own play). */
const CUSTOM_PLAYS_AS: Record<CustomAbility, RoleId | 'poisoner'> = {
  none: 'passenger',
  treat: 'nurse',
  sweep: 'investigator',
  cuff: 'marshal',
  bomb: 'bomber',
  poison: 'poisoner',
};

const same = (a: NightAction, b: NightAction) => JSON.stringify(a) === JSON.stringify(b);
const legal = (view: PlayerView, action: NightAction | undefined): NightAction | undefined =>
  action ? view.options?.actions.find((o) => same(o, action)) : undefined;

export function chooseVote(view: PlayerView, k: Knowledge, b: Beliefs, skill: BotSkill, rng: Rng): VoteChoice {
  const options = new Set(view.options?.vote ?? k.others.map((p) => p.id));
  if (k.me.team === 'saboteurs') {
    const team = new Set(k.team);
    const counts = view.votes?.counts ?? {};
    // Hard: a teammate who is going down anyway gets our vote too (it looks good).
    if (skill === 'hard') {
      for (const t of k.team) if (options.has(t) && (counts[t] ?? 0) * 2 > k.others.length + 1) return { target: t, reason: { kind: 'accused' } };
    }
    const outsiders = [...options].filter((id) => !team.has(id));
    if (outsiders.length === 0) return { target: 'skip', reason: null };
    if (skill === 'easy' && rng() < 0.3) return { target: outsiders[Math.floor(rng() * outsiders.length)], reason: null };
    // With the crowd: whoever is already getting votes, else whoever the cabin blames most.
    const crowd = outsiders.filter((id) => (counts[id] ?? 0) > 0).sort((x, y) => (counts[y] ?? 0) - (counts[x] ?? 0));
    const target = crowd[0] ?? suspects(b).find(([id]) => options.has(id) && !team.has(id))?.[0] ?? outsiders[0];
    return { target, reason: b.why.get(target) ?? null };
  }
  const top = suspects(b).find(([id]) => options.has(id));
  if (top && top[1] >= VOTE_BAR[skill]) return { target: top[0], reason: b.why.get(top[0]) ?? null };
  return { target: 'skip', reason: null };
}

/** A saboteur's biggest threat: a claimed Investigator, Stewardess, Air Marshal or Nurse, else a loud accuser. */
export function threat(k: Knowledge, b: Beliefs): string | null {
  const outsiders = k.others.filter((p) => !k.team.includes(p.id)).map((p) => p.id);
  for (const role of THREAT_ROLES) {
    const claimer = outsiders.find((id) => b.claims.get(id)?.role === role);
    if (claimer) return claimer;
  }
  let loudest: string | null = null;
  let most = 0;
  for (const id of outsiders) {
    let n = 0;
    for (const [accused, by] of b.accusers) if (k.team.includes(accused) && by.has(id)) n++;
    if (n > most) [loudest, most] = [id, n];
  }
  return loudest;
}

function seatOf(k: Knowledge, id: string): SeatId | null {
  return k.everyone.find((p) => p.id === id)?.seat ?? null;
}

/** A seat I may move to that is right next to `seat` (or null). */
function seatNextTo(view: PlayerView, seat: SeatId | null): SeatId | null {
  const target = seat ? grid.parseSeat(seat) : null;
  if (!target) return null;
  const near = (view.options?.seats ?? []).filter((s) => {
    const c = grid.parseSeat(s);
    return c && grid.distance(c, target) === 1;
  });
  return near[0] ?? null;
}

/** A seat out of the blast, if one of my own seat bombs goes off tonight and I am sitting too close to it. */
function clearOfMyBomb(view: PlayerView, k: Knowledge, rng: Rng): SeatId | null {
  const blasts = k.bombs
    .filter((bomb) => bomb.planterId === k.me.id && !bomb.exploded && !bomb.defused && bomb.detonateNight === view.phase.night)
    .map((bomb) => (bomb.location.kind === 'seat' ? grid.parseSeat(bomb.location.seat) : null))
    .filter((c): c is Cell => !!c);
  const here = k.me.seat ? grid.parseSeat(k.me.seat) : null;
  const safe = (c: Cell) => blasts.every((at) => grid.distance(c, at) > grid.BLAST_RADIUS);
  if (!here || safe(here)) return null;
  const away = (view.options?.seats ?? []).filter((s) => {
    const c = grid.parseSeat(s);
    return c && safe(c);
  });
  return away.length ? away[Math.floor(rng() * away.length)] : null;
}

/** An aisle spot I may walk the cart to at `seat`'s row (crew). */
function aisleAt(view: PlayerView, seat: SeatId | null): SeatId | null {
  const cell = seat ? grid.parseSeat(seat) : null;
  if (!cell) return null;
  const spot = grid.aisleSpot(cell.row);
  return view.options?.seats.includes(spot) ? spot : null;
}

export function chooseNight(view: PlayerView, k: Knowledge, b: Beliefs, skill: BotSkill, rng: Rng): NightChoice {
  if (skill === 'easy') return {};
  const kind = view.phase.kind;
  if (kind === 'night_move') {
    // My own bomb goes off tonight: get clear of it (every time, on Normal and Hard).
    const flee = clearOfMyBomb(view, k, rng);
    if (flee) return { move: flee };
  }
  if (skill === 'normal' && rng() < 0.5) return {};
  // The host's own roles play like the built-in role they borrowed their ability from.
  const custom = customAbility(view.settings, k.me.role);
  const role: RoleId | 'poisoner' = custom === null ? k.me.role : CUSTOM_PLAYS_AS[custom];
  const saboteur = k.me.team === 'saboteurs';
  const top = suspects(b).find(([id]) => !k.team.includes(id));
  const suspect = top?.[0] ?? null;
  const target = saboteur ? threat(k, b) : suspect;
  const targetSeat = target ? seatOf(k, target) : null;

  if (kind === 'night_move') {
    if (grid.isCockpit(k.me.seat)) {
      const calls: Intent[] = [];
      if (target && view.options?.seatbelt.includes(target)) calls.push({ kind: 'seatbelt', target });
      // A loyal Pilot keeps someone he trusts safe; a rogue one takes a threat out of play for the night.
      const trusted = suspects(b).at(-1)?.[0];
      const guest = saboteur ? target : skill === 'hard' ? trusted : null;
      if (guest && view.options?.jumpseat.includes(guest)) calls.push({ kind: 'jumpseat', target: guest });
      return { calls };
    }
    if (role === 'stewardess_loyal' || role === 'stewardess_rogue') {
      const spot = aisleAt(view, targetSeat);
      return spot ? { move: spot } : {};
    }
    if (role === 'investigator' || role === 'nurse' || role === 'marshal' || role === 'bomber' || role === 'mastermind' || role === 'poisoner') {
      const seat = seatNextTo(view, targetSeat);
      return seat ? { move: seat } : {};
    }
    return {};
  }

  if (kind === 'night_act') {
    const me = k.me.seat ? grid.parseSeat(k.me.seat) : null;
    switch (role) {
      case 'investigator': {
        const act = legal(view, { kind: 'sweep' });
        return act ? { act } : {};
      }
      case 'nurse': {
        const patient = k.poisoned ? k.me.id : target && b.claims.get(target)?.role && THREAT_ROLES.includes(b.claims.get(target)!.role!) ? target : null;
        const act = patient ? legal(view, { kind: 'treat', target: patient }) : undefined;
        return act ? { act } : {};
      }
      case 'marshal': {
        if (!suspect || (top?.[1] ?? 0) < CUFF_BAR[skill]) return {};
        const act = legal(view, { kind: 'cuff', target: suspect });
        return act ? { act } : {};
      }
      case 'stewardess_loyal': {
        const cell = targetSeat ? grid.parseSeat(targetSeat) : null;
        const act = cell ? legal(view, { kind: 'check', side: cell.col < 3 ? 'left' : 'right' }) : undefined;
        return act ? { act } : {};
      }
      case 'pilot':
      case 'pilot_rogue': {
        const cell = targetSeat ? grid.parseSeat(targetSeat) : null;
        const start = cell ? Math.max(1, cell.row - 1) : null;
        const act = start !== null ? (legal(view, { kind: 'watch', startRow: start }) ?? view.options?.actions.find((a) => a.kind === 'watch')) : undefined;
        return act ? { act } : {};
      }
      case 'bomber':
      case 'mastermind': {
        // Not planting tonight: the Mastermind may take their phone off airplane mode instead, to cover the team.
        const jamOr = (): { act?: NightAction } => {
          const jam = role === 'mastermind' && rng() < 0.4 ? legal(view, { kind: 'jam' }) : undefined;
          return jam ? { act: jam } : {};
        };
        const threatCell = targetSeat ? grid.parseSeat(targetSeat) : null;
        const inReach = !!(me && threatCell && grid.distance(me, threatCell) <= 2);
        if (!inReach && rng() >= 0.35) return jamOr();
        const act = legal(view, { kind: 'plant', where: 'seat', fuse: skill === 'hard' ? 1 : 2 }) ?? view.options?.actions.find((a) => a.kind === 'plant');
        return act ? { act } : jamOr();
      }
      case 'stewardess_rogue': {
        const act = target ? legal(view, { kind: 'serve', target }) : undefined;
        return act ? { act } : {};
      }
      case 'poisoner': {
        // A saboteur poisons a threat; a passenger only someone it is fairly sure of.
        const victim = saboteur ? target : suspect && (top?.[1] ?? 0) >= CUFF_BAR[skill] ? suspect : null;
        const act = victim ? legal(view, { kind: 'poison', target: victim }) : undefined;
        return act ? { act } : {};
      }
      default:
        return {};
    }
  }
  return {};
}

/** Carry out a teammate's order if it can be done tonight (otherwise say why not). */
export function followOrder(view: PlayerView, k: Knowledge, order: Order): OrderResult {
  const kind = view.phase.kind;
  if (k.me.buckled) return { ok: false, why: "I'm buckled in tonight" };
  const seats = view.options?.seats ?? [];
  const actions = view.options?.actions ?? [];
  switch (order.act) {
    case 'stay':
      return kind === 'night_move' ? { ok: true, move: 'stay' } : { ok: true, act: null };
    case 'move':
      if (kind !== 'night_move') return { ok: false, why: 'seats are set for tonight' };
      if (order.seat && seats.includes(order.seat)) return { ok: true, move: order.seat };
      return { ok: false, why: `can't get to ${order.seat ?? 'that seat'} tonight` };
    case 'plant': {
      if (k.me.bombsLeft <= 0) return { ok: false, why: "I'm out of bombs" };
      if (!actions.some((a) => a.kind === 'plant') && kind === 'night_act') return { ok: false, why: "I can't plant from here" };
      const elsewhere = order.where === 'seat' && order.seat && order.seat !== k.me.seat;
      if (kind === 'night_move') {
        if (elsewhere) return seats.includes(order.seat!) ? { ok: true, move: order.seat! } : { ok: false, why: `can't reach ${order.seat} tonight` };
        return { ok: true, move: 'stay' };
      }
      if (elsewhere) return { ok: false, why: `I'm not in ${order.seat}` };
      const act = actions.find((a) => a.kind === 'plant' && a.where === (order.where ?? 'seat'));
      return act ? { ok: true, act } : { ok: false, why: `can't plant at the ${order.where} from here` };
    }
    case 'poison': {
      if (!order.target) return { ok: false, why: 'poison who?' };
      const targetSeat = k.everyone.find((p) => p.id === order.target)?.seat ?? null;
      if (kind === 'night_move') {
        const spot = aisleAt(view, targetSeat) ?? seatNextTo(view, targetSeat);
        return spot ? { ok: true, move: spot } : { ok: false, why: "can't get to them" };
      }
      // (A poisoner of the host's making slips it to a neighbour instead of serving a drink.)
      const act = legal(view, { kind: 'serve', target: order.target }) ?? legal(view, { kind: 'poison', target: order.target });
      return act ? { ok: true, act } : { ok: false, why: "they're not in my row" };
    }
    case 'knockout': {
      if (kind !== 'night_act') return { ok: false, why: 'only once the lights are out' };
      const act = actions.find((a) => a.kind === 'knockout');
      return act ? { ok: true, act } : { ok: false, why: "I'm not up front tonight" };
    }
  }
}
