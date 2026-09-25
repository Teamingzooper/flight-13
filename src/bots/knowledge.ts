import type { BombView, LogEntry, PlayerSummary, PlayerView, RoleId, SeatId, Sighting, YouView } from '../engine';

/**
 * What a bot knows for certain, read from its own seat's view (never the game state): its role, its own
 * results, what everyone saw happen, and, for a saboteur, its team.
 */

/** One of my own searches, checks, sweeps or inspections, and the bombs it turned up. */
export interface Finding {
  night: number;
  where: 'seat' | 'cart' | 'lavatory';
  seats: SeatId[];
  bombs: string[];
}

export interface Seen extends Sighting {
  night: number;
}

export interface VerdictFact {
  night: number;
  restrained: string | null;
  /** Voter to target (or 'skip'); null when votes were anonymous. */
  votes: Record<string, string> | null;
}

export interface Knowledge {
  me: YouView;
  night: number;
  /** Other players still in play. */
  others: PlayerSummary[];
  everyone: PlayerSummary[];
  /** Saboteur teammates; empty for passengers. */
  team: string[];
  /** Roles known for certain: revealed ones, and my team's (never mine). */
  roleOf: Map<string, RoleId>;
  findings: Finding[];
  treated: { night: number; target: string }[];
  served: { night: number; target: string }[];
  cuffed: { night: number; target: string }[];
  seen: Seen[];
  verdicts: VerdictFact[];
  deaths: { night: number; id: string; cause: string }[];
  washroom: { night: number; id: string }[];
  jumpseat: { night: number; id: string }[];
  /** Bombs I know of (live, defused or gone off), from the view. */
  bombs: BombView[];
  poisoned: boolean;
}

const mine = (e: LogEntry, me: string) => Array.isArray(e.to) && e.to.includes(me);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function know(view: PlayerView): Knowledge {
  const me = view.you!;
  const everyone = view.players;
  const k: Knowledge = {
    me,
    night: view.phase.night,
    others: everyone.filter((p) => p.id !== me.id && p.status === 'alive'),
    everyone,
    team: me.team === 'saboteurs' ? everyone.filter((p) => p.id !== me.id && p.team === 'saboteurs').map((p) => p.id) : [],
    roleOf: new Map(everyone.filter((p) => p.id !== me.id && p.role).map((p) => [p.id, p.role!])),
    findings: [],
    treated: [],
    served: [],
    cuffed: [],
    seen: [],
    verdicts: [],
    deaths: [],
    washroom: [],
    jumpseat: [],
    bombs: view.bombs,
    poisoned: me.poisoned,
  };
  for (const e of view.log) {
    const d = e.data ?? {};
    switch (e.tag) {
      case 'search':
        if (!mine(e, me.id)) break;
        k.findings.push(
          d.lavatory
            ? { night: e.night, where: 'lavatory', seats: [], bombs: strings(d.bombs) }
            : { night: e.night, where: 'seat', seats: str(d.seat) ? [str(d.seat)!] : [], bombs: strings(d.bombs) },
        );
        break;
      case 'check':
      case 'sweep':
        if (mine(e, me.id)) k.findings.push({ night: e.night, where: 'seat', seats: strings(d.seats), bombs: strings(d.bombs) });
        break;
      case 'inspect':
        if (mine(e, me.id)) k.findings.push({ night: e.night, where: d.what === 'cart' ? 'cart' : 'lavatory', seats: [], bombs: strings(d.bombs) });
        break;
      case 'treat':
        if (mine(e, me.id) && str(d.target)) k.treated.push({ night: e.night, target: str(d.target)! });
        break;
      case 'serve':
        if (mine(e, me.id) && str(d.target)) k.served.push({ night: e.night, target: str(d.target)! });
        break;
      case 'cuff':
        if (mine(e, me.id) && str(d.target)) k.cuffed.push({ night: e.night, target: str(d.target)! });
        break;
      case 'watch':
        if (!mine(e, me.id) || !Array.isArray(d.seen)) break;
        for (const s of d.seen as Sighting[]) k.seen.push({ night: e.night, ...s });
        break;
      case 'verdict':
        k.verdicts.push({
          night: e.night,
          restrained: str(d.player),
          votes: d.votes && typeof d.votes === 'object' ? (d.votes as Record<string, string>) : null,
        });
        break;
      case 'death':
        if (str(d.player)) k.deaths.push({ night: e.night, id: str(d.player)!, cause: str(d.cause) ?? 'unknown' });
        break;
      case 'explosion':
        for (const id of strings(d.victims)) k.deaths.push({ night: e.night, id, cause: 'explosion' });
        break;
      case 'washroom':
        if (e.to === 'all' && str(d.player)) k.washroom.push({ night: e.night, id: str(d.player)! });
        break;
      case 'jumpseat':
        if (e.to === 'all' && str(d.player)) k.jumpseat.push({ night: e.night, id: str(d.player)! });
        break;
    }
  }
  return k;
}

/** Bombs I know sat under `seat` (found by me or gone off there). */
export function bombsAt(k: Knowledge, seat: SeatId): BombView[] {
  return k.bombs.filter((b) => b.location.kind === 'seat' && b.location.seat === seat);
}
