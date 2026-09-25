import { grid, type BotSkill, type ChatChannel, type RoleId, type SeatId } from '../engine';
import type { Heard, ResultClaim } from './hear';
import type { Knowledge } from './knowledge';

/**
 * A bot's beliefs: who claims what, and how likely each other player is a saboteur, from its own knowledge
 * and what it heard. A saboteur bot's "suspicion" is how much the cabin blames each non-teammate instead
 * (its team is never suspected).
 */

export interface Claim {
  role: RoleId | null;
  results: (ResultClaim & { night: number })[];
  at: number;
}

export interface HeardLine {
  id: number;
  t: number;
  /** The night number when it was said (days keep their night's number). */
  night: number;
  from: string;
  channel: ChatChannel | 'whisper';
  heard: Heard;
}

export type Reason =
  | { kind: 'bomb'; seat: SeatId }
  | { kind: 'double_claim'; role: RoleId; other: string }
  | { kind: 'lied_role'; role: RoleId }
  | { kind: 'lied'; seat: SeatId }
  | { kind: 'reported'; seat: SeatId; by: string }
  | { kind: 'seen'; what: string; target?: string }
  | { kind: 'votes' }
  | { kind: 'defended'; saboteur: string }
  | { kind: 'accused' }
  | { kind: 'hunch' };

export interface Beliefs {
  claims: Map<string, Claim>;
  /** 0..1 for every other player in play. */
  suspicion: Map<string, number>;
  /** The strongest piece of evidence against each player. */
  why: Map<string, Reason>;
  /** Accused player to everyone who has accused them. */
  accusers: Map<string, Set<string>>;
}

/** Seat by player, per night (recorded by the brain as the nights go by). */
export type SeatHistory = Map<number, Map<string, SeatId>>;

const UNIQUE: readonly RoleId[] = ['nurse', 'investigator', 'marshal', 'stewardess_loyal', 'pilot'];
export const SABOTEUR_ROLES: readonly RoleId[] = ['bomber', 'mastermind', 'stewardess_rogue', 'pilot_rogue'];
const BASE = 0.2;
const NOISE: Record<BotSkill, number> = { easy: 0.5, normal: 0.2, hard: 0.05 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Roles that can find a bomb under someone else's seat. */
const findsSeatBombs = (role: RoleId | null) => role === 'investigator' || role === 'stewardess_loyal';

export function believe(k: Knowledge, lines: HeardLine[], history: SeatHistory, skill: BotSkill, noise: (id: string) => number): Beliefs {
  const me = k.me.id;
  const saboteur = k.me.team === 'saboteurs';
  const alive = new Set(k.others.map((p) => p.id));
  const careful = skill !== 'easy';
  const current = new Map(k.everyone.filter((p) => p.seat).map((p) => [p.id, p.seat!]));
  const seatsOn = (night: number) => history.get(night) ?? current;
  const seatOf = (id: string, night: number) => seatsOn(night).get(id) ?? current.get(id) ?? null;
  const sitterAt = (seat: SeatId, night: number): string | null => {
    for (const [id, s] of seatsOn(night)) if (s === seat) return id;
    return null;
  };

  // Who claims what (said out loud: the cabin and the PA).
  const claims = new Map<string, Claim>();
  const spoken = lines.filter((l) => l.channel === 'cabin' || l.channel === 'pa');
  for (const l of spoken) {
    if (l.from === me) continue;
    const c = claims.get(l.from) ?? { role: null, results: [], at: l.t };
    if (l.heard.claim) {
      c.role = l.heard.claim;
      c.at = l.t;
    }
    for (const r of l.heard.results) c.results.push({ ...r, night: l.night });
    claims.set(l.from, c);
  }

  const evidence = new Map<string, number>();
  const strongest = new Map<string, { w: number; r: Reason }>();
  const add = (id: string | null, w: number, r: Reason) => {
    if (!id || id === me || !alive.has(id)) return;
    evidence.set(id, (evidence.get(id) ?? 0) + w);
    const best = strongest.get(id);
    if (w > 0 && (!best || w > best.w)) strongest.set(id, { w, r });
  };

  // Bombs I know of: whoever sat on that seat the night it was planted (a saboteur only counts public ones).
  for (const b of k.bombs) {
    if (b.location.kind !== 'seat') continue;
    if (saboteur && !b.exploded && !b.defused) continue;
    const seat = b.location.seat;
    const nights = b.plantedNight ? [b.plantedNight] : [b.detonateNight - 1, b.detonateNight - 2].filter((n) => n >= 1 && n <= k.night);
    const sitters = [...new Set(nights.map((n) => sitterAt(seat, n)).filter((id): id is string => !!id))];
    for (const id of sitters) add(id, sitters.length > 1 ? 0.35 : 0.5, { kind: 'bomb', seat });
  }

  // Claims that cannot all be true.
  if (careful) {
    const byRole = new Map<RoleId, string[]>();
    for (const [id, c] of claims) if (c.role && UNIQUE.includes(c.role)) byRole.set(c.role, [...(byRole.get(c.role) ?? []), id]);
    for (const [role, ids] of byRole) {
      const living = ids.filter((id) => alive.has(id));
      if (living.length > 1) for (const id of living) add(id, 0.25, { kind: 'double_claim', role, other: living.find((o) => o !== id)! });
      // I hold that role: they are lying.
      if (!saboteur && k.me.role === role) for (const id of living) add(id, 0.8, { kind: 'double_claim', role, other: me });
      // Someone out of play was revealed with it.
      const holder = [...k.roleOf].find(([pid, r]) => r === role && !alive.has(pid));
      if (holder) for (const id of living) add(id, 0.6, { kind: 'double_claim', role, other: holder[0] });
    }
    // The seat map disproves some claims: the Pilot flies from the flight deck, the Stewardess works the aisle.
    for (const [id, c] of claims) {
      const seat = seatOf(id, k.night);
      if (c.role === 'pilot' && !grid.isCockpit(seat)) add(id, 0.7, { kind: 'lied_role', role: 'pilot' });
      if (c.role === 'stewardess_loyal' && !grid.isAisleSpot(seat)) add(id, 0.7, { kind: 'lied_role', role: 'stewardess_loyal' });
    }
    // Results that clash with my own (or check out).
    for (const [id, c] of claims) {
      for (const r of c.results) {
        if (r.where !== 'seat') continue;
        for (const seat of r.seats) {
          const mine = k.findings.find((f) => f.night === r.night && f.where === 'seat' && f.seats.includes(seat));
          const bombThere = k.bombs.some((b) => b.location.kind === 'seat' && b.location.seat === seat);
          if (mine) {
            const iFound = mine.bombs.some((bid) => k.bombs.some((b) => b.id === bid && b.location.kind === 'seat' && b.location.seat === seat));
            if ((r.what === 'bomb') !== iFound) add(id, 0.5, { kind: 'lied', seat });
          } else if (r.what === 'bomb' && bombThere) {
            add(id, -0.2, { kind: 'hunch' });
          }
        }
      }
    }
  }

  // What my cameras saw (the Pilot).
  for (const s of k.seen) {
    if (s.kind === 'drink') add(s.actor, 0.9, { kind: 'seen', what: 'drink', target: s.target });
    else if (s.kind === 'pills') add(s.actor, 0.1, { kind: 'seen', what: 'pills', target: s.target });
    else if (s.kind === 'lean' || s.kind === 'check' || s.kind === 'look_around') add(s.actor, -0.05, { kind: 'hunch' });
  }

  // Votes: voting out passengers looks bad; voting out saboteurs looks good.
  for (const v of k.verdicts) {
    if (!v.votes || !v.restrained) continue;
    const role = k.roleOf.get(v.restrained);
    if (!role) continue;
    const bad = SABOTEUR_ROLES.includes(role);
    for (const [voter, target] of Object.entries(v.votes)) if (target === v.restrained) add(voter, bad ? -0.1 : 0.1, { kind: 'votes' });
  }

  // Standing up for someone later revealed as a saboteur.
  for (const l of spoken) {
    for (const d of l.heard.defend) {
      const role = k.roleOf.get(d);
      if (role && SABOTEUR_ROLES.includes(role)) add(l.from, 0.3, { kind: 'defended', saboteur: d });
    }
  }

  // My own clean searches clear whoever sat there.
  for (const f of k.findings) {
    if (f.where !== 'seat' || f.bombs.length > 0) continue;
    for (const seat of f.seats) add(sitterAt(seat, f.night), -0.1, { kind: 'hunch' });
  }

  // First pass done: how far I trust each speaker.
  const first = (id: string) => clamp01(BASE + (evidence.get(id) ?? 0));
  const trust = (id: string) => (id === me ? 1 : 1 - first(id));

  // Bombs others report: whoever sits there looks bad, as far as I believe the reporter.
  for (const [id, c] of claims) {
    for (const r of c.results) {
      if (r.what !== 'bomb' || r.where !== 'seat') continue;
      for (const seat of r.seats) {
        const sitter = sitterAt(seat, r.night);
        if (!sitter || sitter === id) continue;
        let credible = skill === 'easy' ? 1 : trust(id);
        // Only an Investigator or a Stewardess finds bombs under other people's seats.
        if (skill === 'hard' && !findsSeatBombs(c.role) && seatOf(id, r.night) !== seat) credible *= 0.2;
        add(sitter, 0.3 * credible, { kind: 'reported', seat, by: id });
      }
    }
  }

  // Accusations, weighed by how much I trust whoever makes them (Easy believes anyone).
  const accusers = new Map<string, Set<string>>();
  for (const l of spoken) {
    for (const a of l.heard.accuse) {
      if (a.id === l.from) continue;
      accusers.set(a.id, new Set([...(accusers.get(a.id) ?? []), l.from]));
    }
  }
  for (const [accused, by] of accusers) {
    let w = 0;
    for (const accuser of by) {
      if (accuser === me) continue;
      w += saboteur ? 0.1 : skill === 'easy' ? 0.08 : trust(accuser) > 0.7 ? 0.06 : 0.02;
    }
    if (w > 0) add(accused, Math.min(0.3, w), { kind: 'accused' });
  }

  const suspicion = new Map<string, number>();
  const why = new Map<string, Reason>();
  for (const id of alive) {
    if (k.team.includes(id)) {
      suspicion.set(id, 0);
      continue;
    }
    const mix = NOISE[skill];
    suspicion.set(id, clamp01((1 - mix) * clamp01(BASE + (evidence.get(id) ?? 0)) + mix * noise(id)));
    why.set(id, strongest.get(id)?.r ?? { kind: 'hunch' });
  }
  return { claims, suspicion, why, accusers };
}

/** Players by suspicion, most suspected first. */
export function suspects(b: Beliefs): [string, number][] {
  return [...b.suspicion].sort((a, z) => z[1] - a[1]);
}
